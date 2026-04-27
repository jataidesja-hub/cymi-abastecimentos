import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Converte "01/04/2026 05:00:58" → "2026-04-01T05:00:58"
function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // DD/MM/YYYY HH:MM:SS
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}`;
  // Já está em formato ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  return null;
}

// Remove "R$", converte formato BR (1.234,56 → 1234.56) → número
function parseDecimal(raw: string): number | null {
  if (raw == null || raw === '') return null;
  let s = String(raw).replace(/R\$\s*/g, '').trim();
  // Formato BR: ponto como milhar e vírgula como decimal (ex: 1.200,49 ou 7,790)
  if (/\d+\.\d{3},\d/.test(s)) {
    // tem ponto de milhar e vírgula decimal: 1.200,49 → 1200.49
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/,/.test(s)) {
    // só vírgula decimal: 7,790 → 7.790
    s = s.replace(',', '.');
  }
  // caso já esteja com ponto decimal: 7.79
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Detecta qual coluna do CSV corresponde a cada campo
function detectColumns(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const norm = (s: string) => s.toUpperCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

  const rules: [string, string[]][] = [
    ['data_transacao',       ['DATA TRANSACAO', 'DATA']],
    ['tipo_combustivel',     ['TIPO COMBUSTIVEL', 'COMBUSTIVEL', 'TIPO']],
    ['litros',               ['LITROS', 'VOLUME']],
    ['vl_litro',             ['VL LITRO', 'VLITRO', 'VALOR LITRO', 'PRECO LITRO', 'VL L']],
    ['valor_emissao',        ['VALOR EMISSAO', 'VALOR TOTAL', 'TOTAL', 'EMISSAO']],
    ['nome_estabelecimento', ['NOME ESTABELECIMENTO', 'ESTABELECIMENTO', 'POSTO', 'NOME']],
    ['endereco',             ['ENDERECO', 'ENDEREÇO', 'RUA', 'LOGRADOURO']],
    ['bairro',               ['BAIRRO']],
    ['cidade',               ['CIDADE', 'MUNICIPIO', 'MUNICÍPIO']],
    ['uf',                   ['UF', 'ESTADO', 'SIGLA']],
  ];

  for (const [field, candidates] of rules) {
    for (let i = 0; i < headers.length; i++) {
      const h = norm(headers[i]);
      if (candidates.some(c => h.includes(c))) {
        if (!(field in map)) map[field] = i;
        break;
      }
    }
  }
  return map;
}

// Detecta se o CSV usa ; ou , como separador de colunas
// CSV brasileiro usa ; porque a vírgula é decimal
function detectDelimiter(headerLine: string): ';' | ',' {
  const semis = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return semis >= commas ? ';' : ',';
}

function parseLine(line: string, delimiter: ';' | ','): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === delimiter && !inQuote) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const delimiter = detectDelimiter(lines[0]);
  return lines.map(line => parseLine(line, delimiter));
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });

    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 2) return NextResponse.json({ error: 'CSV vazio ou inválido' }, { status: 400 });

    const headers = rows[0];
    const colMap = detectColumns(headers);

    const required = ['data_transacao', 'tipo_combustivel', 'vl_litro', 'nome_estabelecimento', 'cidade', 'uf'];
    const missing = required.filter(f => !(f in colMap));
    if (missing.length > 0) {
      return NextResponse.json({
        error: `Colunas não encontradas: ${missing.join(', ')}`,
        headers_detectados: headers,
        mapeamento: colMap,
      }, { status: 400 });
    }

    const records: any[] = [];
    const erros: string[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every(c => !c)) continue;

      const get = (field: string) => colMap[field] !== undefined ? (row[colMap[field]] || '') : '';

      const data_transacao = parseDate(get('data_transacao'));
      const vl_litro = parseDecimal(get('vl_litro'));
      const nome = get('nome_estabelecimento').trim();
      const cidade = get('cidade').trim().toUpperCase();
      const uf = get('uf').trim().toUpperCase();

      if (!data_transacao) { erros.push(`Linha ${i + 1}: data inválida "${get('data_transacao')}"`); continue; }
      if (!vl_litro || vl_litro <= 0) { erros.push(`Linha ${i + 1}: preço inválido "${get('vl_litro')}"`); continue; }
      if (!nome) { erros.push(`Linha ${i + 1}: nome do estabelecimento vazio`); continue; }
      if (!cidade) { erros.push(`Linha ${i + 1}: cidade vazia`); continue; }
      if (!uf) { erros.push(`Linha ${i + 1}: UF vazia`); continue; }

      records.push({
        data_transacao,
        tipo_combustivel: get('tipo_combustivel').trim() || 'DESCONHECIDO',
        litros: parseDecimal(get('litros')),
        vl_litro,
        valor_emissao: parseDecimal(get('valor_emissao')),
        nome_estabelecimento: nome,
        endereco: get('endereco').trim() || null,
        bairro: get('bairro').trim() || null,
        cidade,
        uf,
      });
    }

    if (!records.length) {
      return NextResponse.json({ error: 'Nenhum registro válido encontrado', erros }, { status: 400 });
    }

    // Upsert em lotes de 500
    const supabase = getSupabase();
    const BATCH = 500;
    let inserted = 0;
    const dbErrors: string[] = [];

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const { error } = await supabase.from('abastecimentos').insert(batch);
      if (error) dbErrors.push(error.message);
      else inserted += batch.length;
    }

    return NextResponse.json({
      ok: true,
      total_linhas: rows.length - 1,
      importados: inserted,
      ignorados: records.length - inserted,
      erros_formato: erros.slice(0, 20),
      erros_banco: dbErrors,
      mapeamento_colunas: colMap,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
