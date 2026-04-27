import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const ALL_FUELS = ['Gasolina Comum', 'Gasolina Aditivada', 'Etanol', 'Diesel S10', 'Diesel S500', 'GNV'];

// Normaliza tipo combustível do CSV para o padrão do app
const COMBUSTIVEL_MAP: Record<string, string> = {
  'GASOLINA COMUM':          'Gasolina Comum',
  'GASOLINA ADITIVADA':      'Gasolina Aditivada',
  'GASOLINA':                'Gasolina Comum',
  'ETANOL HIDRATADO':        'Etanol',
  'ETANOL':                  'Etanol',
  'ALCOOL':                  'Etanol',
  'DIESEL S-10 COMUM':       'Diesel S10',
  'DIESEL S10 COMUM':        'Diesel S10',
  'DIESEL S-10':             'Diesel S10',
  'DIESEL S10':              'Diesel S10',
  'DIESEL S-10 ADITIVADO':   'Diesel S10',
  'DIESEL S10 ADITIVADO':    'Diesel S10',
  'DIESEL S-500':            'Diesel S500',
  'DIESEL S500':             'Diesel S500',
  'DIESEL S-500 COMUM':      'Diesel S500',
  'DIESEL':                  'Diesel S10',
  'GNV':                     'GNV',
  'GAS NATURAL':             'GNV',
};

function normalizeCombustivel(raw: string): string {
  const upper = raw.toUpperCase().trim();
  for (const [key, val] of Object.entries(COMBUSTIVEL_MAP)) {
    if (upper.includes(key)) return val;
  }
  return raw; // retorna original se não mapear
}

// ─── Supabase client ──────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

// ─── Busca postos na cidade via abastecimentos ────────────────────────────────
interface PostoData {
  nome: string;
  endereco: string;
  bairro: string;
  cidade: string;
  uf: string;
  precos: Record<string, { preco: number; data: string }>;
}

async function getPostosByCidade(cidade: string, uf: string): Promise<PostoData[]> {
  const supabase = getSupabase();
  const cidadeUpper = cidade.toUpperCase().trim();

  const { data, error } = await supabase
    .from('latest_abastecimento_prices')
    .select('nome_estabelecimento, endereco, bairro, cidade, uf, tipo_combustivel, preco, data_transacao')
    .ilike('cidade', cidadeUpper)
    .eq('uf', uf.toUpperCase());

  if (error || !data?.length) return [];

  // Agrupa por posto
  const map = new Map<string, PostoData>();
  for (const r of data) {
    const nome = r.nome_estabelecimento as string;
    if (!map.has(nome)) {
      map.set(nome, {
        nome,
        endereco: r.endereco || '',
        bairro: r.bairro || '',
        cidade: r.cidade,
        uf: r.uf,
        precos: {},
      });
    }
    const tipo = normalizeCombustivel(r.tipo_combustivel as string);
    map.get(nome)!.precos[tipo] = {
      preco: Number(r.preco),
      data: r.data_transacao as string,
    };
  }

  return Array.from(map.values());
}

// ─── Preços reportados por usuários via Supabase ──────────────────────────────
async function getUserReportedPrices(cidade: string): Promise<Map<string, Record<string, { preco: number; data: string }>>> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('latest_prices')
      .select('nome, tipo_combustivel, preco, data_atualizacao')
      .eq('cidade', cidade);
    if (!data?.length) return new Map();
    const map = new Map<string, Record<string, { preco: number; data: string }>>();
    for (const r of data) {
      const key = (r.nome as string).toLowerCase().replace(/\s+/g, '');
      if (!map.has(key)) map.set(key, {});
      map.get(key)![r.tipo_combustivel] = { preco: Number(r.preco), data: r.data_atualizacao };
    }
    return map;
  } catch { return new Map(); }
}

// ─── Geocoding: Google Maps ou Nominatim ─────────────────────────────────────
async function geocodeStation(nome: string, endereco: string, bairro: string, cidade: string, _uf: string, apiKey: string): Promise<{ lat: number; lon: number } | null> {
  // Tenta com endereço completo primeiro
  const query = [endereco, bairro, cidade, 'Brasil'].filter(Boolean).join(', ');
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`,
      { signal: AbortSignal.timeout(4000) }
    );
    const json = await res.json();
    const loc = json.results?.[0]?.geometry?.location;
    if (loc) return { lat: loc.lat, lon: loc.lng };
  } catch { /* continua */ }

  // Fallback: nome do posto + cidade
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(nome + ', ' + cidade + ', Brasil')}&key=${apiKey}`,
      { signal: AbortSignal.timeout(4000) }
    );
    const json = await res.json();
    const loc = json.results?.[0]?.geometry?.location;
    if (loc) return { lat: loc.lat, lon: loc.lng };
  } catch { /* continua */ }

  return null;
}

async function geocodeWithCache(
  nome: string, endereco: string, bairro: string, cidade: string, uf: string, apiKey: string
): Promise<{ lat: number; lon: number } | null> {
  const supabase = getSupabase();

  // Verifica cache no Supabase
  const { data: cached } = await supabase
    .from('station_locations')
    .select('latitude, longitude')
    .eq('nome_estabelecimento', nome)
    .eq('cidade', cidade.toUpperCase())
    .eq('uf', uf.toUpperCase())
    .maybeSingle();

  if (cached?.latitude) return { lat: cached.latitude, lon: cached.longitude };

  // Chama Google Maps
  if (!apiKey) return null;
  const coords = await geocodeStation(nome, endereco, bairro, cidade, uf, apiKey);
  if (!coords) return null;

  // Salva no cache
  await supabase.from('station_locations').upsert({
    nome_estabelecimento: nome,
    cidade: cidade.toUpperCase(),
    uf: uf.toUpperCase(),
    latitude: coords.lat,
    longitude: coords.lon,
  }, { onConflict: 'nome_estabelecimento,cidade,uf' });

  return coords;
}

// ─── Geocoding da cidade (centro) ─────────────────────────────────────────────
async function getCityCenter(cidade: string, uf: string, apiKey: string): Promise<{ lat: number; lon: number; uf: string }> {
  if (apiKey) {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(cidade + ', ' + uf + ', Brasil')}&key=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      const json = await res.json();
      const loc = json.results?.[0]?.geometry?.location;
      if (loc) return { lat: loc.lat, lon: loc.lng, uf };
    } catch { /* continua */ }
  }

  // Fallback Nominatim
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cidade + ', Brasil')}&format=json&limit=1&addressdetails=1&countrycodes=br`,
      { headers: { 'User-Agent': 'MAPM-App/1.0' }, signal: AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    const loc = data[0];
    if (loc) return { lat: parseFloat(loc.lat), lon: parseFloat(loc.lon), uf };
  } catch { /* continua */ }

  return { lat: -14.24, lon: -51.93, uf };
}

// ─── Resolve UF da cidade ─────────────────────────────────────────────────────
async function resolveUF(cidade: string, apiKey: string): Promise<string> {
  // Tenta Google Maps
  if (apiKey) {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(cidade + ', Brasil')}&key=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      const json = await res.json();
      const uf = json.results?.[0]?.address_components
        ?.find((c: any) => c.types.includes('administrative_area_level_1'))
        ?.short_name?.toLowerCase();
      if (uf) return uf;
    } catch { /* continua */ }
  }

  // Fallback Nominatim
  const stateMap: Record<string, string> = {
    'Acre': 'ac', 'Alagoas': 'al', 'Amapá': 'ap', 'Amazonas': 'am', 'Bahia': 'ba',
    'Ceará': 'ce', 'Distrito Federal': 'df', 'Espírito Santo': 'es', 'Goiás': 'go',
    'Maranhão': 'ma', 'Mato Grosso': 'mt', 'Mato Grosso do Sul': 'ms',
    'Minas Gerais': 'mg', 'Pará': 'pa', 'Paraíba': 'pb', 'Paraná': 'pr',
    'Pernambuco': 'pe', 'Piauí': 'pi', 'Rio de Janeiro': 'rj',
    'Rio Grande do Norte': 'rn', 'Rio Grande do Sul': 'rs', 'Rondônia': 'ro',
    'Roraima': 'rr', 'Santa Catarina': 'sc', 'São Paulo': 'sp', 'Sergipe': 'se',
    'Tocantins': 'to',
  };
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cidade + ', Brasil')}&format=json&limit=1&addressdetails=1&countrycodes=br`,
      { headers: { 'User-Agent': 'MAPM-App/1.0' }, signal: AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    return stateMap[data[0]?.address?.state || ''] || '';
  } catch { return ''; }
}

// ─── dedurapreco fallback ─────────────────────────────────────────────────────
function toSlug(str: string): string {
  return str.toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

const UF_SLUG: Record<string, string> = {
  ac:'acre',al:'alagoas',ap:'amapa',am:'amazonas',ba:'bahia',ce:'ceara',
  df:'distrito-federal',es:'espirito-santo',go:'goias',ma:'maranhao',
  mt:'mato-grosso',ms:'mato-grosso-do-sul',mg:'minas-gerais',pa:'para',
  pb:'paraiba',pr:'parana',pe:'pernambuco',pi:'piaui',rj:'rio-de-janeiro',
  rn:'rio-grande-do-norte',rs:'rio-grande-do-sul',ro:'rondonia',rr:'roraima',
  sc:'santa-catarina',sp:'sao-paulo',se:'sergipe',to:'tocantins',
};

interface DeduraStation { nome: string; endereco: string; bandeira: string; precos: Record<string, number> }

function decodeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, ' ');
}

function parseDedura(html: string): { stations: DeduraStation[]; bestPrices: Record<string, { preco: number; posto: string }> } {
  const stations: DeduraStation[] = [];
  const bestPrices: Record<string, { preco: number; posto: string }> = {};
  const fuelLabels: Record<string, string> = {
    'gasolina comum': 'Gasolina Comum', 'gasolina aditivada': 'Gasolina Aditivada',
    'etanol': 'Etanol', 'diesel s10': 'Diesel S10', 'diesel s500': 'Diesel S500',
    'diesel': 'Diesel S10', 'gnv': 'GNV',
  };

  const strippedFull = html.replace(/<[^>]+>/g, ' ');
  for (const [label, tipo] of Object.entries(fuelLabels)) {
    const re = new RegExp(`${label}[\\s\\S]{0,80}?R\\$\\s*([\\d,\\.]+)[\\s\\S]{0,60}?([A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ][A-ZÀ-Ú\\s&.,\\-]{3,60})`, 'gi');
    const m = re.exec(strippedFull);
    if (m && !bestPrices[tipo]) {
      const preco = parseFloat(m[1].replace(',', '.'));
      const posto = m[2].trim().replace(/\s+/g, ' ');
      if (preco > 1 && preco < 20 && posto.length > 2) bestPrices[tipo] = { preco, posto };
    }
  }

  const blocks = html.split(/<h3[\s>]/i);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const nomeM = block.match(/^[^>]*>([^<]{2,120})<\/h3>/i);
    if (!nomeM) continue;
    const nome = decodeHtml(nomeM[1].trim().replace(/\s+/g, ' '));
    if (nome.length < 2 || /melhores|preços|postos|busca|filtro|cidade/i.test(nome)) continue;

    const endM = block.match(/(?:Rua|Avenida|Av\b|Rod(?:ovia)?\.?|Alameda|Travessa|Praça|Estrada|BR-?\d{2,3}|Largo)[^<]{5,150}/i);
    const endereco = endM ? decodeHtml(endM[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()) : '';

    let bandeira = 'Branco';
    if (/petrobras|br distribui/i.test(block)) bandeira = 'Petrobras';
    else if (/ipiranga/i.test(block)) bandeira = 'Ipiranga';
    else if (/shell|raizen/i.test(block)) bandeira = 'Shell';
    else if (/\bale\b/i.test(block)) bandeira = 'Ale';

    const precos: Record<string, number> = {};
    const stripped = block.replace(/<[^>]+>/g, ' ');
    for (const [label, tipo] of Object.entries(fuelLabels)) {
      if (precos[tipo]) continue;
      const re = new RegExp(`${label}[\\s\\S]{0,80}?R\\$\\s*([\\d]+[,.]\\d{2,3})`, 'i');
      const m = stripped.match(re);
      if (m) { const v = parseFloat(m[1].replace(',', '.')); if (v > 1 && v < 20) precos[tipo] = v; }
    }
    stations.push({ nome, endereco, bandeira, precos });
  }
  return { stations: stations.slice(0, 25), bestPrices };
}

async function fetchDedura(cidade: string, uf: string) {
  const stateSlug = UF_SLUG[uf];
  if (!stateSlug) return { stations: [] as DeduraStation[], bestPrices: {} as Record<string, { preco: number; posto: string }> };
  try {
    const res = await fetch(
      `https://dedurapreco.com/preco-do-combustivel/${stateSlug}/${toSlug(cidade)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html', 'Accept-Language': 'pt-BR,pt;q=0.9',
        },
        signal: AbortSignal.timeout(9000),
      }
    );
    if (!res.ok) return { stations: [] as DeduraStation[], bestPrices: {} as Record<string, { preco: number; posto: string }> };
    return parseDedura(await res.text());
  } catch { return { stations: [] as DeduraStation[], bestPrices: {} as Record<string, { preco: number; posto: string }> }; }
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cidade = (searchParams.get('cidade') || '').trim();
  if (!cidade) return NextResponse.json({ error: 'Informe cidade' }, { status: 400 });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';

  // Resolve UF
  const uf = await resolveUF(cidade, apiKey);
  if (!uf) return NextResponse.json({ error: 'Cidade não encontrada no Brasil' }, { status: 404 });

  // Busca dados em paralelo: abastecimentos (frota) + dedurapreco + preços de usuários
  const [postosFrota, { stations: deduraStations, bestPrices }, userPrices, cityCenter] = await Promise.all([
    getPostosByCidade(cidade, uf),
    fetchDedura(cidade, uf),
    getUserReportedPrices(cidade),
    getCityCenter(cidade, uf, apiKey),
  ]);

  // ── Monta resultado principal: postos da base de frota ──────────────────────
  const results: any[] = [];

  // Geocodifica postos da frota em lotes de 4
  const BATCH = 4;
  for (let i = 0; i < postosFrota.length; i += BATCH) {
    const batch = postosFrota.slice(i, i + BATCH);
    const geocoded = await Promise.all(batch.map(async (posto, idx) => {
      const coords = await geocodeWithCache(posto.nome, posto.endereco, posto.bairro, cidade, uf, apiKey)
        || { lat: cityCenter.lat + (Math.random() - 0.5) * 0.02, lon: cityCenter.lon + (Math.random() - 0.5) * 0.02 };

      const stationId = `frota-${i + idx}`;
      const nomeNorm = posto.nome.toLowerCase().replace(/\s+/g, '');
      const userPostoPrices = userPrices.get(nomeNorm) || {};

      const stationInfo = {
        id: stationId, osm_id: null,
        nome: posto.nome, bandeira: 'Branco',
        endereco: [posto.endereco, posto.bairro].filter(Boolean).join(', ') || cidade,
        cidade, estado: uf.toUpperCase(),
        latitude: coords.lat, longitude: coords.lon,
        ticket_log: true,
      };

      const entries: any[] = [];
      for (const tipo of ALL_FUELS) {
        let preco = 0;
        let fonte = 'Ticket Log';
        let dataAtualizacao = new Date().toISOString();

        // Prioridade 1: preço reportado manualmente pelo usuário
        if (userPostoPrices[tipo]) {
          preco = userPostoPrices[tipo].preco;
          fonte = 'usuário';
          dataAtualizacao = userPostoPrices[tipo].data;
        }
        // Prioridade 2: dados reais do abastecimento (frota)
        else if (posto.precos[tipo]) {
          preco = posto.precos[tipo].preco;
          dataAtualizacao = posto.precos[tipo].data;
        }

        if (preco > 0) {
          entries.push({
            id: `${stationId}-${tipo}`,
            tipo_combustivel: tipo, preco,
            data_atualizacao: dataAtualizacao,
            reportado_por: fonte, ticket_log: 'Sim',
            stations: stationInfo,
          });
        }
      }

      if (entries.length === 0) {
        entries.push({
          id: `sem-preco-${stationId}`,
          tipo_combustivel: 'sem_preco', preco: 0,
          data_atualizacao: new Date().toISOString(),
          reportado_por: 'Ticket Log', ticket_log: 'Sim',
          stations: stationInfo,
        });
      }

      return entries;
    }));
    results.push(...geocoded.flat());
  }

  // ── Complementa com postos do dedurapreco que não estão na frota ───────────
  const nomesFrota = new Set(postosFrota.map(p => p.nome.toLowerCase().replace(/\s+/g, '')));

  for (let i = 0; i < deduraStations.length; i += BATCH) {
    const batch = deduraStations.slice(i, i + BATCH);
    const geocoded = await Promise.all(batch.map(async (posto: DeduraStation, idx: number) => {
      const nomeNorm = posto.nome.toLowerCase().replace(/\s+/g, '');
      // Pula se já está nos dados da frota
      if (nomesFrota.has(nomeNorm)) return [];

      let coords = { lat: cityCenter.lat + (Math.random() - 0.5) * 0.02, lon: cityCenter.lon + (Math.random() - 0.5) * 0.02 };
      if (posto.endereco.length > 5 && apiKey) {
        const geo = await geocodeStation(posto.nome, posto.endereco, '', cidade, uf, apiKey);
        if (geo) coords = geo;
      }

      const stationId = `dedura-${i + idx}`;
      const nomeNormFull = posto.nome.toLowerCase().replace(/\s+/g, '');
      const userPostoPrices = userPrices.get(nomeNormFull) || {};

      const stationInfo = {
        id: stationId, osm_id: null,
        nome: posto.nome, bandeira: posto.bandeira,
        endereco: posto.endereco || cidade,
        cidade, estado: uf.toUpperCase(),
        latitude: coords.lat, longitude: coords.lon,
        ticket_log: false,
      };

      const entries: any[] = [];
      for (const tipo of ALL_FUELS) {
        let preco = 0;
        let fonte = 'dedurapreco.com';
        let dataAtualizacao = new Date().toISOString();

        if (userPostoPrices[tipo]) {
          preco = userPostoPrices[tipo].preco;
          fonte = 'usuário';
          dataAtualizacao = userPostoPrices[tipo].data;
        } else if (posto.precos[tipo]) {
          preco = posto.precos[tipo];
        } else if (bestPrices[tipo]) {
          const bp = bestPrices[tipo];
          const bNorm = bp.posto.toLowerCase().replace(/\s+/g, '');
          if (nomeNorm.includes(bNorm.slice(0, 8)) || bNorm.includes(nomeNorm.slice(0, 8))) {
            preco = bp.preco;
          }
        }

        if (preco > 0) {
          entries.push({
            id: `${stationId}-${tipo}`,
            tipo_combustivel: tipo, preco,
            data_atualizacao: dataAtualizacao,
            reportado_por: fonte, ticket_log: 'Não',
            stations: stationInfo,
          });
        }
      }

      if (entries.length === 0) {
        entries.push({
          id: `sem-preco-${stationId}`,
          tipo_combustivel: 'sem_preco', preco: 0,
          data_atualizacao: new Date().toISOString(),
          reportado_por: 'dedurapreco.com', ticket_log: 'Não',
          stations: stationInfo,
        });
      }

      return entries;
    }));
    results.push(...geocoded.flat());
  }

  const source = postosFrota.length > 0
    ? `${postosFrota.length} postos da frota + dedurapreco.com`
    : 'dedurapreco.com';

  return NextResponse.json({
    data: results,
    source,
    total_frota: postosFrota.length,
    total_osm: deduraStations.length,
    cidade,
  });
}
