import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const ALL_FUELS = ['Gasolina Comum','Gasolina Aditivada','Etanol','Diesel S10','Diesel S500','GNV'];

// ─── Preços reportados por usuários via Supabase ─────────────────────────────
// Retorna: Map<nome_normalizado, Record<tipo_combustivel, {preco, data}>>
async function getUserReportedPrices(cidade: string): Promise<Map<string, Record<string,{preco:number;data:string}>>> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return new Map();
    const supabase = createClient(url, key);
    const { data } = await supabase
      .from('latest_prices')
      .select('nome, tipo_combustivel, preco, data_atualizacao')
      .eq('cidade', cidade);
    if (!data?.length) return new Map();
    const map = new Map<string, Record<string,{preco:number;data:string}>>();
    for (const r of data) {
      const key2 = (r.nome as string).toLowerCase().replace(/\s+/g,'');
      if (!map.has(key2)) map.set(key2, {});
      map.get(key2)![r.tipo_combustivel] = { preco: Number(r.preco), data: r.data_atualizacao };
    }
    return map;
  } catch { return new Map(); }
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

// ─── Google Geocoding ─────────────────────────────────────────────────────────
async function getCityInfo(cidade: string, apiKey: string): Promise<{lat:number;lon:number;uf:string}|null> {
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

async function geocodeAddress(endereco: string, cidade: string, apiKey: string): Promise<{lat:number;lon:number}|null> {
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(endereco+', '+cidade+', Brasil')}&key=${apiKey}`,
      { signal: AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    const loc = data.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lon: loc.lng } : null;
  } catch { return null; }
}

// ─── dedurapreco ──────────────────────────────────────────────────────────────
interface DeduraStation { nome: string; endereco: string; bandeira: string; precos: Record<string,number> }

function decodeHtml(s: string): string {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
          .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/&nbsp;/g,' ');
}

function parseDedura(html: string): { stations: DeduraStation[]; bestPrices: Record<string,{preco:number;posto:string}> } {
  const stations: DeduraStation[] = [];
  const bestPrices: Record<string,{preco:number;posto:string}> = {};
  const fuelLabels: Record<string,string> = {
    'gasolina comum':'Gasolina Comum','gasolina aditivada':'Gasolina Aditivada',
    'etanol':'Etanol','diesel s10':'Diesel S10','diesel s500':'Diesel S500',
    'diesel':'Diesel S10','gnv':'GNV',
  };

  const strippedFull = html.replace(/<[^>]+>/g,' ');

  for (const [label, tipo] of Object.entries(fuelLabels)) {
    const re = new RegExp(`${label}[\\s\\S]{0,80}?R\\$\\s*([\\d,\\.]+)[\\s\\S]{0,60}?([A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ][A-ZÀ-Ú\\s&.,\\-]{3,60})`, 'gi');
    const m = re.exec(strippedFull);
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
    if (nome.length < 2 || /melhores|preços|postos|busca|filtro|cidade/i.test(nome)) continue;

    const endM = block.match(/(?:Rua|Avenida|Av\b|Rod(?:ovia)?\.?|Alameda|Travessa|Praça|Estrada|BR-?\d{2,3}|Largo)[^<]{5,150}/i);
    const endereco = endM ? decodeHtml(endM[0].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim()) : '';

    let bandeira = 'Branco';
    if (/petrobras|br distribui/i.test(block)) bandeira = 'Petrobras';
    else if (/ipiranga/i.test(block)) bandeira = 'Ipiranga';
    else if (/shell|raizen/i.test(block)) bandeira = 'Shell';
    else if (/\bale\b/i.test(block)) bandeira = 'Ale';

    const precos: Record<string,number> = {};
    const stripped = block.replace(/<[^>]+>/g,' '); // remove todas as tags HTML
    for (const [label, tipo] of Object.entries(fuelLabels)) {
      if (precos[tipo]) continue;
      const re = new RegExp(`${label}[\\s\\S]{0,80}?R\\$\\s*([\\d]+[,.]\\d{2,3})`, 'i');
      const m = stripped.match(re);
      if (m) { const v=parseFloat(m[1].replace(',','.')); if(v>1&&v<20) precos[tipo]=v; }
    }
    stations.push({ nome, endereco, bandeira, precos });
  }
  return { stations: stations.slice(0,25), bestPrices };
}

async function fetchDedura(cidade: string, uf: string) {
  const stateSlug = UF_SLUG[uf];
  if (!stateSlug) return { stations:[] as DeduraStation[], bestPrices:{} as Record<string,{preco:number;posto:string}> };
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
    if (!res.ok) return { stations:[] as DeduraStation[], bestPrices:{} as Record<string,{preco:number;posto:string}> };
    return parseDedura(await res.text());
  } catch { return { stations:[] as DeduraStation[], bestPrices:{} as Record<string,{preco:number;posto:string}> }; }
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cidade = (searchParams.get('cidade') || '').trim();
  if (!cidade) return NextResponse.json({ error: 'Informe cidade' }, { status: 400 });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';

  // Geocodifica cidade via Google para pegar UF + centro
  const cityInfo = apiKey ? await getCityInfo(cidade, apiKey) : null;
  let uf = cityInfo?.uf || '';

  // Fallback UF via Nominatim
  if (!uf) {
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
      uf = stateMap[data[0]?.address?.state || ''] || '';
    } catch {}
  }

  if (!uf) return NextResponse.json({ error: 'Cidade não encontrada no Brasil' }, { status: 404 });

  // Busca dedurapreco + preços reportados por usuários em paralelo
  const [{ stations, bestPrices }, userPrices] = await Promise.all([
    fetchDedura(cidade, uf),
    getUserReportedPrices(cidade),
  ]);

  if (stations.length === 0) return NextResponse.json({ error: 'Nenhum posto encontrado' }, { status: 404 });

  const cityCenter = cityInfo || { lat: -14.24, lon: -51.93 };
  const results: any[] = [];
  const BATCH = 4;

  for (let i = 0; i < stations.length; i += BATCH) {
    const batch = stations.slice(i, i + BATCH);
    const geocoded = await Promise.all(batch.map(async (posto: DeduraStation, idx: number) => {
      let coords = { lat: cityCenter.lat + (Math.random()-0.5)*0.01, lon: cityCenter.lon + (Math.random()-0.5)*0.01 };

      if (posto.endereco.length > 5) {
        const geo = apiKey
          ? await geocodeAddress(posto.endereco, cidade, apiKey)
          : null;
        if (geo) coords = geo;
      }

      const stationId = `dedura-${i+idx}`;
      const stationInfo = {
        id: stationId, osm_id: null,
        nome: posto.nome, bandeira: posto.bandeira,
        endereco: posto.endereco || cidade,
        cidade, estado: uf.toUpperCase(),
        latitude: coords.lat, longitude: coords.lon,
        ticket_log: false,
      };

      // Preços reportados por usuários para este posto (match por nome normalizado)
      const nomeNorm = posto.nome.toLowerCase().replace(/\s+/g,'');
      const userPostoPrices = userPrices.get(nomeNorm) || {};

      const entries: any[] = [];

      for (const tipo of ALL_FUELS) {
        let preco = 0;
        let fonte = 'dedurapreco.com';
        let dataAtualizacao = new Date().toISOString();

        // Prioridade 1: preço reportado por usuário (mais confiável)
        if (userPostoPrices[tipo]) {
          preco = userPostoPrices[tipo].preco;
          fonte = 'usuário';
          dataAtualizacao = userPostoPrices[tipo].data;
        }
        // Prioridade 2: preço direto do dedurapreco para este posto
        else if (posto.precos[tipo]) {
          preco = posto.precos[tipo];
        }
        // Prioridade 3: melhor preço da página do dedurapreco (parcial)
        else if (bestPrices[tipo]) {
          const bp = bestPrices[tipo];
          const bNorm = bp.posto.toLowerCase().replace(/\s+/g,'');
          if (nomeNorm.includes(bNorm.slice(0,8)) || bNorm.includes(nomeNorm.slice(0,8))) {
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

      // Se não tem nenhum preço real, inclui como sem_preco
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

  return NextResponse.json({
    data: results,
    source: apiKey ? 'dedurapreco.com + Google Maps' : 'dedurapreco.com',
    total_osm: stations.length,
    cidade,
  });
}
