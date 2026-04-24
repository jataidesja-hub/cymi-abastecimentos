import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Overpass: busca postos reais do OpenStreetMap ───────────────────────────
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function queryOverpass(query: string): Promise<any[] | null> {
  const attempts = OVERPASS_MIRRORS.map(mirror =>
    fetch(mirror, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(8000),
    })
      .then(r => (r.ok ? r.json() : Promise.reject('not ok')))
      .then(d => {
        if (!Array.isArray(d.elements)) throw new Error('no elements');
        return d.elements as any[];
      })
  );

  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

// ─── Nominatim: busca postos diretamente (fallback) ──────────────────────────
async function getStationsByNominatim(cidade: string): Promise<any[] | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?amenity=fuel&city=${encodeURIComponent(cidade)}&country=Brasil&format=json&limit=40&addressdetails=1`,
      { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    return data.map((item: any) => ({
      id: item.osm_id || `nom-${Math.random()}`,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      tags: {
        name: item.display_name?.split(',')[0]?.trim() || '',
        'addr:street': item.address?.road || '',
        'addr:housenumber': item.address?.house_number || '',
        'addr:suburb': item.address?.suburb || item.address?.neighbourhood || '',
        brand: '',
      },
    }));
  } catch {
    return null;
  }
}

// ─── Resolve cidade → coordenadas + bbox ─────────────────────────────────────
async function resolveCity(input: string): Promise<{
  name: string; state: string; fullName: string;
  lat: number; lon: number; bbox: number[] | null;
}> {
  const ufPattern = /[\s,\-]+(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i;
  const cleanInput = input.replace(ufPattern, '').trim() || input;

  const queries = [input, cleanInput];
  for (const q of queries) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Brasil')}&format=json&limit=1&addressdetails=1`,
        { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(5000) }
      );
      const data = await res.json();
      if (data[0]) {
        const city = data[0].address?.city || data[0].address?.town ||
          data[0].address?.municipality || data[0].address?.village || data[0].name || cleanInput;
        const state = data[0].address?.state || '';
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        const bbox = data[0].boundingbox ? data[0].boundingbox.map(Number) : null;
        return { name: city, state, fullName: state ? `${city}, ${state}` : city, lat, lon, bbox };
      }
    } catch {}
  }
  return { name: cleanInput, state: '', fullName: cleanInput, lat: -14.24, lon: -51.93, bbox: null };
}

// ─── Busca postos OSM reais ──────────────────────────────────────────────────
async function findRealStations(cidade: string, bbox: number[] | null, lat: number, lon: number): Promise<any[]> {
  // Estratégia 1: Overpass com bbox
  if (bbox) {
    const [south, north, west, east] = bbox;
    const query = `[out:json][timeout:8];(node["amenity"="fuel"](${south},${west},${north},${east});way["amenity"="fuel"](${south},${west},${north},${east}););out 60 center;`;
    const result = await queryOverpass(query);
    if (result && result.length > 0) return result;
  }

  // Estratégia 2: Overpass com raio de 15km
  const query2 = `[out:json][timeout:8];(node["amenity"="fuel"](around:15000,${lat},${lon});way["amenity"="fuel"](around:15000,${lat},${lon}););out 60 center;`;
  const result2 = await queryOverpass(query2);
  if (result2 && result2.length > 0) return result2;

  // Estratégia 3: Nominatim direto
  const nomResult = await getStationsByNominatim(cidade);
  if (nomResult && nomResult.length > 0) return nomResult;

  return [];
}

// ─── Helpers de formatação ───────────────────────────────────────────────────
function normalizeBrand(brand: string): string {
  if (!brand) return 'Branco';
  const b = brand.toLowerCase().trim();
  if (b.includes('shell') || b.includes('raizen') || b.includes('raízen')) return 'Shell';
  if (b.includes('ipiranga') || b.includes('vibra')) return 'Ipiranga';
  if (b === 'petrobras' || b === 'br' || b.includes('petrobras')) return 'Petrobras';
  if (b === 'ale' || b.startsWith('ale ') || b.includes(' ale')) return 'Ale';
  return brand;
}

function buildName(tags: Record<string, string>): string {
  const name = tags.name || tags['name:pt'] || tags['official_name'];
  const brandRaw = tags.brand || tags['brand:pt'] || '';
  const brandNorm = normalizeBrand(brandRaw);
  if (name && name.length > 2 && name.toLowerCase() !== brandRaw.toLowerCase()) return name;
  if (brandNorm && brandNorm !== 'Branco') return `Posto ${brandNorm}`;
  if (name && name.length > 0) return name;
  return 'Posto de Combustível';
}

function buildAddress(tags: Record<string, string>, cidadeFallback: string): string {
  const street = tags['addr:street'];
  const number = tags['addr:housenumber'];
  const neighborhood = tags['addr:suburb'] || tags['addr:neighbourhood'] || tags['addr:district'];
  if (street) return [street, number, neighborhood].filter(Boolean).join(', ');
  if (tags['addr:full']) return tags['addr:full'];
  if (neighborhood) return `${neighborhood}, ${cidadeFallback}`;
  return cidadeFallback;
}

// ─── Handler principal ──────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cidadeRaw = (searchParams.get('cidade') || '').trim();
  const latParam = searchParams.get('lat');
  const lonParam = searchParams.get('lon');

  if (!cidadeRaw && (!latParam || !lonParam)) {
    return NextResponse.json({ error: 'Informe cidade ou localização' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 503 });
  }

  // 1. Resolve a cidade + coordenadas reais
  const resolved = cidadeRaw ? await resolveCity(cidadeRaw) : null;
  const cidade = resolved?.name || cidadeRaw;
  const cidadeCompleta = resolved?.fullName || cidadeRaw;
  const cityLat = resolved?.lat || (latParam ? parseFloat(latParam) : -14.24);
  const cityLon = resolved?.lon || (lonParam ? parseFloat(lonParam) : -51.93);

  console.log(`[claude-stations] "${cidadeRaw}" → "${cidadeCompleta}" (${cityLat}, ${cityLon})`);

  // 2. Busca postos REAIS do OpenStreetMap em PARALELO com Claude AI preços
  const [osmStations, claudePrices] = await Promise.allSettled([
    findRealStations(cidade, resolved?.bbox || null, cityLat, cityLon),
    getClaudePrices(cidade, cidadeCompleta, resolved?.state || ''),
  ]);

  const realStations = osmStations.status === 'fulfilled' ? osmStations.value : [];
  const priceData = claudePrices.status === 'fulfilled' ? claudePrices.value : null;

  console.log(`[claude-stations] OSM: ${realStations.length} postos | Claude: ${priceData ? priceData.postos.length + ' preços' : 'falhou'}`);

  // 3. Se encontrou postos reais, enriquece com preços do Claude
  if (realStations.length > 0) {
    const result = buildResult(realStations, priceData, cidade, cidadeCompleta, resolved?.state || '');
    return NextResponse.json({
      data: result,
      source: priceData
        ? `OpenStreetMap + Claude AI — ${priceData.fonte || 'busca web'}`
        : 'OpenStreetMap (sem preços)',
      total_osm: realStations.length,
      osm_unavailable: false,
      cidade: cidadeCompleta,
    });
  }

  // 4. Sem postos OSM — usa dados puros do Claude (com aviso de localização aproximada)
  if (priceData && priceData.postos.length > 0) {
    const result = buildClaudeOnlyResult(priceData, cidade, cidadeCompleta, resolved?.state || '', cityLat, cityLon);
    return NextResponse.json({
      data: result,
      source: `Claude AI — ${priceData.fonte || 'busca web'} (localização aproximada)`,
      total_osm: 0,
      osm_unavailable: true,
      cidade: cidadeCompleta,
    });
  }

  return NextResponse.json({ error: 'Nenhum posto encontrado', cidade: cidadeCompleta }, { status: 404 });
}

// ─── Claude AI: busca APENAS preços da região ───────────────────────────────
async function getClaudePrices(cidade: string, cidadeCompleta: string, state: string): Promise<{
  postos: { nome: string; bandeira: string; precos: Record<string, number | null> }[];
  fonte: string;
} | null> {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        {
          role: 'user',
          content: `Pesquise preços de combustível em ${cidadeCompleta}, Brasil.

Busque:
- "preço combustível ${cidadeCompleta} ${new Date().getFullYear()}"
- "gasolina etanol diesel ${cidade} ${state}"
- "${cidade} gaspedia combustível preço"
- "ANP preço ${state || 'Brasil'} combustível"

Encontre preços reais para postos de combustível em ${cidade}.
Se não encontrar preços específicos de ${cidade}, use preços da cidade mais próxima ou média ANP do estado.

Responda SOMENTE com JSON válido:
{
  "fonte": "site ou fonte usada",
  "postos": [
    {
      "nome": "Nome do Posto",
      "bandeira": "Shell",
      "precos": {
        "gasolina_comum": 6.29,
        "gasolina_aditivada": 6.69,
        "etanol": 4.21,
        "diesel_s10": 6.08,
        "diesel_s500": 5.89,
        "gnv": null
      }
    }
  ]
}

Liste pelo menos 3 postos com preços. Use null para preços não encontrados.`,
        },
      ],
    });

    let jsonText = '';
    for (const block of response.content) {
      if (block.type === 'text') jsonText += block.text;
    }

    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      const cleaned = jsonMatch[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      parsed = JSON.parse(cleaned);
    }

    return {
      postos: parsed.postos || [],
      fonte: parsed.fonte || 'Claude AI',
    };
  } catch (err: any) {
    console.error('[claude-prices]', err.message);
    return null;
  }
}

// ─── Monta resultado: postos OSM reais + preços Claude ──────────────────────
function buildResult(
  osmStations: any[],
  priceData: { postos: any[]; fonte: string } | null,
  cidade: string,
  cidadeCompleta: string,
  state: string
): any[] {
  const FUEL_MAP: Record<string, string> = {
    gasolina_comum: 'Gasolina Comum',
    gasolina_aditivada: 'Gasolina Aditivada',
    etanol: 'Etanol',
    diesel_s10: 'Diesel S10',
    diesel_s500: 'Diesel S500',
    gnv: 'GNV',
  };

  // Calcula preço médio do Claude para aplicar nos postos OSM
  const avgPrices: Record<string, number> = {};
  if (priceData) {
    const sums: Record<string, { total: number; count: number }> = {};
    for (const posto of priceData.postos) {
      for (const [key, val] of Object.entries(posto.precos || {})) {
        if (typeof val === 'number' && val > 0 && val < 20) {
          if (!sums[key]) sums[key] = { total: 0, count: 0 };
          sums[key].total += val;
          sums[key].count += 1;
        }
      }
    }
    for (const [key, s] of Object.entries(sums)) {
      avgPrices[key] = Math.round((s.total / s.count) * 100) / 100;
    }
  }

  // Tenta fazer match nome-a-nome entre Claude e OSM
  const claudeByName = new Map<string, Record<string, number | null>>();
  if (priceData) {
    for (const p of priceData.postos) {
      if (p.nome) claudeByName.set(p.nome.toLowerCase().trim(), p.precos || {});
    }
  }

  const result: any[] = [];

  for (let i = 0; i < osmStations.length; i++) {
    const el = osmStations[i];
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!lat || !lon) continue;

    const tags = el.tags || {};
    const nome = buildName(tags);
    const bandeira = normalizeBrand(tags.brand || tags['brand:pt'] || '');
    const endereco = buildAddress(tags, cidade);

    const stationId = `osm-${el.id || i}`;
    const stationInfo = {
      id: stationId,
      osm_id: el.id,
      nome,
      bandeira,
      endereco,
      cidade: cidadeCompleta,
      estado: state,
      latitude: lat,
      longitude: lon,
      ticket_log: tags['payment:ticketlog'] === 'yes',
    };

    // Tenta match por nome com dados do Claude
    let matchedPrices: Record<string, number | null> | null = null;
    const nomeLower = nome.toLowerCase();
    for (const [cName, cPrices] of claudeByName) {
      if (nomeLower.includes(cName) || cName.includes(nomeLower) ||
          (bandeira && cName.includes(bandeira.toLowerCase()))) {
        matchedPrices = cPrices;
        break;
      }
    }

    // Usa preços do match, senão usa média
    const pricesToUse = matchedPrices || (Object.keys(avgPrices).length > 0 ? avgPrices : null);
    let temPreco = false;

    if (pricesToUse) {
      for (const [key, tipo] of Object.entries(FUEL_MAP)) {
        const preco = pricesToUse[key];
        if (preco && typeof preco === 'number' && preco > 0 && preco < 20) {
          temPreco = true;
          result.push({
            id: `${stationId}-${key}`,
            tipo_combustivel: tipo,
            preco,
            data_atualizacao: new Date().toISOString(),
            reportado_por: matchedPrices ? 'Claude AI' : 'pesquisa web',
            ticket_log: stationInfo.ticket_log ? 'Sim' : 'Não',
            stations: stationInfo,
          });
        }
      }
    }

    if (!temPreco) {
      result.push({
        id: `sem-preco-${stationId}`,
        tipo_combustivel: 'sem_preco',
        preco: 0,
        data_atualizacao: new Date().toISOString(),
        reportado_por: 'OpenStreetMap',
        ticket_log: stationInfo.ticket_log ? 'Sim' : 'Não',
        stations: stationInfo,
      });
    }
  }

  return result;
}

// ─── Resultado só com dados do Claude (sem OSM — localização aproximada) ─────
function buildClaudeOnlyResult(
  priceData: { postos: any[]; fonte: string },
  cidade: string,
  cidadeCompleta: string,
  state: string,
  centerLat: number,
  centerLon: number
): any[] {
  const FUEL_MAP: Record<string, string> = {
    gasolina_comum: 'Gasolina Comum',
    gasolina_aditivada: 'Gasolina Aditivada',
    etanol: 'Etanol',
    diesel_s10: 'Diesel S10',
    diesel_s500: 'Diesel S500',
    gnv: 'GNV',
  };

  const result: any[] = [];

  for (let i = 0; i < priceData.postos.length && i < 15; i++) {
    const posto = priceData.postos[i];

    // Distribui postos ao redor do centro da cidade
    const angle = (2 * Math.PI * i) / priceData.postos.length;
    const radius = 0.003 + Math.random() * 0.003; // ~300-600m do centro
    const lat = centerLat + radius * Math.cos(angle);
    const lon = centerLon + radius * Math.sin(angle);

    const stationId = `claude-${i}-${Date.now()}`;
    const stationInfo = {
      id: stationId,
      osm_id: null,
      nome: posto.nome || `Posto de Combustível ${cidade}`,
      bandeira: posto.bandeira || 'Branco',
      endereco: `${cidade} (localização aproximada)`,
      cidade: cidadeCompleta,
      estado: state,
      latitude: lat,
      longitude: lon,
      ticket_log: false,
    };

    const precos = posto.precos || {};
    let temPreco = false;

    for (const [key, tipo] of Object.entries(FUEL_MAP)) {
      const preco = precos[key];
      if (preco && typeof preco === 'number' && preco > 0 && preco < 20) {
        temPreco = true;
        result.push({
          id: `${stationId}-${key}`,
          tipo_combustivel: tipo,
          preco,
          data_atualizacao: new Date().toISOString(),
          reportado_por: 'Claude AI',
          ticket_log: 'Não',
          stations: stationInfo,
        });
      }
    }

    if (!temPreco) {
      result.push({
        id: `sem-preco-${stationId}`,
        tipo_combustivel: 'sem_preco',
        preco: 0,
        data_atualizacao: new Date().toISOString(),
        reportado_por: 'Claude AI',
        ticket_log: 'Não',
        stations: stationInfo,
      });
    }
  }

  return result;
}
