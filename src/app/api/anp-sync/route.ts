import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

export const maxDuration = 60;

const ANP_URL = 'https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/precos-revenda-e-de-distribuicao-combustiveis/shlp/semanal/semanal-municipios-2026.xlsx';

const PRODUTO_MAP: Record<string, string> = {
  'GASOLINA COMUM':    'Gasolina Comum',
  'GASOLINA':          'Gasolina Comum',
  'GASOLINA ADITIVADA':'Gasolina Aditivada',
  'ETANOL HIDRATADO':  'Etanol',
  'ETANOL':            'Etanol',
  'ALCOOL':            'Etanol',
  'DIESEL S10':        'Diesel S10',
  'DIESEL S-10':       'Diesel S10',
  'DIESEL S500':       'Diesel S500',
  'DIESEL S-500':      'Diesel S500',
  'DIESEL':            'Diesel S10',
  'GNV':               'GNV',
  'GAS NATURAL':       'GNV',
};

function normalizeProduto(raw: string): string | null {
  const upper = raw.toUpperCase().trim();
  for (const [key, val] of Object.entries(PRODUTO_MAP)) {
    if (upper.includes(key)) return val;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase não configurado' }, { status: 503 });
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Baixa o XLSX da ANP
  let buffer: ArrayBuffer;
  try {
    const res = await fetch(ANP_URL, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return NextResponse.json({ error: `ANP retornou ${res.status}` }, { status: 502 });
    buffer = await res.arrayBuffer();
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  // Parseia XLSX
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

  if (!rows.length) return NextResponse.json({ error: 'Planilha vazia' }, { status: 500 });

  // Detecta colunas (ANP muda nomes às vezes)
  const cols = Object.keys(rows[0]).map(k => k.toUpperCase().trim());
  const findCol = (candidates: string[]) =>
    Object.keys(rows[0]).find(k => candidates.some(c => k.toUpperCase().includes(c))) || '';

  const colMunicipio = findCol(['MUNICIPIO', 'MUNICÍPIO', 'MUNIC']);
  const colEstado    = findCol(['ESTADO', 'UF', 'SIGLA']);
  const colProduto   = findCol(['PRODUTO', 'COMBUSTIVEL', 'COMBUST']);
  const colPreco     = findCol(['PREÇO MÉDIO REVENDA', 'PRECO MEDIO', 'VENDA', 'MÉDIO']);
  const colData      = findCol(['DATA', 'SEMANA', 'PERÍODO']);

  if (!colMunicipio || !colProduto || !colPreco) {
    return NextResponse.json({ error: 'Colunas não encontradas', cols }, { status: 500 });
  }

  // Agrupa por municipio + produto → última semana disponível
  const cityMap = new Map<string, { municipio: string; estado: string; produto: string; preco: number; data: string }>();

  for (const row of rows) {
    const municipio = String(row[colMunicipio] || '').trim().toUpperCase();
    const estado    = String(row[colEstado] || '').trim().toLowerCase();
    const produtoRaw = String(row[colProduto] || '').trim();
    const produto   = normalizeProduto(produtoRaw);
    const precoRaw  = row[colPreco];
    const data      = String(row[colData] || '').trim();

    if (!municipio || !produto || precoRaw == null) continue;
    const preco = typeof precoRaw === 'number' ? precoRaw : parseFloat(String(precoRaw).replace(',', '.'));
    if (isNaN(preco) || preco <= 0 || preco > 20) continue;

    const key = `${municipio}|${estado}|${produto}`;
    const existing = cityMap.get(key);
    // Mantém o registro mais recente (maior data)
    if (!existing || data > existing.data) {
      cityMap.set(key, { municipio, estado, produto, preco, data });
    }
  }

  const records = Array.from(cityMap.values());
  if (!records.length) return NextResponse.json({ error: 'Nenhum registro processado' }, { status: 500 });

  // Upsert em lotes de 500
  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH).map(r => ({
      municipio: r.municipio,
      estado: r.estado,
      produto: r.produto,
      preco_medio: r.preco,
      data_coleta: r.data || new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('anp_city_prices')
      .upsert(batch, { onConflict: 'municipio,estado,produto' });
    if (error) console.error('Upsert error:', error.message);
    else inserted += batch.length;
  }

  return NextResponse.json({ ok: true, total: records.length, inserted });
}
