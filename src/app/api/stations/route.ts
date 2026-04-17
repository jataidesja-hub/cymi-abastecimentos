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

// ─── Fallback: Nominatim busca postos de combustível diretamente ─────────────
async function getStationsByNominatim(cidade: string): Promise<any[] | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?amenity=fuel&city=${encodeURIComponent(cidade)}&country=Brasil&format=json&limit=40&addressdetails=1`,
      { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    // Converte formato Nominatim → formato Overpass
    return data.map((item: any) => ({
      id: item.osm_id || `nom-${Math.random()}`,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      tags: {
        name: item.display_name?.split(',')[0]?.trim() || 'Posto de Combustível',
        'addr:street': item.address?.road || '',
        'addr:housenumber': item.address?.house_number || '',
        'addr:suburb': item.address?.suburb || item.address?.neighbourhood || '',
      },
    }));
  } catch {
    return null;
  }
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

  const overpassResult = await queryOverpass(query);
  if (overpassResult !== null) return overpassResult;

  // Overpass falhou — tenta Nominatim como fallback
  console.log('[FALLBACK] Overpass falhou, tentando Nominatim para:', cidade);
  return getStationsByNominatim(cidade);
}

async function getStationsByCoords(lat: number, lon: number) {
  const query = `[out:json][timeout:18];(node["amenity"="fuel"](around:6000,${lat},${lon});way["amenity"="fuel"](around:6000,${lat},${lon}););out 80 center;`;
  return queryOverpass(query);
}

function normalizeBrand(brand: string): string {
  if (!brand) return 'Branco';
  const b = brand.toLowerCase().trim();
  if (b === 'shell' || b.includes('raizen') || b.includes('raízen')) return 'Shell';
  if (b === 'ipiranga' || b.includes('vibra')) return 'Ipiranga';
  if (b === 'petrobras' || b === 'br' || b === 'posto br' || b === 'petrobras distribuidora') return 'Petrobras';
  if (b === 'ale' || b.includes('alérgico') ) return 'Ale';
  if (b.includes('ale ')) return 'Ale';
  if (b.includes('shell')) return 'Shell';
  if (b.includes('ipiranga')) return 'Ipiranga';
  if (b.includes('petrobras')) return 'Petrobras';
  return brand;
}

// Gera nome de exibição inteligente a partir das tags OSM
function buildName(tags: Record<string, string>): string {
  // Nome explícito tem prioridade
  const name = tags.name || tags['name:pt'] || tags['official_name'];
  if (name && name.length > 2 && name.toLowerCase() !== (tags.brand || '').toLowerCase()) {
    return name;
  }
  // Se só tem brand, monta "Posto [Bandeira]"
  const brand = normalizeBrand(tags.brand || tags['brand:pt'] || '');
  if (brand && brand !== 'Branco') return `Posto ${brand}`;
  if (name && name.length > 0) return name;
  return 'Posto de Combustível';
}

function buildAddress(tags: Record<string, string>): string {
  const street = tags['addr:street'];
  const number = tags['addr:housenumber'];
  const neighborhood = tags['addr:suburb'] || tags['addr:neighbourhood'] || tags['addr:district'];
  const city = tags['addr:city'];
  if (street) return [street, number, neighborhood].filter(Boolean).join(', ');
  if (tags['addr:full']) return tags['addr:full'];
  if (neighborhood && city) return `${neighborhood}, ${city}`;
  if (neighborhood) return neighborhood;
  return '';  // vazio → vai para reverse geocode
}

// Reverse geocode em lote (máx 6 em paralelo, Nominatim aceita 1/s mas em servidor é ok)
async function reverseGeocodeMany(
  items: { id: string; lat: number; lon: number }[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  // Processa em grupos de 4 para não sobrecarregar
  const BATCH = 4;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async item => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${item.lat}&lon=${item.lon}&format=json&zoom=17&addressdetails=1&accept-language=pt-BR`,
            { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(4000) }
          );
          if (!res.ok) return;
          const data = await res.json();
          const addr = data.address || {};
          const road = addr.road || addr.pedestrian || addr.footway || '';
          const num = addr.house_number || '';
          const suburb = addr.suburb || addr.neighbourhood || addr.quarter || '';
          if (road) {
            result.set(item.id, [road, num, suburb].filter(Boolean).join(', '));
          } else if (suburb) {
            result.set(item.id, suburb);
          }
        } catch {
          // silencioso
        }
      })
    );
  }
  return result;
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

    // 4. Reverse geocode postos sem endereço (máx 12 para não atrasar demais)
    const needsGeo: { id: string; lat: number; lon: number }[] = [];
    for (const el of osmElements.slice(0, 20)) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (!lat || !lon) continue;
      const tags = el.tags || {};
      if (!buildAddress(tags)) {
        needsGeo.push({ id: String(el.id), lat, lon });
      }
    }
    const geocodedAddresses = needsGeo.length > 0
      ? await reverseGeocodeMany(needsGeo.slice(0, 12))
      : new Map<string, string>();

    // 5. Monta resposta
    const result: any[] = [];
    const seenIds = new Set<string>();

    for (const el of osmElements) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (!lat || !lon) continue;

      const tags = el.tags || {};
      const nome = buildName(tags);
      const bandeira = normalizeBrand(tags.brand || tags['brand:pt'] || '');
      const osmAddr = buildAddress(tags);
      const endereco = osmAddr || geocodedAddresses.get(String(el.id)) || 'Endereço não cadastrado';
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
