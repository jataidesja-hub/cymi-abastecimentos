import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export type FuelStation = {
  id: string;
  osm_id?: number | null;
  nome: string;
  bandeira: string;
  endereco: string;
  cidade: string;
  estado: string;
  latitude: number;
  longitude: number;
  ticket_log?: boolean;
  created_at: string;
};

export type FuelPrice = {
  id: string;
  station_id: string;
  tipo_combustivel: string;
  preco: number;
  data_atualizacao: string;
  reportado_por: string;
  stations?: FuelStation;
};
