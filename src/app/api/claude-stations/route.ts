import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

// ─── Slugify para dedurapreco.com ─────────────────────────────────────────────
function toSlug(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

const UF_TO_STATE_SLUG: Record<string, string> = {
  ac: 'acre', al: 'alagoas', ap: 'amapa', am: 'amazonas', ba: 'bahia',
  ce: 'ceara', df: 'distrito-federal', es: 'espirito-santo', go: 'goias',
  ma: 'maranhao', mt: 'mato-grosso', ms: 'mato-grosso-do-sul',
  mg: 'minas-gerais', pa: 'para', pb: 'paraiba', pr: 'parana',
  pe: 'pernambuco', pi: 'piaui', rj: 'rio-de-janeiro',
  rn: 'rio-grande-do-norte', rs: 'rio-grande-do-sul', ro: 'rondonia',
  rr: 'roraima', sc: 'santa-catarina', sp: 'sao-paulo', se: 'sergipe',
  to: 'tocantins',
};

// ─── Geocode estado da cidade via Nominatim ───────────────────────────────────
async function getStateUF(cidade: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cidade + ', Brasil')}&format=json&limit=1&addressdetails=1&countrycodes=br`,
      { headers: { 'User-Agent': 'MAPM-App/1.0' }, signal: AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    const state = data[0]?.address?.state;
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
    return state ? (stateMap[state] || null) : null;
  } catch {
    return null;
  }
}

// ─── Geocode endereço → lat/lon ───────────────────────────────────────────────
async function geocodeAddress(endereco: string, cidade: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const q = encodeURIComponent(`${endereco}, ${cidade}, Brasil`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=3&countrycodes=br`,
      { headers: { 'User-Agent': 'MAPM-App/1.0' }, signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    if (!data || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

// ─── Geocode centro da cidade (fallback de coordenada) ────────────────────────
async function getCityCenter(cidade: string): Promise<{ lat: number; lon: number }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cidade + ', Brasil')}&format=json&limit=1&countrycodes=br`,
      { headers: { 'User-Agent': 'MAPM-App/1.0' }, signal: AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    if (data[0]) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {}
  return { lat: -14.24, lon: -51.93 };
}

// ─── Scrape dedurapreco.com ───────────────────────────────────────────────────
interface DeduraStation {
  nome: string;
  endereco: string;
  bandeira: string;
  precos: Record<string, number | null>;
}

async function scrapeDedura(cidade: string, uf: string): Promise<DeduraStation[]> {
  const stateSlug = UF_TO_STATE_SLUG[uf.toLowerCase()];
  if (!stateSlug) return [];

  const cidadeSlug = toSlug(cidade);
  const url = `https://dedurapreco.com/preco-do-combustivel/${stateSlug}/${cidadeSlug}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];
    const html = await res.text();

    // Extrai __NEXT_DATA__ (Next.js SSR data)
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const pageProps = nextData?.props?.pageProps;

        // Tenta extrair postos de pageProps
        const stations = pageProps?.postos || pageProps?.stations || pageProps?.gasStations || pageProps?.data?.postos || pageProps?.data;
        if (Array.isArray(stations) && stations.length > 0) {
          return parseNextDataStations(stations);
        }
      } catch {}
    }

    // Fallback: parse HTML com regex
    return parseHtmlStations(html);
  } catch {
    return [];
  }
}

function parseNextDataStations(stations: any[]): DeduraStation[] {
  return stations.map((s: any) => ({
    nome: s.nome || s.name || s.razaoSocial || s.razao_social || 'Posto',
    endereco: [s.endereco, s.logradouro, s.address].find(Boolean) || '',
    bandeira: s.bandeira || s.brand || s.distribuidora || 'Branco',
    precos: {
      'Gasolina Comum': s.gasolina_comum || s.gasolinaComum || s.precoGasolina || null,
      'Gasolina Aditivada': s.gasolina_aditivada || s.gasolinaAditivada || null,
      'Etanol': s.etanol || s.alcool || null,
      'Diesel S10': s.diesel_s10 || s.dieselS10 || null,
      'Diesel S500': s.diesel_s500 || s.dieselS500 || null,
      'GNV': s.gnv || null,
    },
  })).filter(s => s.nome && s.nome !== 'Posto');
}

function parseHtmlStations(html: string): DeduraStation[] {
  const stations: DeduraStation[] = [];

  // Padrão para extrair blocos de posto do HTML
  // Procura por h3 com nome do posto seguido de endereço e preço
  const stationBlocks = html.split(/<h[23]/i).slice(1);

  for (const block of stationBlocks) {
    // Nome do posto
    const nomeMatch = block.match(/^[^>]*>([^<]{3,80})</);
    if (!nomeMatch) continue;
    const nome = nomeMatch[1].trim().toUpperCase();

    // Filtra blocos que não são postos
    if (nome.length < 3 || nome.includes('PREÇO') || nome.includes('POSTOS') ||
        nome.includes('MELHORES') || nome.includes('CIDADE') && nome.length > 20) continue;

    // Endereço — procura padrão de logradouro brasileiro
    const endMatch = block.match(/(?:Rua|Avenida|Av\.|R\.|Rodovia|Rod\.|Alameda|Al\.|Travessa|Trav\.|Praça)[^<]{10,120}/i);
    const endereco = endMatch ? endMatch[0].replace(/\s+/g, ' ').trim() : '';

    // Bandeira
    let bandeira = 'Branco';
    if (/petrobras|br\s*distribui/i.test(block)) bandeira = 'Petrobras';
    else if (/ipiranga/i.test(block)) bandeira = 'Ipiranga';
    else if (/shell|raizen/i.test(block)) bandeira = 'Shell';
    else if (/ale\b/i.test(block)) bandeira = 'Ale';
    else if (/branca|bandeira\s*branca/i.test(block)) bandeira = 'Branco';

    // Preços — padrão R$ X,XX
    const precoGasolina = extractPrice(block, /gasolina\s*(?:comum)?[^R]*R\$\s*([\d,\.]+)/i) ||
                          extractPrice(block, /R\$\s*([\d,\.]+)/i);
    const precoEtanol = extractPrice(block, /etanol[^R]*R\$\s*([\d,\.]+)/i) ||
                        extractPrice(block, /álcool[^R]*R\$\s*([\d,\.]+)/i);
    const precoDiesel = extractPrice(block, /diesel[^R]*R\$\s*([\d,\.]+)/i);
    const precoGasolinaAditivada = extractPrice(block, /aditivada[^R]*R\$\s*([\d,\.]+)/i);
    const precoGNV = extractPrice(block, /gnv[^R]*R\$\s*([\d,\.]+)/i);

    if (nome.length >= 3) {
      stations.push({
        nome,
        endereco,
        bandeira,
        precos: {
          'Gasolina Comum': precoGasolina,
          'Gasolina Aditivada': precoGasolinaAditivada,
          'Etanol': precoEtanol,
          'Diesel S10': precoDiesel,
          'Diesel S500': null,
          'GNV': precoGNV,
        },
      });
    }
  }

  return stations.filter(s => s.nome.length > 2).slice(0, 30);
}

function extractPrice(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) return null;
  const raw = match[1].replace(',', '.');
  const val = parseFloat(raw);
  return val > 0 && val < 20 ? val : null;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cidade = (searchParams.get('cidade') || '').trim();
  const latParam = searchParams.get('lat');
  const lonParam = searchParams.get('lon');

  if (!cidade && (!latParam || !lonParam)) {
    return NextResponse.json({ error: 'Informe cidade ou localização' }, { status: 400 });
  }

  // Detecta UF da cidade
  const uf = await getStateUF(cidade);
  if (!uf) {
    return NextResponse.json({ error: 'Cidade não encontrada no Brasil' }, { status: 404 });
  }

  // Scrape dedurapreco.com
  const stations = await scrapeDedura(cidade, uf);

  if (stations.length === 0) {
    return NextResponse.json({ error: 'Nenhum posto encontrado no dedurapreco.com para essa cidade' }, { status: 404 });
  }

  // Geocodifica endereços em paralelo (lotes de 4 para não sobrecarregar Nominatim)
  const cityCenter = await getCityCenter(cidade);

  const results: any[] = [];
  const BATCH = 4;

  for (let i = 0; i < stations.length; i += BATCH) {
    const batch = stations.slice(i, i + BATCH);
    const geocoded = await Promise.all(
      batch.map(async (posto, idx) => {
        let coords = { ...cityCenter };
        if (posto.endereco && posto.endereco.length > 5) {
          const geo = await geocodeAddress(posto.endereco, cidade);
          if (geo) coords = geo;
          else {
            // Pequeno jitter para não empilhar no centro
            coords.lat += (Math.random() - 0.5) * 0.008;
            coords.lon += (Math.random() - 0.5) * 0.008;
          }
        } else {
          coords.lat += (Math.random() - 0.5) * 0.008;
          coords.lon += (Math.random() - 0.5) * 0.008;
        }

        const stationId = `dedura-${i + idx}`;
        const stationInfo = {
          id: stationId,
          osm_id: null,
          nome: posto.nome,
          bandeira: posto.bandeira,
          endereco: posto.endereco || cidade,
          cidade,
          estado: uf.toUpperCase(),
          latitude: coords.lat,
          longitude: coords.lon,
          ticket_log: false,
        };

        const entries: any[] = [];
        let temPreco = false;

        for (const [tipo, preco] of Object.entries(posto.precos)) {
          if (preco && typeof preco === 'number' && preco > 0) {
            temPreco = true;
            entries.push({
              id: `${stationId}-${tipo}`,
              tipo_combustivel: tipo,
              preco,
              data_atualizacao: new Date().toISOString(),
              reportado_por: 'dedurapreco.com',
              ticket_log: 'Não',
              stations: stationInfo,
            });
          }
        }

        if (!temPreco) {
          entries.push({
            id: `sem-preco-${stationId}`,
            tipo_combustivel: 'sem_preco',
            preco: 0,
            data_atualizacao: new Date().toISOString(),
            reportado_por: 'dedurapreco.com',
            ticket_log: 'Não',
            stations: stationInfo,
          });
        }

        return entries;
      })
    );
    results.push(...geocoded.flat());
  }

  return NextResponse.json({
    data: results,
    source: 'dedurapreco.com',
    total_osm: stations.length,
    osm_unavailable: false,
    cidade,
  });
}
