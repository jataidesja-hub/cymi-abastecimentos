import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TAVILY_KEY = process.env.TAVILY_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

// Mapeamento de chaves JSON → tipo de combustível do app
const FUEL_MAP: Record<string, string> = {
  gasolina_comum: 'Gasolina Comum',
  gasolina_aditivada: 'Gasolina Aditivada',
  etanol: 'Etanol',
  diesel_s10: 'Diesel S10',
  diesel_s500: 'Diesel S500',
  gnv: 'GNV',
};

// ─── Tavily + Groq: busca preços reais da cidade na web ───────────────────────
async function getWebPrices(cidade: string): Promise<Record<string, number> | null> {
  if (!TAVILY_KEY || !GROQ_KEY) return null;

  // Limite total de 8s para caber no timeout do Vercel free (10s)
  const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 8000));

  const searchPromise = (async () => {
    try {
      // 1. Tavily: pesquisa na web (timeout 4s)
      const tavilyRes = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_KEY,
          query: `preço gasolina etanol diesel ${cidade} ${new Date().getFullYear()} ANP`,
          search_depth: 'basic',
          max_results: 4,
          include_answer: true,
        }),
        signal: AbortSignal.timeout(4000),
      });
      if (!tavilyRes.ok) return null;
      const tavilyData = await tavilyRes.json();

      const context = [
        tavilyData.answer || '',
        ...(tavilyData.results || []).map((r: any) => r.content || '').slice(0, 3),
      ].join('\n').slice(0, 2000);

      if (!context.trim()) return null;

      // 2. Groq: extrai preços em JSON (modelo rápido, timeout 5s)
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant', // modelo rápido para extração simples
          messages: [{
            role: 'user',
            content: `Do texto abaixo, extraia preços de combustível no Brasil para ${cidade}.
Retorne SOMENTE JSON válido, sem texto extra.
Formato: {"gasolina_comum":6.49,"gasolina_aditivada":6.89,"etanol":4.29,"diesel_s10":6.19,"diesel_s500":5.99,"gnv":4.5}
Use null se não encontrar. Se não há preços de ${cidade}, use a média regional/estadual.

Texto: ${context}`,
          }],
          temperature: 0.1,
          max_tokens: 120,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!groqRes.ok) return null;

      const groqData = await groqRes.json();
      const raw = groqData.choices?.[0]?.message?.content?.trim() || '';
      const match = raw.match(/\{[\s\S]*?\}/);
      if (!match) return null;

      const parsed = JSON.parse(match[0]);
      // Valida que pelo menos um campo é número válido
      const hasValid = Object.values(parsed).some(v => typeof v === 'number' && v > 0);
      return hasValid ? parsed : null;
    } catch {
      return null;
    }
  })();

  return Promise.race([searchPromise, timeoutPromise]);
}

// Mirrors do Overpass API — tenta em ordem até um funcionar
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function queryOverpass(query: string): Promise<any[] | null> {
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(18000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      return data.elements as any[];
    } catch {
      // tenta o próximo mirror
    }
  }
  return null; // todos os mirrors falharam
}

// ─── Overpass API: busca por bounding box de uma cidade ───────────────────────
async function getStationsByCity(cidade: string) {
  const geoRes = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cidade + ', Brasil')}&format=json&limit=1`,
    {
      headers: { 'User-Agent': 'CombustivelApp/1.0' },
      signal: AbortSignal.timeout(8000),
    }
  );
  const geoData = await geoRes.json();
  if (!geoData[0]?.boundingbox) return null;

  // Nominatim retorna: [min_lat, max_lat, min_lon, max_lon]
  const [south, north, west, east] = geoData[0].boundingbox.map(Number);
  const query = `[out:json][timeout:18];(node["amenity"="fuel"](${south},${west},${north},${east});way["amenity"="fuel"](${south},${west},${north},${east}););out 80 center;`;
  return queryOverpass(query);
}

// ─── Overpass API: busca por raio em torno de coordenadas GPS ─────────────────
async function getStationsByCoords(lat: number, lon: number) {
  const query = `[out:json][timeout:18];(node["amenity"="fuel"](around:6000,${lat},${lon});way["amenity"="fuel"](around:6000,${lat},${lon}););out 80 center;`;
  return queryOverpass(query);
}

// ─── Normaliza nome de bandeira ───────────────────────────────────────────────
function normalizeBrand(brand: string): string {
  if (!brand) return 'Branco';
  const b = brand.toLowerCase();
  if (b.includes('shell') || b.includes('raizen') || b.includes('raízen')) return 'Shell';
  if (b.includes('ipiranga') || b.includes('vibra')) return 'Ipiranga';
  if (b.includes('petrobras') || b === 'br') return 'Petrobras';
  if (b.includes('ale')) return 'Ale';
  return brand;
}

// ─── Monta endereço a partir das tags OSM ────────────────────────────────────
function buildAddress(tags: Record<string, string>): string {
  const street = tags['addr:street'];
  const number = tags['addr:housenumber'];
  const neighborhood = tags['addr:suburb'] || tags['addr:neighbourhood'];
  if (street) return [street, number, neighborhood].filter(Boolean).join(', ');
  if (tags['addr:full']) return tags['addr:full'];
  return 'Endereço não cadastrado';
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cidade = (searchParams.get('cidade') || '').trim();
    const latParam = searchParams.get('lat');
    const lonParam = searchParams.get('lon');
    const tipo = searchParams.get('tipo');

    if (!cidade && (!latParam || !lonParam)) {
      return NextResponse.json({ error: 'Informe cidade ou localização GPS' }, { status: 400 });
    }

    // 1. Busca postos reais no OpenStreetMap
    let osmElements: any[] | null = null;
    if (latParam && lonParam) {
      osmElements = await getStationsByCoords(parseFloat(latParam), parseFloat(lonParam));
    } else {
      osmElements = await getStationsByCity(cidade);
    }

    const osmUnavailable = osmElements === null;
    if (!osmElements) osmElements = []; // OSM falhou — continua só com Supabase

    const cidadeFinal = cidade || 'Região GPS';
    const osmIds = osmElements.map((e: any) => e.id);

    // 2. Supabase + pesquisa web em paralelo (não bloqueia um ao outro)
    const [{ data: dbByOsmId }, { data: dbByCity }, webPrices] = await Promise.all([
      supabase.from('stations').select('*').in('osm_id', osmIds),
      supabase.from('stations').select('*').ilike('cidade', `%${cidadeFinal}%`),
      getWebPrices(cidadeFinal),
    ]);

    const osmIdToDb = new Map<number, any>();
    (dbByOsmId || []).forEach((s: any) => {
      if (s.osm_id != null) osmIdToDb.set(Number(s.osm_id), s);
    });

    const dbIdToStation = new Map<string, any>();
    (dbByCity || []).forEach((s: any) => dbIdToStation.set(s.id, s));

    // 4. Consolida todos os IDs de estações do Supabase para buscar preços
    const allDbIds = [
      ...(dbByOsmId || []).map((s: any) => s.id),
      ...(dbByCity || []).map((s: any) => s.id),
    ].filter((v, i, a) => a.indexOf(v) === i);

    const pricesMap = new Map<string, any[]>();

    if (allDbIds.length > 0) {
      let q = supabase
        .from('fuel_prices')
        .select('*')
        .in('station_id', allDbIds)
        .order('data_atualizacao', { ascending: false });

      if (tipo && tipo !== 'Todos') {
        q = q.eq('tipo_combustivel', tipo);
      }

      const { data: allPrices } = await q;

      // Mantém apenas o preço mais recente por posto + tipo
      const seenKeys = new Set<string>();
      (allPrices || []).forEach((p: any) => {
        const key = `${p.station_id}::${p.tipo_combustivel}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          if (!pricesMap.has(p.station_id)) pricesMap.set(p.station_id, []);
          pricesMap.get(p.station_id)!.push(p);
        }
      });
    }

    // 5. Monta a resposta combinando OSM + Supabase
    const result: any[] = [];
    const seenIds = new Set<string>();

    for (const el of osmElements) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (!lat || !lon) continue;

      const tags = el.tags || {};
      const nome = tags.name || tags['name:pt'] || tags.brand || 'Posto de Combustível';
      const bandeira = normalizeBrand(tags.brand || tags['brand:pt'] || '');
      const endereco = buildAddress(tags);
      const ticketLogOsm = tags['payment:ticketlog'] === 'yes';

      const dbStation = osmIdToDb.get(el.id);
      const ticketLog = dbStation?.ticket_log || ticketLogOsm;
      const stationId = dbStation?.id || `osm-${el.id}`;

      if (seenIds.has(stationId)) continue;
      seenIds.add(stationId);

      const stationInfo = {
        id: stationId,
        osm_id: el.id,
        nome: dbStation?.nome || nome,
        bandeira: dbStation?.bandeira || bandeira,
        endereco: dbStation?.endereco || endereco,
        cidade: dbStation?.cidade || cidadeFinal,
        estado: dbStation?.estado || tags['addr:state'] || '',
        latitude: lat,
        longitude: lon,
        ticket_log: ticketLog,
      };

      const prices = dbStation ? (pricesMap.get(dbStation.id) || []) : [];

      if (prices.length > 0) {
        prices.forEach((p: any) => {
          result.push({
            id: p.id,
            tipo_combustivel: p.tipo_combustivel,
            preco: parseFloat(p.preco),
            data_atualizacao: p.data_atualizacao,
            reportado_por: p.reportado_por || 'comunidade',
            ticket_log: ticketLog ? 'Sim' : 'Não',
            stations: stationInfo,
          });
        });
      } else if (webPrices) {
        // Usa preços encontrados na web como estimativa regional
        let adicionou = false;
        Object.entries(FUEL_MAP).forEach(([key, tipoNome]) => {
          const preco = (webPrices as any)[key];
          if (preco && typeof preco === 'number' && preco > 0) {
            if (!tipo || tipo === 'Todos' || tipo === tipoNome) {
              result.push({
                id: `web-${key}-${el.id}`,
                tipo_combustivel: tipoNome,
                preco,
                data_atualizacao: new Date().toISOString(),
                reportado_por: 'pesquisa web',
                ticket_log: ticketLog ? 'Sim' : 'Não',
                stations: stationInfo,
              });
              adicionou = true;
            }
          }
        });
        // Se a web não retornou nenhum preço válido, mostra sem preço
        if (!adicionou) {
          result.push({
            id: `sem-preco-${el.id}`,
            tipo_combustivel: 'sem_preco',
            preco: 0,
            data_atualizacao: new Date().toISOString(),
            reportado_por: 'OpenStreetMap',
            ticket_log: ticketLog ? 'Sim' : 'Não',
            stations: stationInfo,
          });
        }
      } else {
        // Sem web e sem Supabase
        result.push({
          id: `sem-preco-${el.id}`,
          tipo_combustivel: 'sem_preco',
          preco: 0,
          data_atualizacao: new Date().toISOString(),
          reportado_por: 'OpenStreetMap',
          ticket_log: ticketLog ? 'Sim' : 'Não',
          stations: stationInfo,
        });
      }
    }

    // 6. Inclui postos do Supabase que têm preço mas não apareceram no OSM
    for (const [id, dbSt] of dbIdToStation) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const prices = pricesMap.get(id) || [];
      if (prices.length === 0) continue; // sem preço e não estava no OSM = ignora

      const stationInfo = {
        id: dbSt.id,
        osm_id: dbSt.osm_id ?? null,
        nome: dbSt.nome,
        bandeira: dbSt.bandeira,
        endereco: dbSt.endereco,
        cidade: dbSt.cidade,
        estado: dbSt.estado,
        latitude: dbSt.latitude,
        longitude: dbSt.longitude,
        ticket_log: dbSt.ticket_log || false,
      };

      prices.forEach((p: any) => {
        result.push({
          id: p.id,
          tipo_combustivel: p.tipo_combustivel,
          preco: parseFloat(p.preco),
          data_atualizacao: p.data_atualizacao,
          reportado_por: p.reportado_por || 'comunidade',
          ticket_log: dbSt.ticket_log ? 'Sim' : 'Não',
          stations: stationInfo,
        });
      });
    }

    return NextResponse.json({
      data: result,
      source: osmUnavailable ? 'Supabase (OSM indisponível)' : 'OpenStreetMap + Comunidade',
      total_osm: osmElements.length,
      osm_unavailable: osmUnavailable,
    });
  } catch (err: any) {
    console.error('[ERRO STATIONS]:', err.message);
    return NextResponse.json({ error: `Erro na busca: ${err.message}` }, { status: 500 });
  }
}
