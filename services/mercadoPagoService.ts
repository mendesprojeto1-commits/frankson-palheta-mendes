
import { Participant } from '../types';

// Credenciais oficiais
const ACCESS_TOKEN = 'APP_USR-3997460405806111-120723-d787e23deb3a41b260207a736491077d-3048408805';
export const PUBLIC_KEY = 'APP_USR-42fb2f63-1781-498f-a91e-cd1159ac9424';

const WEBHOOK_URL = 'https://kbvqzzdnicehwarmlvme.supabase.co/functions/v1/mercadopago-webhook';

/**
 * Gera um pagamento PIX utilizando a API de Payments
 */
export const createRealQRPreference = async (
  participant: Participant,
  totalAmount: number,
  ticketCount: number
) => {
  const idempotencyKey = `tupa-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const external_reference = `TUPA_${participant.cpf.replace(/\D/g, '')}_${Date.now()}`;
  
  const targetUrl = 'https://api.mercadopago.com/v1/payments';
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
  
  const [firstName, ...lastNameParts] = (participant.fullName || 'Participante').trim().split(' ');
  const lastName = lastNameParts.join(' ') || 'TUPÃ';

  try {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        transaction_amount: Number(totalAmount.toFixed(2)),
        description: `Mega TUPÃ - ${ticketCount} Bilhete(s)`,
        external_reference: external_reference,
        notification_url: WEBHOOK_URL,
        payment_method_id: "pix",
        payer: {
          email: participant.email.trim().toLowerCase() || 'financeiro@tupa.com',
          first_name: firstName,
          last_name: lastName,
          identification: {
            type: "CPF",
            number: participant.cpf.replace(/\D/g, "")
          }
        }
      })
    });

    const data = await response.json();
    
    if (!response.ok || !data.id) {
      console.error('Erro MP:', data);
      throw new Error(data.message || 'Erro na API Mercado Pago');
    }

    return {
      qr_data: data.point_of_interaction?.transaction_data?.qr_code,
      qr_image_base64: data.point_of_interaction?.transaction_data?.qr_code_base64,
      payment_id: data.id,
      status: data.status
    };
  } catch (error) {
    console.error('Erro Fatal ao gerar PIX:', error);
    throw error;
  }
};

/**
 * Consulta os detalhes completos de um pagamento, incluindo QR Code para pendentes.
 */
export const getPaymentDetails = async (paymentId: string | number) => {
  const timestamp = Date.now();
  const targetUrl = `https://api.mercadopago.com/v1/payments/${paymentId}?cb=${timestamp}`;
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

  try {
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Cache-Control': 'no-cache'
      }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    return null;
  }
};

/**
 * Consulta o status diretamente no Mercado Pago via Proxy.
 */
export const getUniversalStatus = async (paymentId: string | number) => {
  if (!paymentId) return 'pending';
  const data = await getPaymentDetails(paymentId);
  if (!data) return 'pending';
  
  const status = data.status;
  const positiveStatus = ['approved', 'accredited', 'authorized', 'in_process', 'in_mediation'];
  
  if (positiveStatus.includes(status)) {
    return 'approved';
  }
  return status;
};
