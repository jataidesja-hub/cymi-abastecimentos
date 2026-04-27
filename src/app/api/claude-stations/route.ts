import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

const ALL_FUELS = ['Gasolina Comum','Gasolina Aditivada','Etanol','Diesel S10','Diesel S500','GNV'];

// ─── ANP regionais (fallback de preço) ───────────────────────────────────────
const ANP: Record<string, Record<string, number>> = {
  default:    { 'Gasolina Comum':6.29,'Gasolina Aditivada':6.69,'Etanol':4.21,'Diesel S10':6.08,'Diesel S500':5.89,'GNV':4.39 },
  nordeste:   { 'Gasolina Comum':6.35,'Gasolina Aditivada':6.75,'Etanol':4.35,'Diesel S10':6.12,'Diesel S500':5.92,'GNV':4.42 },
  sudeste:    { 'Gasolina Comum':6.18,'Gasolina Aditivada':6.58,'Etanol':4.05,'Diesel S10':6.01,'Diesel S500':5.82,'GNV':4.31 },
  sul:        { 'Gasolina Comum':6.22,'Gasolina Aditivada':6.62,'Etanol':4.12,'Diesel S10':6.05,'Diesel S500':5.85,'GNV':4.35 },
  norte:      { 'Gasolina Comum':6.52,'Gasolina Aditivada':6.92,'Etanol':4.51,'Diesel S10':6.25,'Diesel S500':6.05,'GNV':4.55 },
  centroeste: { 'Gasolina Comum':6.31,'Gasolina Aditivada':6.71,'Etanol':4.18,'Diesel S10':6.09,'Diesel S500':5.88,'GNV':4.40 },
};

function getANP(estado: string): Record<string, number> {
  const uf = estado.toLowerCase();
  if (['al','ba','ce','ma','pb','pe','pi','rn','se'].includes(uf)) return ANP.nordeste;
  if (['es','mg','rj','sp'].includes(uf)) return ANP.sudeste;
  if (['pr','rs','sc'].includes(uf)) return ANP.sul;
  if (['ac','am','ap','pa','ro','rr','to'].includes(uf)) return ANP.norte;
  if (['df','go','ms','mt'].includes(uf)) return ANP.centroeste;
  return ANP.default;
}

// ─── Slugify para dedurapreco ─────────────────────────────────────────────────
function toSlug(str: string): string {
  return str.toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

const UF_TO_STATE_SLUG: Record<string, string> = {
  ac:'acre',al:'alagoas',ap:'amapa',am:'amazonas',ba:'bahia',ce:'ceara',
  df:'distrito-federal',es:'espirito-santo',go:'goias',ma:'maranhao',
  mt:'mato-grosso',ms:'mato-grosso-do-sul',mg:'minas-gerais',pa:'para',
  pb:'paraiba',pr:'parana',pe:'pernambuco',pi:'piaui',rj:'rio-de-janeiro',
  rn:'rio-grande-do-norte',rs:'rio-grande-do-sul',ro:'rondonia',rr:'roraima',
  sc:'santa-catarina',sp:'sao-paulo',se:'sergipe',to:'tocantins',
};

// ─── Google Places: busca postos por cidade ───────────────────────────────────
interface PlaceStation {
  place_id: string;
  nome: string;
  endereco: string;
  lat: number;
  lon: number;
  bandeira: string;
}

async function getStationsFromGoogle(cidade: string): Promise<PlaceStation[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return [];

  // Geocodifica a cidade para obter lat/lon
  const geoRes = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(cidade+', Brasil')}&key=${apiKey}`,
    { signal: AbortSignal.timeout(5000) }
  );
  const geoData = await geoRes.json();
  if (!geoData.results?.[0]) return [];

  const { lat, lng } = geoData.results[0].geometry.location;
  const estado = geoData.results[0].address_components
    ?.find((c: any) => c.types.includes('administrative_area_level_1'))
    ?.short_name?.toLowerCase() || '';

  // Nearby Search por postos de combustível
  const placesRes = await fetch(
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=8000&type=gas_station&language=pt-BR&key=${apiKey}`,
    { signal: AbortSignal.timeout(8000) }
  );
  const placesData = await placesRes.json();
  if (!placesData.results?.length) return [];

  return placesData.results.slice(0, 20).map((p: any) => {
    const nome: string = p.name || 'Posto de Combustível';
    // Detecta bandeira pelo nome
    let bandeira = 'Branco';
    const n = nome.toLowerCase();
    if (n.includes('shell')) bandeira = 'Shell';
    else if (n.includes('ipiranga')) bandeira = 'Ipiranga';
    else if (n.includes('petrobras') || n.includes(' br ') || n.includes('br ')) bandeira = 'Petrobras';
    else if (n.includes('ale ') || n.includes(' ale')) bandeira = 'Ale';

    return {
      place_id: p.place_id,
      nome,
      endereco: p.vicinity || '',
      lat: p.geometry.location.lat,
      lon: p.geometry.location.lng,
      bandeira,
      _estado: estado,
    } as any;
  });
}

// ─── dedurapreco: extrai preços por posto ─────────────────────────────────────
interface DeduraStation { nome: string; precos: Record<string, number> }

function decodeHtml(s: string): string {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
          .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/&nbsp;/g,' ');
}

function parseDeduraHtml(html: string): { stations: DeduraStation[]; bestPrices: Record<string,{preco:number;posto:string}> } {
  const stations: DeduraStation[] = [];
  const bestPrices: Record<string,{preco:number;posto:string}> = {};
  const fuelLabels: Record<string,string> = {
    'gasolina comum':'Gasolina Comum','gasolina aditivada':'Gasolina Aditivada',
    'etanol':'Etanol','diesel s10':'Diesel S10','diesel s500':'Diesel S500',
    'diesel':'Diesel S10','gnv':'GNV',
  };

  for (const [label, tipo] of Object.entries(fuelLabels)) {
    const re = new RegExp(`${label}[\\s\\S]{0,80}?R\\$\\s*([\\d,\\.]+)[\\s\\S]{0,60}?([A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ][A-ZÀ-Ú\\s&.,\\-]{3,60})`, 'gi');
    const m = re.exec(html);
    if (m && !bestPrices[tipo]) {
      const preco = parseFloat(m[1].replace(',','.'));
      const posto = m[2].trim().replace(/\s+/g,' ');
      if (preco > 1 && preco < 20 && posto.length > 2) bestPrices[tipo] = { preco, posto };
    }
  }

  const blocks = html.split(/<h3[\s>]/i);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const nomeM = block.match(/^[^>]*>([^<]{2,120})<\/h3>/i);
    if (!nomeM) continue;
    const nome = decodeHtml(nomeM[1].trim().replace(/\s+/g,' '));
    if (nome.length < 2 || /melhores|preços|postos|busca|filtro/i.test(nome)) continue;
    const precos: Record<string,number> = {};
    for (const [label, tipo] of Object.entries(fuelLabels)) {
      const re = new RegExp(`${label}[^R<]{0,30}R\\$\\s*([\\d,\\.]+)`, 'i');
      const m = block.match(re);
      if (m) { const v = parseFloat(m[1].replace(',','.')); if (v>1&&v<20) precos[tipo]=v; }
    }
    stations.push({ nome, precos });
  }
  return { stations: stations.slice(0, 30), bestPrices };
}

async function getDeduraPrices(cidade: string, uf: string): Promise<{ stations: DeduraStation[]; bestPrices: Record<string,{preco:number;posto:string}> }> {
  const stateSlug = UF_TO_STATE_SLUG[uf];
  if (!stateSlug) return { stations:[], bestPrices:{} };
  const url = `https://dedurapreco.com/preco-do-combustivel/${stateSlug}/${toSlug(cidade)}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { stations:[], bestPrices:{} };
    return parseDeduraHtml(await res.text());
  } catch { return { stations:[], bestPrices:{} }; }
}

// ─── Detecta UF via Geocoding (Google ou Nominatim) ──────────────────────────
async function getStateUF(cidade: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(cidade+', Brasil')}&key=${apiKey}`,
        { signal: AbortSignal.timeout(4000) }
      );
      const data = await res.json();
      const uf = data.results?.[0]?.address_components
        ?.find((c: any) => c.types.includes('administrative_area_level_1'))
        ?.short_name?.toLowerCase();
      if (uf && UF_TO_STATE_SLUG[uf]) return uf;
    } catch {}
  }
  // Fallback Nominatim
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cidade+', Brasil')}&format=json&limit=1&addressdetails=1&countrycodes=br`,
      { headers:{'User-Agent':'MAPM-App/1.0'}, signal:AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    const stateMap: Record<string,string> = {
      'Acre':'ac','Alagoas':'al','Amapá':'ap','Amazonas':'am','Bahia':'ba','Ceará':'ce',
      'Distrito Federal':'df','Espírito Santo':'es','Goiás':'go','Maranhão':'ma',
      'Mato Grosso':'mt','Mato Grosso do Sul':'ms','Minas Gerais':'mg','Pará':'pa',
      'Paraíba':'pb','Paraná':'pr','Pernambuco':'pe','Piauí':'pi','Rio de Janeiro':'rj',
      'Rio Grande do Norte':'rn','Rio Grande do Sul':'rs','Rondônia':'ro','Roraima':'rr',
      'Santa Catarina':'sc','São Paulo':'sp','Sergipe':'se','Tocantins':'to',
    };
    const state = data[0]?.address?.state;
    return state ? (stateMap[state] || null) : null;
  } catch { return null; }
}

// ─── Matching nome Google ↔ dedurapreco ───────────────────────────────────────
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/posto|de|combustivel|auto|gas|gasolina/gi,'').replace(/\s+/g,'').trim();
}

function matchPrice(googleName: string, deduraStations: DeduraStation[], bestPrices: Record<string,{preco:number;posto:string}>): Record<string,{preco:number;fonte:string}> {
  const gNorm = normalize(googleName);
  const result: Record<string,{preco:number;fonte:string}> = {};

  // Tenta achar o posto no dedurapreco
  let matched: DeduraStation | null = null;
  for (const s of deduraStations) {
    const dNorm = normalize(s.nome);
    if (gNorm.length >= 4 && dNorm.includes(gNorm.slice(0,6))) { matched = s; break; }
    if (dNorm.length >= 4 && gNorm.includes(dNorm.slice(0,6))) { matched = s; break; }
  }

  for (const tipo of ALL_FUELS) {
    if (matched?.precos[tipo]) {
      result[tipo] = { preco: matched.precos[tipo], fonte: 'dedurapreco.com' };
    } else if (bestPrices[tipo]) {
      const bp = bestPrices[tipo];
      const bNorm = normalize(bp.posto);
      if (gNorm.includes(bNorm.slice(0,5)) || bNorm.includes(gNorm.slice(0,5))) {
        result[tipo] = { preco: bp.preco, fonte: 'dedurapreco.com' };
      }
    }
  }

  return result;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cidade = (searchParams.get('cidade') || '').trim();

  if (!cidade) return NextResponse.json({ error: 'Informe cidade' }, { status: 400 });

  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY não configurada' }, { status: 503 });
  }

  // Busca postos no Google Maps e UF + preços dedurapreco em paralelo
  const uf = await getStateUF(cidade);
  const [googleStations, deduraData] = await Promise.all([
    getStationsFromGoogle(cidade),
    uf ? getDeduraPrices(cidade, uf) : Promise.resolve({ stations:[], bestPrices:{} }),
  ]);

  if (googleStations.length === 0) {
    return NextResponse.json({ error: 'Nenhum posto encontrado pelo Google Maps' }, { status: 404 });
  }

  const anpPrices = getANP(uf || '');
  const { stations: deduraStations, bestPrices } = deduraData;

  const results: any[] = [];

  for (let i = 0; i < googleStations.length; i++) {
    const g = googleStations[i] as any;
    const stationId = `gmap-${i}`;
    const stationInfo = {
      id: stationId, osm_id: null,
      nome: g.nome, bandeira: g.bandeira,
      endereco: g.endereco,
      cidade, estado: (uf || '').toUpperCase(),
      latitude: g.lat, longitude: g.lon,
      ticket_log: false,
    };

    const matched = matchPrice(g.nome, deduraStations, bestPrices);

    for (const tipo of ALL_FUELS) {
      let preco = 0;
      let fonte = 'estimativa regional';

      if (matched[tipo]) {
        preco = matched[tipo].preco;
        fonte = matched[tipo].fonte;
      } else if (anpPrices[tipo]) {
        preco = anpPrices[tipo];
        fonte = 'estimativa regional';
      }

      results.push({
        id: `${stationId}-${tipo}`,
        tipo_combustivel: tipo,
        preco,
        data_atualizacao: new Date().toISOString(),
        reportado_por: fonte,
        ticket_log: 'Não',
        stations: stationInfo,
      });
    }
  }

  return NextResponse.json({
    data: results,
    source: 'Google Maps + dedurapreco.com',
    total_osm: googleStations.length,
    cidade,
  });
}
