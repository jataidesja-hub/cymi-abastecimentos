import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 25;

const TAVILY_KEY = process.env.TAVILY_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

// ─── Slugify city name ──────────────────────────────────────────────────────
function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Get state UF from Nominatim ────────────────────────────────────────────
async function getStateUF(cidade: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cidade + ', Brasil')}&format=json&limit=1&addressdetails=1`,
      { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const state = data[0]?.address?.state;
    if (!state) return null;

    // Map full state names to UF codes
    const stateMap: Record<string, string> = {
      'Acre': 'ac', 'Alagoas': 'al', 'Amapá': 'ap', 'Amazonas': 'am',
      'Bahia': 'ba', 'Ceará': 'ce', 'Distrito Federal': 'df',
      'Espírito Santo': 'es', 'Goiás': 'go', 'Maranhão': 'ma',
      'Mato Grosso': 'mt', 'Mato Grosso do Sul': 'ms', 'Minas Gerais': 'mg',
      'Pará': 'pa', 'Paraíba': 'pb', 'Paraná': 'pr', 'Pernambuco': 'pe',
      'Piauí': 'pi', 'Rio de Janeiro': 'rj', 'Rio Grande do Norte': 'rn',
      'Rio Grande do Sul': 'rs', 'Rondônia': 'ro', 'Roraima': 'rr',
      'Santa Catarina': 'sc', 'São Paulo': 'sp', 'Sergipe': 'se', 'Tocantins': 'to',
    };
    return stateMap[state] || state.slice(0, 2).toLowerCase();
  } catch {
    return null;
  }
}

// ─── Extract price from text (e.g. "R$ 6,49" or "6.49") ────────────────────
function extractPrice(text: string): number | null {
  const match = text.match(/R?\$?\s*(\d{1,2})[,.](\d{2})/);
  if (!match) return null;
  const val = parseFloat(`${match[1]}.${match[2]}`);
  return val >= 2 && val <= 20 ? val : null;
}

// ─── Parse prices from HTML text ────────────────────────────────────────────
function parsePricesFromHtml(html: string): Record<string, number | null> {
  const prices: Record<string, number | null> = {
    gasolina_comum: null,
    gasolina_aditivada: null,
    etanol: null,
    diesel_s10: null,
    diesel_s500: null,
    gnv: null,
  };

  // Gaspedia uses patterns like: "Gasolina Comum</...>R$ 6,49"
  // or JSON-LD data, or table rows
  const lower = html.toLowerCase();

  const patterns: [string, keyof typeof prices][] = [
    ['gasolina comum', 'gasolina_comum'],
    ['gasolina aditivada', 'gasolina_aditivada'],
    ['gasolina c', 'gasolina_comum'],
    ['etanol', 'etanol'],
    ['álcool', 'etanol'],
    ['alcool', 'etanol'],
    ['diesel s10', 'diesel_s10'],
    ['diesel s-10', 'diesel_s10'],
    ['diesel s500', 'diesel_s500'],
    ['diesel s-500', 'diesel_s500'],
    ['diesel comum', 'diesel_s500'],
    ['gnv', 'gnv'],
    ['gás natural', 'gnv'],
  ];

  for (const [keyword, field] of patterns) {
    if (prices[field] !== null) continue;
    const idx = lower.indexOf(keyword);
    if (idx === -1) continue;
    // Search for a price in the next 200 chars
    const snippet = html.slice(idx, idx + 200);
    const price = extractPrice(snippet);
    if (price) prices[field] = price;
  }

  return prices;
}

// ─── Scrape Gaspedia ─────────────────────────────────────────────────────────
async function scrapeGaspedia(cidade: string): Promise<Record<string, number | null> | null> {
  const uf = await getStateUF(cidade);
  const slug = slugify(cidade);

  const urls = uf
    ? [`https://gaspedia.com.br/cidade/${slug}-${uf}`, `https://gaspedia.com.br/pesquisa?q=${encodeURIComponent(cidade)}`]
    : [`https://gaspedia.com.br/pesquisa?q=${encodeURIComponent(cidade)}`];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://gaspedia.com.br/',
    'Cache-Control': 'no-cache',
  };

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const html = await res.text();
      const prices = parsePricesFromHtml(html);
      const hasAny = Object.values(prices).some(v => v !== null && v > 0);
      if (hasAny) {
        console.log('[Gaspedia] Preços encontrados para', cidade, 'via', url);
        return prices;
      }
    } catch (e: any) {
      console.log('[Gaspedia] Falhou:', url, e.message);
    }
  }
  return null;
}

// ─── Tavily + Groq fallback ──────────────────────────────────────────────────
async function getPricesViaAI(cidade: string): Promise<{ prices: Record<string, number | null>; fonte: string } | null> {
  if (!TAVILY_KEY || !GROQ_KEY) return null;

  try {
    const tavilyRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query: `preço gasolina etanol diesel ${cidade} Brasil ${new Date().getFullYear()} posto combustivel`,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!tavilyRes.ok) return null;
    const tavilyData = await tavilyRes.json();

    const context = [
      tavilyData.answer || '',
      ...(tavilyData.results || []).map((r: any) => `${r.title}: ${r.content || ''}`).slice(0, 4),
    ].join('\n').slice(0, 3000);

    if (!context.trim()) return null;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'system',
          content: 'Você extrai preços de combustível de textos. Retorne SOMENTE JSON válido, sem explicação, sem markdown.',
        }, {
          role: 'user',
          content: `Do texto abaixo, extraia os preços médios de combustível em ${cidade}, Brasil.
Formato obrigatório (use null se não encontrado):
{"gasolina_comum":6.49,"gasolina_aditivada":6.89,"etanol":4.29,"diesel_s10":6.19,"diesel_s500":5.99,"gnv":4.50}

Texto:
${context}`,
        }],
        temperature: 0.05,
        max_tokens: 150,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!groqRes.ok) return null;
    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content?.trim() || '';
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return null;

    const prices = JSON.parse(match[0]);
    const hasValid = Object.values(prices).some(v => typeof v === 'number' && (v as number) > 0);
    if (!hasValid) return null;

    return { prices, fonte: 'Tavily + Groq AI' };
  } catch (e: any) {
    console.log('[Tavily+Groq] Erro:', e.message);
    return null;
  }
}

// ─── ANP regional averages (hardcoded from latest ANP report as last resort) ─
const ANP_AVERAGES: Record<string, Record<string, number>> = {
  default: { gasolina_comum: 6.29, gasolina_aditivada: 6.69, etanol: 4.21, diesel_s10: 6.08, diesel_s500: 5.89, gnv: 4.39 },
  nordeste: { gasolina_comum: 6.35, gasolina_aditivada: 6.75, etanol: 4.35, diesel_s10: 6.12, diesel_s500: 5.92, gnv: 4.42 },
  sudeste: { gasolina_comum: 6.18, gasolina_aditivada: 6.58, etanol: 4.05, diesel_s10: 6.01, diesel_s500: 5.82, gnv: 4.31 },
  sul: { gasolina_comum: 6.22, gasolina_aditivada: 6.62, etanol: 4.12, diesel_s10: 6.05, diesel_s500: 5.85, gnv: 4.35 },
  norte: { gasolina_comum: 6.52, gasolina_aditivada: 6.92, etanol: 4.51, diesel_s10: 6.25, diesel_s500: 6.05, gnv: 4.55 },
  centroeste: { gasolina_comum: 6.31, gasolina_aditivada: 6.71, etanol: 4.18, diesel_s10: 6.09, diesel_s500: 5.88, gnv: 4.40 },
};

const NORDESTE_UFS = ['al', 'ba', 'ce', 'ma', 'pb', 'pe', 'pi', 'rn', 'se'];
const SUDESTE_UFS = ['es', 'mg', 'rj', 'sp'];
const SUL_UFS = ['pr', 'rs', 'sc'];
const NORTE_UFS = ['ac', 'am', 'ap', 'pa', 'ro', 'rr', 'to'];

async function getRegionalANP(cidade: string): Promise<{ prices: Record<string, number>; fonte: string }> {
  const uf = await getStateUF(cidade);
  let region = 'default';
  if (uf && NORDESTE_UFS.includes(uf)) region = 'nordeste';
  else if (uf && SUDESTE_UFS.includes(uf)) region = 'sudeste';
  else if (uf && SUL_UFS.includes(uf)) region = 'sul';
  else if (uf && NORTE_UFS.includes(uf)) region = 'norte';
  else if (uf && ['df', 'go', 'ms', 'mt'].includes(uf)) region = 'centroeste';

  return {
    prices: ANP_AVERAGES[region],
    fonte: `Média regional ANP (${region}) — dados ANP 2025`,
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const cidade = (new URL(request.url).searchParams.get('cidade') || '').trim();
  if (!cidade) return NextResponse.json({ error: 'cidade obrigatória' }, { status: 400 });

  // 1. Try Gaspedia scraping (primary — real current prices)
  const gaspediaResult = await scrapeGaspedia(cidade);
  if (gaspediaResult) {
    const hasValid = Object.values(gaspediaResult).some(v => v !== null && (v as number) > 0);
    if (hasValid) {
      return NextResponse.json({ prices: gaspediaResult, fonte: 'Gaspedia.com.br' });
    }
  }

  // 2. Try Tavily + Groq AI search
  const aiResult = await getPricesViaAI(cidade);
  if (aiResult) {
    return NextResponse.json({ prices: aiResult.prices, fonte: aiResult.fonte });
  }

  // 3. Fallback: ANP regional averages
  const anpResult = await getRegionalANP(cidade);
  return NextResponse.json({ prices: anpResult.prices, fonte: anpResult.fonte });
}
