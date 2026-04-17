import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Overpass mirrors ─────────────────────────────────────────────────────────
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
      // tenta próximo mirror
    }
  }
  return null;
}

async function getStationsByCity(cidade: string) {
  const geoRes = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cidade + ', Brasil')}&format=json&limit=1`,
    { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(8000) }
  );
  const geoData = await geoRes.json();
  if (!geoData[0]?.boundingbox) return null;
  const [south, north, west, east] = geoData[0].boundingbox.map(Number);
  const query = `[out:json][timeout:18];(node["amenity"="fuel"](${south},${west},${north},${east});way["amenity"="fuel"](${south},${west},${north},${east}););out 80 center;`;
  return queryOverpass(query);
}

async function getStationsByCoords(lat: number, lon: number) {
  const query = `[out:json][timeout:18];(node["amenity"="fuel"](around:6000,${lat},${lon});way["amenity"="fuel"](around:6000,${lat},${lon}););out 80 center;`;
  return queryOverpass(query);
}

function normalizeBrand(brand: string): string {
  if (!brand) return 'Branco';
  const b = brand.toLowerCase();
  if (b.includes('shell') || b.includes('raizen') || b.includes('raízen')) return 'Shell';
  if (b.includes('ipiranga') || b.includes('vibra')) return 'Ipiranga';
  if (b.includes('petrobras') || b === 'br') return 'Petrobras';
  if (b.includes('ale')) return 'Ale';
  return brand;
}

function buildAddress(tags: Record<string, string>): string {
  const street = tags['addr:street'];
  const number = tags['addr:housenumber'];
  const neighborhood = tags['addr:suburb'] || tags['addr:neighbourhood'];
  if (street) return [street, number, neighborhood].filter(Boolean).join(', ');
  if (tags['addr:full']) return tags['addr:full'];
  return 'Endereço não cadastrado';
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
      source: osmUnavailable ? 'Supabase (OSM indisponível)' : 'OpenStreetMap + Comunidade',
      total_osm: osmElements.length,
      osm_unavailable: osmUnavailable,
    });
  } catch (err: any) {
    console.error('[ERRO STATIONS]:', err.message);
    return NextResponse.json({ error: `Erro na busca: ${err.message}` }, { status: 500 });
  }
}
