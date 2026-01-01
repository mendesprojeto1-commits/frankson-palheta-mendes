
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

/**
 * SQL PARA EXECUÇÃO NO SUPABASE (SQL Editor)
 * -----------------------------------------
 * 
 * -- 1. Criar Tabela de Parceiros
 * CREATE TABLE IF NOT EXISTS public.partners (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     name TEXT NOT NULL,
 *     cpf TEXT NOT NULL UNIQUE,
 *     photo_url TEXT NOT NULL,
 *     referral_code TEXT NOT NULL UNIQUE,
 *     created_at TIMESTAMPTZ DEFAULT NOW()
 * );
 * 
 * -- 2. Adicionar colunas de controle em app_settings
 * ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS bet_price DECIMAL(10,2) DEFAULT 9.99;
 * ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS referral_discount DECIMAL(10,2) DEFAULT 1.00;
 * 
 * -- 3. Adicionar coluna de indicação em registrations
 * ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS referral_code TEXT;
 * 
 * -- 4. Habilitar permissões (se necessário)
 * ALTER TABLE partners DISABLE ROW LEVEL SECURITY;
 */

const supabaseUrl = 'https://kbvqzzdnicehwarmlvme.supabase.co';
const supabaseKey = 'sb_publishable_wm55dpeLcrygTtm4LxumXg_9ArTDohc';

export const supabase = createClient(supabaseUrl, supabaseKey);
