import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

const ALL_FUELS = ['Gasolina Comum','Gasolina Aditivada','Etanol','Diesel S10','Diesel S500','GNV'];

const ANP: Record<string, Record<string, number>> = {
  default:    { 'Gasolina Comum':6.29,'Gasolina Aditivada':6.69,'Etanol':4.21,'Diesel S10':6.08,'Diesel S500':5.89,'GNV':4.39 },
  nordeste:   { 'Gasolina Comum':6.35,'Gasolina Aditivada':6.75,'Etanol':4.35,'Diesel S10':6.12,'Diesel S500':5.92,'GNV':4.42 },
  sudeste:    { 'Gasolina Comum':6.18,'Gasolina Aditivada':6.58,'Etanol':4.05,'Diesel S10':6.01,'Diesel S500':5.82,'GNV':4.31 },
  sul:        { 'Gasolina Comum':6.22,'Gasolina Aditivada':6.62,'Etanol':4.12,'Diesel S10':6.05,'Diesel S500':5.85,'GNV':4.35 },
  norte:      { 'Gasolina Comum':6.52,'Gasolina Aditivada':6.92,'Etanol':4.51,'Diesel S10':6.25,'Diesel S500':6.05,'GNV':4.55 },
  centroeste: { 'Gasolina Comum':6.31,'Gasolina Aditivada':6.71,'Etanol':4.18,'Diesel S10':6.09,'Diesel S500':5.88,'GNV':4.40 },
};

function getANP(uf: string): Record<string, number> {
  if (['al','ba','ce','ma','pb','pe','pi','rn','se'].includes(uf)) return ANP.nordeste;
  if (['es','mg','rj','sp'].includes(uf)) return ANP.sudeste;
  if (['pr','rs','sc'].includes(uf)) return ANP.sul;
  if (['ac','am','ap','pa','ro','rr','to'].includes(uf)) return ANP.norte;
  if (['df','go','ms','mt'].includes(uf)) return ANP.centroeste;
  return ANP.default;
}

function toSlug(str: string): string {
  return str.toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-');
}

const UF_SLUG: Record<string,string> = {
  ac:'acre',al:'alagoas',ap:'amapa',am:'amazonas',ba:'bahia',ce:'ceara',
  df:'distrito-federal',es:'espirito-santo',go:'goias',ma:'maranhao',
  mt:'mato-grosso',ms:'mato-grosso-do-sul',mg:'minas-gerais',pa:'para',
  pb:'paraiba',pr:'parana',pe:'pernambuco',pi:'piaui',rj:'rio-de-janeiro',
  rn:'rio-grande-do-norte',rs:'rio-grande-do-sul',ro:'rondonia',rr:'roraima',
  sc:'santa-catarina',sp:'sao-paulo',se:'sergipe',to:'tocantins',
};

// ─── Passo 1: geocodifica cidade uma única vez ────────────────────────────────
async function geocodeCity(cidade: string, apiKey: string): Promise<{lat:number;lon:number;uf:string}|null> {
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(cidade+', Brasil')}&key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    const result = data.results?.[0];
    if (!result) return null;
    const { lat, lng } = result.geometry.location;
    const uf = result.address_components
      ?.find((c: any) => c.types.includes('administrative_area_level_1'))
      ?.short_name?.toLowerCase() || '';
    return { lat, lon: lng, uf };
  } catch { return null; }
}

// ─── Passo 2a: Google Nearby Search (usa lat/lon já obtidos) ─────────────────
async function nearbyGasStations(lat: number, lon: number, apiKey: string) {
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lon}&radius=8000&type=gas_station&language=pt-BR&key=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    return (data.results || []).slice(0, 20).map((p: any) => {
      const nome: string = p.name || 'Posto';
      const n = nome.toLowerCase();
      let bandeira = 'Branco';
      if (n.includes('shell')) bandeira = 'Shell';
      else if (n.includes('ipiranga')) bandeira = 'Ipiranga';
      else if (n.includes('petrobras') || /\bbr\b/.test(n)) bandeira = 'Petrobras';
      else if (/\bale\b/.test(n)) bandeira = 'Ale';
      return { nome, endereco: p.vicinity || '', lat: p.geometry.location.lat, lon: p.geometry.location.lng, bandeira };
    });
  } catch { return []; }
}

// ─── Passo 2b: dedurapreco scraping ──────────────────────────────────────────
function decodeHtml(s: string): string {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
          .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/&nbsp;/g,' ');
}

interface DeduraStation { nome: string; precos: Record<string,number> }

function parseDedura(html: string) {
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
      if (preco>1&&preco<20&&posto.length>2) bestPrices[tipo]={preco,posto};
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
      if (m) { const v=parseFloat(m[1].replace(',','.')); if(v>1&&v<20) precos[tipo]=v; }
    }
    stations.push({ nome, precos });
  }
  return { stations: stations.slice(0,30), bestPrices };
}

async function fetchDedura(cidade: string, uf: string) {
  const stateSlug = UF_SLUG[uf];
  if (!stateSlug) return { stations:[], bestPrices:{} };
  try {
    const res = await fetch(
      `https://dedurapreco.com/preco-do-combustivel/${stateSlug}/${toSlug(cidade)}`,
      {
        headers:{
          'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          'Accept':'text/html','Accept-Language':'pt-BR,pt;q=0.9',
        },
        signal: AbortSignal.timeout(9000),
      }
    );
    if (!res.ok) return { stations:[], bestPrices:{} };
    return parseDedura(await res.text());
  } catch { return { stations:[], bestPrices:{} }; }
}

// ─── Matching nome Google ↔ dedurapreco ───────────────────────────────────────
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/posto|auto|gas\b|rede|combustivel|abastecimento/gi,'')
    .replace(/\s+/g,'').trim();
}

function matchDedura(googleName: string, deduraStations: DeduraStation[], bestPrices: Record<string,{preco:number;posto:string}>) {
  const gn = norm(googleName);
  let matched: DeduraStation | null = null;

  for (const s of deduraStations) {
    const dn = norm(s.nome);
    const minLen = Math.min(gn.length, dn.length, 6);
    if (minLen >= 4 && (gn.includes(dn.slice(0,minLen)) || dn.includes(gn.slice(0,minLen)))) {
      matched = s; break;
    }
  }

  const result: Record<string,{preco:number;fonte:string}> = {};
  for (const tipo of ALL_FUELS) {
    if (matched?.precos[tipo]) {
      result[tipo] = { preco: matched.precos[tipo], fonte: 'dedurapreco.com' };
    } else if (bestPrices[tipo]) {
      const bn = norm(bestPrices[tipo].posto);
      const minLen = Math.min(gn.length, bn.length, 5);
      if (minLen >= 4 && (gn.includes(bn.slice(0,minLen)) || bn.includes(gn.slice(0,minLen)))) {
        result[tipo] = { preco: bestPrices[tipo].preco, fonte: 'dedurapreco.com' };
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

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY não configurada' }, { status: 503 });

  // Geocodifica uma única vez
  const geo = await geocodeCity(cidade, apiKey);
  if (!geo) return NextResponse.json({ error: 'Cidade não encontrada' }, { status: 404 });

  const { lat, lon, uf } = geo;

  // Nearby Search + dedurapreco em paralelo
  const [googleStations, deduraData] = await Promise.all([
    nearbyGasStations(lat, lon, apiKey),
    uf && UF_SLUG[uf] ? fetchDedura(cidade, uf) : Promise.resolve({ stations:[], bestPrices:{} }),
  ]);

  if (googleStations.length === 0) {
    return NextResponse.json({ error: 'Nenhum posto encontrado pelo Google Maps' }, { status: 404 });
  }

  const anp = getANP(uf);
  const { stations: deduraStations, bestPrices } = deduraData;
  const results: any[] = [];

  for (let i = 0; i < googleStations.length; i++) {
    const g = googleStations[i];
    const stationId = `gmap-${i}`;
    const stationInfo = {
      id: stationId, osm_id: null,
      nome: g.nome, bandeira: g.bandeira,
      endereco: g.endereco,
      cidade, estado: uf.toUpperCase(),
      latitude: g.lat, longitude: g.lon,
      ticket_log: false,
    };

    const matched = matchDedura(g.nome, deduraStations, bestPrices);

    for (const tipo of ALL_FUELS) {
      const m = matched[tipo];
      results.push({
        id: `${stationId}-${tipo}`,
        tipo_combustivel: tipo,
        preco: m ? m.preco : (anp[tipo] || 0),
        data_atualizacao: new Date().toISOString(),
        reportado_por: m ? m.fonte : 'estimativa regional',
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
