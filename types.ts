
export interface Participant {
  fullName: string;
  cpf: string;
  phone: string;
  email: string;
  photoUrl?: string;
}

export interface Partner {
  id?: string;
  name: string;
  cpf: string;
  photo_url: string;
  referral_code: string;
  created_at?: string;
}

export interface ParticipationRecord {
  id: string;
  registration_number: number;
  full_name: string;
  cpf: string;
  phone: string;
  email: string;
  photo_url?: string;
  chosen_numbers: number[][];
  payment_status: string;
  payment_id: string;
  total_amount: number;
  referral_code?: string;
  created_at: string;
}

export enum FlowStep {
  HOME = 'home',
  DATA = 'data',
  PICK_MODE = 'pick_mode',
  NUMBERS = 'numbers',
  CART_SUMMARY = 'cart_summary',
  PAYMENT = 'payment',
  SUCCESS = 'success',
  CONSULT = 'consult',
  ADMIN = 'admin'
}

export interface AppSettings {
  prize_value: number;
  draw_date: string;
  winning_numbers: number[];
  is_active: boolean;
  bet_price: number;
  referral_discount: number;
}

export interface MercadoPagoPreference {
  id: string;
  init_point: string;
}
