import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Overpass: tenta os 3 mirrors em paralelo e pega o mais rápido ────────────
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
      signal: AbortSignal.timeout(7000),
    })
      .then(r => (r.ok ? r.json() : Promise.reject('not ok')))
      .then(d => {
        if (!Array.isArray(d.elements)) throw new Error('no elements');
        return d.elements as any[];
      })
  );

  try {
    // Promise.any = primeiro que RESOLVE (ignora rejeições)
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

// ─── Nominatim: busca postos diretamente (fallback quando Overpass falha) ─────
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

async function getStationsByCity(cidade: string): Promise<any[] | null> {
  // 1. Geocode da cidade (máx 4s)
  let bbox: number[] | null = null;
  try {
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cidade + ', Brasil')}&format=json&limit=1`,
      { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(4000) }
    );
    const geoData = await geoRes.json();
    if (geoData[0]?.boundingbox) {
      bbox = geoData[0].boundingbox.map(Number);
    }
  } catch {
    // continua sem bbox
  }

  if (bbox) {
    const [south, north, west, east] = bbox;
    const query = `[out:json][timeout:7];(node["amenity"="fuel"](${south},${west},${north},${east});way["amenity"="fuel"](${south},${west},${north},${east}););out 60 center;`;
    const overpassResult = await queryOverpass(query);
    if (overpassResult !== null) return overpassResult;
  }

  // Overpass falhou → Nominatim como fallback
  return getStationsByNominatim(cidade);
}

async function getStationsByCoords(lat: number, lon: number): Promise<any[] | null> {
  const query = `[out:json][timeout:7];(node["amenity"="fuel"](around:6000,${lat},${lon});way["amenity"="fuel"](around:6000,${lat},${lon}););out 60 center;`;
  return queryOverpass(query);
}

// ─── Helpers de exibição ──────────────────────────────────────────────────────
function normalizeBrand(brand: string): string {
  if (!brand) return 'Branco';
  const b = brand.toLowerCase().trim();
  if (b === 'shell' || b.includes('raizen') || b.includes('raízen') || b.includes('shell')) return 'Shell';
  if (b === 'ipiranga' || b.includes('vibra') || b.includes('ipiranga')) return 'Ipiranga';
  if (b === 'petrobras' || b === 'br' || b.includes('petrobras')) return 'Petrobras';
  if (b === 'ale' || b.startsWith('ale ') || b.includes(' ale')) return 'Ale';
  return brand;
}

function buildName(tags: Record<string, string>): string {
  const name = tags.name || tags['name:pt'] || tags['official_name'];
  const brandRaw = tags.brand || tags['brand:pt'] || '';
  const brandNorm = normalizeBrand(brandRaw);

  // Nome explícito que não é só o código da bandeira
  if (name && name.length > 2 && name.toLowerCase() !== brandRaw.toLowerCase()) {
    return name;
  }
  // Sem nome → "Posto [Bandeira]"
  if (brandNorm && brandNorm !== 'Branco') return `Posto ${brandNorm}`;
  if (name && name.length > 0) return name;
  return 'Posto de Combustível';
}

function buildAddress(tags: Record<string, string>, cidadeFallback: string): string {
  const street = tags['addr:street'];
  const number = tags['addr:housenumber'];
  const neighborhood = tags['addr:suburb'] || tags['addr:neighbourhood'] || tags['addr:district'];
  const city = tags['addr:city'];

  if (street) return [street, number, neighborhood].filter(Boolean).join(', ');
  if (tags['addr:full']) return tags['addr:full'];
  if (neighborhood && city) return `${neighborhood}, ${city}`;
  if (neighborhood) return `${neighborhood}, ${cidadeFallback}`;
  // Último recurso: só cidade
  return cidadeFallback;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
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

    // 1. Postos reais do OpenStreetMap
    let osmElements: any[] | null = null;
    if (latParam && lonParam) {
      osmElements = await getStationsByCoords(parseFloat(latParam), parseFloat(lonParam));
    } else {
      osmElements = await getStationsByCity(cidade);
    }

    const osmUnavailable = osmElements === null;
    if (!osmElements) osmElements = [];

    const cidadeFinal = cidade || 'Região GPS';
    const osmIds = osmElements.map((e: any) => e.id);

    // 2. Supabase em paralelo (por osm_id e por cidade)
    const [{ data: dbByOsmId }, { data: dbByCity }] = await Promise.all([
      supabase.from('stations').select('*').in('osm_id', osmIds),
      supabase.from('stations').select('*').ilike('cidade', `%${cidadeFinal}%`),
    ]);

    const osmIdToDb = new Map<number, any>();
    (dbByOsmId || []).forEach((s: any) => {
      if (s.osm_id != null) osmIdToDb.set(Number(s.osm_id), s);
    });

    const dbIdToStation = new Map<string, any>();
    (dbByCity || []).forEach((s: any) => dbIdToStation.set(s.id, s));

    // 3. Preços Supabase para todos os postos encontrados
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

      if (tipo && tipo !== 'Todos') q = q.eq('tipo_combustivel', tipo);

      const { data: allPrices } = await q;
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

    // 4. Monta resposta
    const result: any[] = [];
    const seenIds = new Set<string>();

    for (const el of osmElements) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (!lat || !lon) continue;

      const tags = el.tags || {};
      const nome = buildName(tags);
      const bandeira = normalizeBrand(tags.brand || tags['brand:pt'] || '');
      const endereco = buildAddress(tags, cidadeFinal);
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
      } else {
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

    // 5. Postos do Supabase com preço mas fora do OSM
    for (const [id, dbSt] of dbIdToStation) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const prices = pricesMap.get(id) || [];
      if (prices.length === 0) continue;

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
      source: osmUnavailable ? 'Pesquisa Web' : 'OpenStreetMap + Comunidade',
      total_osm: osmElements.length,
      osm_unavailable: osmUnavailable,
      cidade: cidadeFinal,
    });
  } catch (err: any) {
    console.error('[ERRO STATIONS]:', err.message);
    return NextResponse.json({ error: `Erro na busca: ${err.message}` }, { status: 500 });
  }
}
