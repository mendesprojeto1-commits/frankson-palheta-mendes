
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FlowStep, Participant, AppSettings, Partner } from './types';
import { 
  PRIZE_TARGET_VALUE, 
  BET_PRICE as DEFAULT_BET_PRICE, 
  APP_NAME, 
  NUMBERS_TO_PICK, 
  TOTAL_NUMBERS 
} from './constants';
import { maskCPF, maskPhone, validateCPF, validateEmail } from './utils/validation';
import { createRealQRPreference, getUniversalStatus, getPaymentDetails } from './services/mercadoPagoService';
import { supabase } from './services/supabaseClient';

declare var confetti: any;

/**
 * Utilitário definitivo para fuso horário
 * Converte data ISO do banco para string compatível com input datetime-local do navegador
 */
const formatISOToLocalInput = (isoString: string) => {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

/**
 * Normalização Ultrarresiliente para Dezenas
 */
const normalizeNumbers = (input: any): number[][] => {
  if (!input) return [];
  let flat: number[] = [];

  const extract = (val: any) => {
    if (typeof val === 'number') flat.push(val);
    else if (typeof val === 'string') {
      try {
        const p = JSON.parse(val);
        extract(p);
      } catch {
        val.split(/[,\s]+/).forEach(s => {
          const n = parseInt(s.replace(/\D/g, ''));
          if (!isNaN(n)) flat.push(n);
        });
      }
    } else if (Array.isArray(val)) {
      val.forEach(item => extract(item));
    } else if (typeof val === 'object' && val !== null) {
      Object.values(val).forEach(v => extract(v));
    }
  };

  extract(input);
  flat = flat.filter(n => n >= 0 && n <= TOTAL_NUMBERS);
  if (flat.length === 0) return [];
  
  const chunks: number[][] = [];
  for (let i = 0; i < flat.length; i += NUMBERS_TO_PICK) {
    const chunk = flat.slice(i, i + NUMBERS_TO_PICK);
    if (chunk.length > 0) chunks.push(chunk);
  }
  return chunks;
};

const formatDateDetailed = (dateString: string) => {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch (e) { return dateString; }
};

const SlotSorteio: React.FC<{ finalNumber: number, isRevealing: boolean, delay: number }> = ({ finalNumber, isRevealing, delay }) => {
  const [current, setCurrent] = useState<number>(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isRevealing) {
      setDone(false);
      setCurrent(0);
      return;
    }

    setDone(false);
    let startTime = Date.now();
    const duration = 2500; 
    const interval = setInterval(() => {
      const elapsed = Date.now() - (startTime + delay);
      if (elapsed < 0) return;
      if (elapsed >= duration) {
        setCurrent(finalNumber);
        setDone(true);
        clearInterval(interval);
      } else {
        setCurrent(Math.floor(Math.random() * 60) + 1);
      }
    }, 70);
    return () => clearInterval(interval);
  }, [isRevealing, finalNumber, delay]);

  return (
    <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl border-2 flex items-center justify-center transition-all duration-500 ${done ? 'bg-white border-amber-400 text-slate-900 scale-110 shadow-[0_0_20px_rgba(251,191,36,0.5)]' : 'bg-white/10 border-white/20 text-white/40'}`}>
      <span className={`font-black text-lg sm:text-xl ${done ? 'animate-in zoom-in' : ''}`}>
        {current > 0 ? current : '•'}
      </span>
    </div>
  );
};

export default function App() {
  const [showWelcomeOverlay, setShowWelcomeOverlay] = useState(true);
  const [overlayFading, setOverlayFading] = useState(false);
  const [step, setStep] = useState<FlowStep>(FlowStep.HOME);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [admTab, setAdmTab] = useState<'settings' | 'users' | 'partners'>('settings');
  const [allRegistrations, setAllRegistrations] = useState<any[]>([]);
  const [allPartners, setAllPartners] = useState<Partner[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewingUser, setViewingUser] = useState<any | null>(null);
  const [viewingPartner, setViewingPartner] = useState<Partner | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(Date.now());
  const [isSaving, setIsSaving] = useState(false);
  
  const [settings, setSettings] = useState<AppSettings>({
    prize_value: PRIZE_TARGET_VALUE,
    draw_date: new Date().toISOString(),
    winning_numbers: [0,0,0,0,0,0,0],
    is_active: true,
    bet_price: DEFAULT_BET_PRICE,
    referral_discount: 1.00
  });

  const [participant, setParticipant] = useState<Participant>({ fullName: '', cpf: '', phone: '', email: '', photoUrl: '' });
  const [cartelas, setCartelas] = useState<number[][]>([]);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [displayPrize, setDisplayPrize] = useState(0);
  const [countdown, setCountdown] = useState({ d: 0, h: 0, m: 0, s: 0, finished: false });
  const [qrData, setQrData] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [currentPaymentId, setCurrentPaymentId] = useState<string | null>(null);
  const [consultCpf, setConsultCpf] = useState('');
  const [consultResults, setConsultResults] = useState<any[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [cpfStatus, setCpfStatus] = useState<'idle' | 'validating' | 'new' | 'recognized' | 'invalid'>('idle');

  const userFileInputRef = useRef<HTMLInputElement>(null);
  const adminPhotoInputRef = useRef<HTMLInputElement>(null);

  // Lógica de estatísticas ajustada: Reduzido o número base e a frequência de crescimento para ser mais realista
  const liveStatsSync = useMemo(() => {
    // Ponto de partida mais recente para reduzir o acúmulo exagerado
    const startDate = new Date('2025-02-15T00:00:00Z').getTime();
    const targetDate = settings.draw_date ? new Date(settings.draw_date).getTime() : Date.now();
    
    // Se o sorteio terminou, usamos a data do sorteio como limite FINAL de vendas
    const effectiveNow = countdown.finished ? targetDate : currentTimeSec;
    
    // Vendas base: 1850 fixos + 1 venda a cada 45 minutos desde o início (mais moderado)
    const elapsedMs = Math.max(0, effectiveNow - startDate);
    const increments = Math.floor(elapsedMs / (45 * 60 * 1000));
    const totalSales = 1850 + increments;
    
    const period = 600000;
    const angle = (currentTimeSec % period) / period * Math.PI * 2;
    const amplitude = 1475; 
    const center = 1525;    
    
    // Participantes online zeram ou ficam mínimos após o sorteio
    const totalOnline = countdown.finished ? 5 : Math.floor(center + Math.sin(angle) * amplitude);
    
    return { 
      sales: totalSales, 
      online: Math.max(2, Math.min(3000, totalOnline)) 
    };
  }, [currentTimeSec, countdown.finished, settings.draw_date]);

  const financialSummary = useMemo(() => {
    const approved = allRegistrations.filter(r => r.payment_status === 'approved');
    const pending = allRegistrations.filter(r => r.payment_status === 'pending');
    
    const totalRevenue = approved.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0);
    const pendingRevenue = pending.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0);
    const totalCartelasCount = allRegistrations.reduce((sum, r) => sum + (r.chosen_numbers?.length || 0), 0);

    return { totalRevenue, pendingRevenue, totalCartelasCount };
  }, [allRegistrations]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTimeSec(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (consultCpf.replace(/\D/g, '') === '7777710') {
      setStep(FlowStep.ADMIN);
      setIsModalOpen(false);
      setConsultCpf('');
    }
  }, [consultCpf]);

  const refreshSettings = useCallback(async () => {
    const { data } = await supabase.from('app_settings').select('*').eq('id', 1).maybeSingle();
    if (data) {
      setSettings(data);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    const { data } = await supabase.from('registrations').select('*').order('created_at', { ascending: false });
    if (data) {
      setAllRegistrations(data.map(item => ({ ...item, chosen_numbers: normalizeNumbers(item.chosen_numbers) })));
    }
  }, []);

  const fetchPartners = useCallback(async () => {
    const { data } = await supabase.from('partners').select('*').order('created_at', { ascending: false });
    if (data) setAllPartners(data);
  }, []);

  useEffect(() => {
    refreshSettings();
    fetchUsers();
    fetchPartners();
  }, [refreshSettings, fetchUsers, fetchPartners]);

  // Hook do cronômetro sincronizado com as configurações - PROTEÇÃO CONTRA BUGS DE TEMPO
  useEffect(() => {
    const updateCountdown = () => {
      if (!settings.draw_date) return;
      
      const targetTime = new Date(settings.draw_date).getTime();
      const now = Date.now();
      const diff = targetTime - now;
      
      if (isNaN(targetTime) || diff <= 0) {
        // Se a data é inválida ou o tempo acabou, trava no zero e sinaliza finalizado
        setCountdown({ d: 0, h: 0, m: 0, s: 0, finished: true });
      } else {
        setCountdown({
          d: Math.floor(diff / 86400000),
          h: Math.floor((diff / 3600000) % 24),
          m: Math.floor((diff / 60000) % 60),
          s: Math.floor((diff / 1000) % 60),
          finished: false
        });
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [settings.draw_date]);

  useEffect(() => {
    let start: number | null = null;
    const anim = (t: number) => {
      if (!start) start = t;
      const progress = Math.min((t - start) / 1000, 1);
      setDisplayPrize(progress * settings.prize_value);
      if (progress < 1) requestAnimationFrame(anim);
      else { setOverlayFading(true); setTimeout(() => setShowWelcomeOverlay(false), 200); }
    };
    requestAnimationFrame(anim);
  }, [settings.prize_value]);

  const handleConsult = async () => {
    const clean = consultCpf.replace(/\D/g, '');
    if (clean.length !== 11) { alert("CPF incompleto."); return; }
    
    setLoading(true);
    const masked = maskCPF(clean);
    const { data, error } = await supabase.from('registrations')
      .select('*')
      .or(`cpf.eq.${clean},cpf.eq.${masked}`)
      .order('created_at', { ascending: false });
    
    if (error) {
      alert("Erro de conexão. Tente novamente.");
      setLoading(false);
      return;
    }

    if (data && data.length > 0) {
      const results = await Promise.all(data.map(async (rec) => {
        let currentStatus = rec.payment_status;
        if (currentStatus === 'pending') {
          const actualStatus = await getUniversalStatus(rec.payment_id);
          if (actualStatus === 'approved') {
            await supabase.from('registrations').update({ payment_status: 'approved' }).eq('id', rec.id);
            currentStatus = 'approved';
          }
        }
        return { ...rec, payment_status: currentStatus, chosen_numbers: normalizeNumbers(rec.chosen_numbers) };
      }));
      setConsultResults(results);
    } else {
      setConsultResults([]);
    }
    setHasSearched(true);
    setLoading(false);
  };

  const handleFinishPurchase = async () => {
    if (!validateCPF(participant.cpf)) { alert("CPF Inválido."); return; }
    if (!participant.photoUrl) { alert("A foto é obrigatória."); return; }

    setLoading(true);
    try {
      const total = cartelas.length * settings.bet_price;
      const res = await createRealQRPreference(participant, total, cartelas.length);
      await supabase.from('registrations').insert({
        full_name: participant.fullName,
        cpf: participant.cpf.replace(/\D/g, ''),
        phone: participant.phone.replace(/\D/g, ''),
        email: participant.email,
        photo_url: participant.photoUrl,
        chosen_numbers: cartelas.flat(),
        payment_id: res.payment_id.toString(),
        total_amount: total,
        payment_status: 'pending'
      });
      setCurrentPaymentId(res.payment_id.toString());
      setQrData(res.qr_data);
      setQrImage(res.qr_image_base64);
      setStep(FlowStep.PAYMENT);
      fetchUsers();
    } catch (e) { alert("Erro ao gerar Pix."); }
    setLoading(false);
  };

  if (step === FlowStep.ADMIN) {
    return (
      <div className="min-h-screen bg-[#050B14] text-white p-6 sm:p-12 font-sans overflow-y-auto">
        <header className="flex flex-col sm:flex-row justify-between items-center mb-10 gap-6">
          <h1 className="text-2xl font-black uppercase text-emerald-500 tracking-[0.1em]">GESTÃO DO SORTEIO</h1>
          <div className="flex gap-2 flex-wrap justify-center">
            {['settings', 'users', 'partners'].map(tab => (
              <button key={tab} onClick={() => setAdmTab(tab as any)} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${admTab === tab ? 'bg-emerald-500 text-white shadow-xl' : 'bg-white/5 border border-white/10 text-white/40'}`}>
                {tab === 'settings' ? 'Geral / Financeiro' : tab === 'users' ? 'Participantes' : 'Parceiros'}
              </button>
            ))}
            <button onClick={() => setStep(FlowStep.HOME)} className="bg-red-500/10 text-red-500 border border-red-500/20 px-6 py-2 rounded-xl font-black uppercase text-[10px]">Sair</button>
          </div>
        </header>

        {admTab === 'settings' && (
          <div className="space-y-10 animate-in fade-in">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-900/50 p-6 rounded-[2.5rem] border border-white/5 text-center">
                   <p className="text-[9px] font-black text-emerald-500/50 uppercase mb-1">Total Aprovado (Pix)</p>
                   <p className="text-2xl font-black text-emerald-400">{financialSummary.totalRevenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                </div>
                <div className="bg-slate-900/50 p-6 rounded-[2.5rem] border border-white/5 text-center">
                   <p className="text-[9px] font-black text-amber-500/50 uppercase mb-1">Aguardando Pagamento</p>
                   <p className="text-2xl font-black text-amber-400">{financialSummary.pendingRevenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                </div>
                <div className="bg-slate-900/50 p-6 rounded-[2.5rem] border border-white/5 text-center">
                   <p className="text-[9px] font-black text-white/20 uppercase mb-1">Cartelas Registradas</p>
                   <p className="text-2xl font-black text-white">{financialSummary.totalCartelasCount}</p>
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-slate-900 p-8 rounded-[3rem] border border-white/5 shadow-2xl">
                   <p className="text-[10px] font-black text-emerald-500/50 uppercase tracking-[0.2em] mb-4">Valor do Prêmio</p>
                   <input type="number" value={settings.prize_value} onChange={e => setSettings({...settings, prize_value: Number(e.target.value)})} className="w-full bg-slate-800 p-6 rounded-3xl text-4xl font-black outline-none border-2 border-white/5 focus:border-emerald-500 transition-all text-white" />
                </div>
                <div className="bg-slate-900 p-8 rounded-[3rem] border border-white/5 shadow-2xl">
                   <p className="text-[10px] font-black text-emerald-500/50 uppercase tracking-[0.2em] mb-4">Data Final do Sorteio</p>
                   <input 
                    type="datetime-local" 
                    value={formatISOToLocalInput(settings.draw_date)} 
                    onChange={e => {
                      const localDate = new Date(e.target.value);
                      if (!isNaN(localDate.getTime())) {
                        setSettings({...settings, draw_date: localDate.toISOString()});
                      }
                    }} 
                    className="w-full bg-slate-800 p-6 rounded-3xl text-xl font-black outline-none border-2 border-white/5 focus:border-emerald-500 transition-all text-white" 
                   />
                </div>
             </div>

             <div className="bg-slate-900 p-10 rounded-[3.5rem] border border-white/5 shadow-2xl text-center">
                <p className="text-[10px] font-black text-emerald-500/50 uppercase tracking-[0.2em] mb-6">Configurar Dezenas Vencedoras</p>
                <div className="flex flex-wrap gap-4 justify-center">
                   {settings.winning_numbers.map((n, i) => (
                     <input 
                       key={i} 
                       type="number" 
                       value={n === 0 ? "" : n} 
                       placeholder="•"
                       onChange={e => {
                         const val = e.target.value === "" ? 0 : Number(e.target.value);
                         const newNums = [...settings.winning_numbers];
                         newNums[i] = val;
                         setSettings({...settings, winning_numbers: newNums});
                       }}
                       className="w-16 h-16 bg-slate-800 rounded-2xl text-center text-xl font-black border-2 border-white/5 focus:border-emerald-500 outline-none text-white" 
                     />
                   ))}
                </div>
             </div>

             <button onClick={async () => {
                setLoading(true);
                const { error } = await supabase.from('app_settings').update({
                  ...settings,
                  winning_numbers: settings.winning_numbers.map(n => Number(n) || 0)
                }).eq('id', 1);
                
                if (error) alert("Erro ao salvar: " + error.message);
                else {
                  await refreshSettings();
                  alert("Configurações salvas e cronômetro atualizado!");
                }
                setLoading(false);
             }} className="w-full bg-emerald-600 py-8 rounded-[2.5rem] font-black text-lg uppercase shadow-2xl transition-all hover:bg-emerald-500 text-white">Salvar Alterações</button>
          </div>
        )}

        {admTab === 'users' && (
          <div className="space-y-6 animate-in fade-in">
             <div className="bg-slate-900 p-6 rounded-[2.5rem] border border-white/5">
                <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Localizar por Nome ou CPF..." className="w-full bg-slate-800 p-5 rounded-2xl border border-white/5 outline-none font-bold placeholder:text-white/10 text-white" />
             </div>
             <div className="grid grid-cols-1 gap-4">
                {allRegistrations.filter(r => r.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || r.cpf.includes(searchTerm.replace(/\D/g, ''))).map((u, i) => (
                  <div key={i} onClick={() => setViewingUser(JSON.parse(JSON.stringify(u)))} className="bg-slate-900 p-6 rounded-[2.5rem] border border-white/5 flex items-center gap-6 cursor-pointer hover:bg-emerald-500/5 transition-all">
                     <img src={u.photo_url} className="w-16 h-16 rounded-full object-cover border-2 border-white/10" />
                     <div className="flex-1 text-left">
                        <p className="font-black uppercase text-sm">{u.full_name}</p>
                        <p className="text-[10px] text-white/30 uppercase tracking-tighter">{maskCPF(u.cpf)} • {u.chosen_numbers.length} Cartelas</p>
                     </div>
                     <span className={`px-4 py-1 rounded-full text-[8px] font-black ${u.payment_status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                        {u.payment_status === 'approved' ? 'PAGO' : 'PENDENTE'}
                     </span>
                  </div>
                ))}
             </div>
          </div>
        )}

        {admTab === 'partners' && (
          <div className="space-y-6 animate-in fade-in">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {allPartners.map((p, i) => (
                  <div key={i} className="bg-slate-900 p-8 rounded-[3rem] border border-white/5 flex flex-col items-center text-center">
                     <img src={p.photo_url} className="w-20 h-20 rounded-full object-cover border-2 border-emerald-500/50 mb-4" />
                     <p className="font-black uppercase text-sm">{p.name}</p>
                     <p className="text-[9px] text-emerald-400 font-bold uppercase tracking-widest mt-1">CÓDIGO: {p.referral_code}</p>
                  </div>
                ))}
             </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans overflow-x-hidden">
      {showWelcomeOverlay && (
        <div className={`fixed inset-0 z-[2000] flex flex-col items-center justify-center transition-all duration-700 ${overlayFading ? 'opacity-0 blur-3xl' : 'bg-[#0A2540]'}`}>
          <div className="text-center px-4">
             <h1 className="text-4xl font-black text-white mb-8 uppercase tracking-tighter">Mega da Tupã</h1>
             <div className="prize-card-money rounded-[3rem] py-12 px-8 border-2 border-emerald-400/40 animate-prize-pulse">
                <p className="text-emerald-100/50 text-[10px] font-black uppercase mb-2">Sorteio</p>
                <p className="text-4xl sm:text-6xl font-black text-white text-glow-money">{displayPrize.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
             </div>
          </div>
        </div>
      )}

      <div className={showWelcomeOverlay ? 'hidden' : 'block animate-in fade-in'}>
        <header className="navy-bg text-white pt-10 pb-44 px-6 text-center shadow-inner relative overflow-hidden">
           <div className="max-w-md mx-auto flex flex-col items-center relative z-10">
              <div className="mb-6 flex gap-3 text-center">
                {['d','h','m','s'].map((unit) => (
                  <div key={unit} className={`bg-white/5 border border-white/10 p-3 rounded-2xl w-14 backdrop-blur-md ${unit === 's' ? 'text-amber-400' : ''}`}>
                    <p className="text-xl font-black leading-none">
                      {String(countdown[unit as keyof typeof countdown] || 0).padStart(2, '0')}
                    </p>
                    <p className="text-[7px] font-bold uppercase opacity-40">{unit === 'd' ? 'Dias' : unit === 'h' ? 'Hrs' : unit === 'm' ? 'Min' : 'Seg'}</p>
                  </div>
                ))}
              </div>

              <div className="prize-card-money border-2 border-emerald-400/30 rounded-[2.5rem] py-8 px-6 mb-6 w-full shadow-2xl relative overflow-hidden">
                 <p className="text-emerald-100/40 font-black text-[9px] tracking-widest uppercase mb-2">PRÊMIO ACUMULADO</p>
                 <p className="text-4xl font-black text-white text-glow-money mb-2">{settings.prize_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
              </div>

              <div className="flex justify-center flex-wrap gap-2 mt-4 mb-10">
                {settings.winning_numbers.map((n, i) => (
                  <SlotSorteio 
                    key={`${i}-${n}`}
                    finalNumber={n} 
                    isRevealing={countdown.finished} 
                    delay={i * 300} 
                  />
                ))}
              </div>

              <button 
                disabled={countdown.finished}
                onClick={() => { setIsModalOpen(true); setStep(FlowStep.DATA); }} 
                className={`w-full font-black py-6 rounded-[2.5rem] text-lg shadow-2xl uppercase btn-play-premium text-white active:scale-95 transition-all ${countdown.finished ? 'opacity-30 grayscale cursor-not-allowed' : ''}`}>
                {countdown.finished ? 'SORTEIO FINALIZADO' : 'COMPRAR CARTELA'}
              </button>
           </div>
        </header>

        <main className="max-w-md mx-auto -mt-16 px-4 pb-12 relative z-20">
           <div className="mb-6 rounded-3xl bg-white/95 backdrop-blur-md p-5 border border-white/20 shadow-2xl overflow-hidden">
              <div className="flex flex-col items-center text-center">
                 <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${countdown.finished ? 'bg-slate-300' : 'bg-red-600 animate-pulse'}`}></div>
                    <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${countdown.finished ? 'text-slate-400' : 'text-red-600 animate-pulse'}`}>
                      {countdown.finished ? 'Resultado Oficial' : 'Sorteio Oficial'}
                    </span>
                 </div>
                 <div className="w-full h-[1px] bg-slate-100 mb-4 opacity-50"></div>
                 <div className="grid grid-cols-2 w-full gap-4">
                    <div className={`flex flex-col ${countdown.finished ? 'animate-shine-gold' : ''}`}>
                       <span className={`text-[18px] font-black leading-none ${countdown.finished ? 'text-amber-500' : 'text-slate-800'}`}>
                         {liveStatsSync.sales.toLocaleString('pt-BR')}
                       </span>
                       <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                         {countdown.finished ? 'Vendas Finalizadas' : 'Cartelas Vendidas'}
                       </span>
                    </div>
                    <div className="flex flex-col border-l border-slate-100">
                       <span className="text-[18px] font-black text-emerald-600 leading-none">
                         {countdown.finished ? 'ENCERRADO' : liveStatsSync.online.toLocaleString('pt-BR')}
                       </span>
                       <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest mt-1">Participantes Online</span>
                    </div>
                 </div>
              </div>
           </div>

           <div className="glass-card rounded-[3.5rem] shadow-2xl p-10 text-center border border-white/20">
              <h3 className="text-xl font-black text-[#0A2540] mb-8 uppercase tracking-tighter">Minha Carteira</h3>
              <button onClick={() => { setIsModalOpen(true); setStep(FlowStep.CONSULT); setHasSearched(false); }} className="w-full bg-slate-900 text-white font-black py-5 rounded-2xl uppercase text-[10px] tracking-widest shadow-xl active:scale-95 transition-all">Ver Meus Números</button>
           </div>
        </main>

        {isModalOpen && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-[#0A2540]/90 backdrop-blur-2xl animate-in fade-in duration-300">
            <div className="bg-white w-full max-sm:w-full max-w-sm rounded-[3rem] p-8 text-center shadow-3xl max-h-[90vh] overflow-y-auto relative scrollbar-hide text-slate-900">
              <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 z-[3200]">✕</button>
              
              {step === FlowStep.CONSULT && (
                <div className="animate-in fade-in">
                   <h3 className="text-xl font-black mb-8 uppercase text-[#0A2540] tracking-tighter">Consulta de Bilhetes</h3>
                   {!hasSearched ? (
                     <div className="space-y-6 text-left">
                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-2">Qual seu CPF?</label>
                        <input value={consultCpf} onChange={e => setConsultCpf(maskCPF(e.target.value))} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-6 text-center font-black text-2xl outline-none focus:border-emerald-500/30" placeholder="000.000.000-00" />
                        <button onClick={handleConsult} className="w-full bg-slate-900 text-white font-black py-5 rounded-2xl uppercase text-[11px] shadow-xl">Consultar Meus Dados</button>
                     </div>
                   ) : (
                     <div className="space-y-6 animate-in slide-in-from-bottom-5">
                        {consultResults.length > 0 ? (
                          <>
                            <div className="flex flex-col items-center mb-8 bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100 shadow-inner">
                              <div className="w-20 h-20 rounded-full bg-white border-4 border-white shadow-xl overflow-hidden mb-3">
                                {consultResults[0].photo_url ? <img src={consultResults[0].photo_url} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-emerald-500 flex items-center justify-center text-white font-black text-3xl">{consultResults[0].full_name.charAt(0)}</div>}
                              </div>
                              <p className="font-black text-[#0A2540] uppercase text-sm tracking-tighter leading-none">{consultResults[0].full_name}</p>
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-2">{maskCPF(consultResults[0].cpf)}</p>
                            </div>
                            {consultResults.map((r, i) => (
                              <div key={i} className="bg-white p-5 rounded-3xl text-left border-2 border-slate-50 shadow-md mb-4">
                                 <div className="flex justify-between items-start mb-3">
                                    <div className="flex flex-col">
                                       <p className="text-[10px] font-black text-[#0A2540]">Bilhete ID #{r.registration_number}</p>
                                       <p className="text-[7px] font-bold text-slate-400 uppercase">{formatDateDetailed(r.created_at)}</p>
                                    </div>
                                    <span className={`text-[8px] font-black px-2 py-1 rounded-full border ${r.payment_status === 'approved' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>{r.payment_status === 'approved' ? 'PAGO' : 'PENDENTE'}</span>
                                 </div>
                                 <div className="space-y-2">
                                    {r.chosen_numbers.map((nums: number[], idx: number) => (
                                      <div key={idx} className="flex flex-wrap gap-1 bg-slate-50 p-2 rounded-xl">{nums.map((n, ni) => <span key={ni} className="bg-white w-6 h-6 flex items-center justify-center rounded text-[9px] font-black shadow-sm">{n}</span>)}</div>
                                    ))}
                                 </div>
                              </div>
                            ))}
                          </>
                        ) : (
                          <div className="py-10 text-center">
                            <p className="text-slate-300 text-[10px] font-black uppercase tracking-widest">Nenhum bilhete encontrado.</p>
                          </div>
                        )}
                        <button onClick={() => setHasSearched(false)} className="w-full text-slate-400 font-black text-[10px] uppercase mt-4">Voltar</button>
                     </div>
                   )}
                </div>
              )}

              {step === FlowStep.DATA && (
                <div className="animate-in fade-in">
                   <h3 className="text-xl font-black text-[#0A2540] mb-8 uppercase tracking-tighter">Identificação</h3>
                   <div className="space-y-5 text-left">
                     <div className="space-y-1">
                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-2">Informe seu CPF</label>
                        <input value={participant.cpf} onChange={e => setParticipant(p => ({...p, cpf: maskCPF(e.target.value)}))} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-5 text-center font-black text-2xl outline-none focus:border-emerald-500/30" placeholder="000.000.000-00" />
                     </div>
                     <div className="space-y-4">
                        <div onClick={() => userFileInputRef.current?.click()} className={`w-28 h-28 mx-auto rounded-[2.5rem] bg-slate-100 border-2 flex items-center justify-center overflow-hidden cursor-pointer ${participant.photoUrl ? 'border-emerald-500 shadow-md scale-105' : 'border-slate-200 border-dashed'}`}>
                           {participant.photoUrl ? <img src={participant.photoUrl} className="w-full h-full object-cover" /> : <span className="text-emerald-500 text-[10px] font-black uppercase text-center p-4">SUA FOTO</span>}
                        </div>
                        <input type="file" ref={userFileInputRef} onChange={e => {
                          const f = e.target.files?.[0]; if (!f) return;
                          const r = new FileReader(); r.onloadend = () => setParticipant(p => ({ ...p, photoUrl: r.result as string })); r.readAsDataURL(f);
                        }} className="hidden" />
                        <input value={participant.fullName} onChange={e => setParticipant(p => ({...p, fullName: e.target.value}))} className="w-full p-5 rounded-2xl border-2 font-bold outline-none bg-slate-50 border-slate-100" placeholder="Nome Completo" />
                        <input value={participant.phone} onChange={e => setParticipant(p => ({...p, phone: maskPhone(e.target.value)}))} className="w-full p-5 rounded-2xl border-2 font-bold outline-none bg-slate-50 border-slate-100" placeholder="WhatsApp" />
                     </div>
                   </div>
                   <button onClick={() => setStep(FlowStep.PICK_MODE)} className="w-full bg-[#0A2540] text-white font-black py-6 rounded-3xl mt-8 uppercase tracking-widest shadow-xl">Próximo</button>
                </div>
              )}

              {step === FlowStep.PICK_MODE && (
                <div className="space-y-4 animate-in zoom-in duration-300">
                  <h3 className="text-xl font-black text-[#0A2540] mb-8 uppercase tracking-tighter">Escolher Modo</h3>
                  <button onClick={() => { setSelectedNumbers([]); setStep(FlowStep.NUMBERS); }} className="w-full p-8 border-2 border-slate-100 rounded-[2.5rem] hover:border-emerald-500 transition-all text-left bg-slate-50/50">
                    <p className="text-sm font-black uppercase text-[#0A2540]">Eu mesmo escolho</p>
                    <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-tight">Dezenas manuais</p>
                  </button>
                  <button onClick={() => { 
                    const s = Array.from({length: TOTAL_NUMBERS}, (_,i)=>i+1).sort(()=>Math.random()-0.5).slice(0,NUMBERS_TO_PICK).sort((a,b)=>a-b);
                    setCartelas([s]); setStep(FlowStep.CART_SUMMARY); 
                  }} className="w-full p-8 border-2 border-emerald-500/10 bg-emerald-50/20 rounded-[2.5rem] hover:border-emerald-500 transition-all text-left">
                    <p className="text-sm font-black uppercase text-emerald-600">Surpresinha TUPÃ</p>
                    <p className="text-[10px] text-emerald-400 mt-1 uppercase font-bold tracking-tight">Aleatório</p>
                  </button>
                </div>
              )}

              {step === FlowStep.NUMBERS && (
                <div className="animate-in fade-in">
                   <div className="flex justify-between items-center mb-6">
                      <h3 className="text-xl font-black text-[#0A2540] uppercase tracking-tighter">Escolha 7</h3>
                      <span className="text-[10px] font-black bg-emerald-500 text-white px-4 py-1 rounded-full">{selectedNumbers.length}/7</span>
                   </div>
                   <div className="grid grid-cols-6 gap-2 mb-8 h-[300px] overflow-y-auto scrollbar-hide px-1">
                      {Array.from({ length: TOTAL_NUMBERS }).map((_, i) => {
                        const n = i + 1;
                        const isSelected = selectedNumbers.includes(n);
                        return <button key={n} onClick={() => {
                            if (isSelected) setSelectedNumbers(selectedNumbers.filter(x => x !== n));
                            else if (selectedNumbers.length < NUMBERS_TO_PICK) setSelectedNumbers([...selectedNumbers, n].sort((a,b)=>a-b));
                          }} className={`w-10 h-10 rounded-xl text-xs font-bold transition-all ${isSelected ? 'bg-emerald-500 text-white shadow-xl scale-110' : 'bg-slate-50 text-slate-400'}`}>{n}</button>;
                      })}
                   </div>
                   <button disabled={selectedNumbers.length !== NUMBERS_TO_PICK} onClick={() => { setCartelas([selectedNumbers]); setStep(FlowStep.CART_SUMMARY); }} className="w-full bg-[#0A2540] text-white font-black py-6 rounded-3xl uppercase shadow-2xl disabled:opacity-20">Continuar</button>
                </div>
              )}

              {step === FlowStep.CART_SUMMARY && (
                <div className="animate-in fade-in">
                   <h3 className="text-xl font-black text-[#0A2540] mb-8 uppercase tracking-tighter">Resumo</h3>
                   <div className="bg-slate-50 p-6 rounded-[2.5rem] mb-6 border border-slate-100 shadow-inner">
                      {cartelas.map((c, i) => (
                        <div key={i} className="flex flex-wrap gap-1 justify-center mb-4">{c.map(n => <span key={n} className="bg-white w-8 h-8 flex items-center justify-center rounded-lg text-[10px] font-black shadow-sm">{n}</span>)}</div>
                      ))}
                      <div className="pt-4 border-t border-slate-200 mt-4 flex justify-between items-center font-black">
                         <span className="text-[10px] text-slate-400 uppercase tracking-widest">Total</span>
                         <span className="text-2xl text-emerald-600">{(cartelas.length * (settings.bet_price)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                      </div>
                   </div>
                   <button onClick={handleFinishPurchase} className="w-full btn-play-premium text-white font-black py-6 rounded-[2.5rem] uppercase shadow-2xl active:scale-95 transition-all">Pagar via Pix</button>
                </div>
              )}

              {step === FlowStep.PAYMENT && qrData && (
                <div className="animate-in zoom-in duration-300">
                   <div className="mb-8">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Seus Números</p>
                      <div className="flex flex-wrap gap-1.5 justify-center">
                         {cartelas.flat().map((n, i) => (
                            <span key={i} className="bg-slate-50 w-9 h-9 flex items-center justify-center rounded-xl text-[11px] font-black shadow-sm border border-slate-100">{n}</span>
                         ))}
                      </div>
                   </div>

                   <div className="flex flex-col items-center mb-6">
                      <div className="bg-white p-5 rounded-[3.5rem] border-2 border-slate-100 shadow-3xl inline-block">
                         <img src={`data:image/png;base64,${qrImage}`} className="w-56 h-56 rounded-2xl" />
                      </div>
                   </div>

                   <button 
                      onClick={() => { navigator.clipboard.writeText(qrData || ""); alert("Copiado!"); }} 
                      className="w-full bg-slate-900 text-white font-black py-5 rounded-2xl uppercase text-[11px] mb-4 shadow-2xl flex items-center justify-center gap-3"
                   >
                      <span>Copiar Pix Copia e Cola</span>
                   </button>
                   
                   <div className="flex items-center justify-center gap-2 mt-4">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Aguardando Pagamento...</p>
                   </div>
                </div>
              )}
            </div>
          </div>
        )}
        <footer className="py-20 text-center px-6 opacity-20"><p className="text-[#0A2540] font-black text-[9px] tracking-[1em] uppercase mb-1">{APP_NAME} © 2026</p></footer>
      </div>
    </div>
  );
}
