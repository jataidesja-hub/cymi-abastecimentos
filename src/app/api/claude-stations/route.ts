import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

// ─── Slugify ──────────────────────────────────────────────────────────────────
function toSlug(str: string): string {
  return str.toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim()
    .replace(/\s+/g, '-');
}

const UF_TO_STATE_SLUG: Record<string, string> = {
  ac:'acre',al:'alagoas',ap:'amapa',am:'amazonas',ba:'bahia',ce:'ceara',
  df:'distrito-federal',es:'espirito-santo',go:'goias',ma:'maranhao',
  mt:'mato-grosso',ms:'mato-grosso-do-sul',mg:'minas-gerais',pa:'para',
  pb:'paraiba',pr:'parana',pe:'pernambuco',pi:'piaui',rj:'rio-de-janeiro',
  rn:'rio-grande-do-norte',rs:'rio-grande-do-sul',ro:'rondonia',rr:'roraima',
  sc:'santa-catarina',sp:'sao-paulo',se:'sergipe',to:'tocantins',
};

// ─── ANP regionais (fallback por estado) ─────────────────────────────────────
const ANP: Record<string, Record<string, number>> = {
  default: { 'Gasolina Comum':6.29,'Gasolina Aditivada':6.69,'Etanol':4.21,'Diesel S10':6.08,'Diesel S500':5.89,'GNV':4.39 },
  nordeste: { 'Gasolina Comum':6.35,'Gasolina Aditivada':6.75,'Etanol':4.35,'Diesel S10':6.12,'Diesel S500':5.92,'GNV':4.42 },
  sudeste:  { 'Gasolina Comum':6.18,'Gasolina Aditivada':6.58,'Etanol':4.05,'Diesel S10':6.01,'Diesel S500':5.82,'GNV':4.31 },
  sul:      { 'Gasolina Comum':6.22,'Gasolina Aditivada':6.62,'Etanol':4.12,'Diesel S10':6.05,'Diesel S500':5.85,'GNV':4.35 },
  norte:    { 'Gasolina Comum':6.52,'Gasolina Aditivada':6.92,'Etanol':4.51,'Diesel S10':6.25,'Diesel S500':6.05,'GNV':4.55 },
  centroeste:{ 'Gasolina Comum':6.31,'Gasolina Aditivada':6.71,'Etanol':4.18,'Diesel S10':6.09,'Diesel S500':5.88,'GNV':4.40 },
};
const NORDESTE = ['al','ba','ce','ma','pb','pe','pi','rn','se'];
const SUDESTE  = ['es','mg','rj','sp'];
const SUL      = ['pr','rs','sc'];
const NORTE    = ['ac','am','ap','pa','ro','rr','to'];

function getANP(uf: string): Record<string, number> {
  if (NORDESTE.includes(uf)) return ANP.nordeste;
  if (SUDESTE.includes(uf))  return ANP.sudeste;
  if (SUL.includes(uf))      return ANP.sul;
  if (NORTE.includes(uf))    return ANP.norte;
  if (['df','go','ms','mt'].includes(uf)) return ANP.centroeste;
  return ANP.default;
}

const ALL_FUELS = ['Gasolina Comum','Gasolina Aditivada','Etanol','Diesel S10','Diesel S500','GNV'];

// ─── Nominatim helpers ────────────────────────────────────────────────────────
async function getStateUF(cidade: string): Promise<string | null> {
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

async function geocodeAddress(endereco: string, cidade: string): Promise<{lat:number;lon:number}|null> {
  try {
    const q = encodeURIComponent(`${endereco}, ${cidade}, Brasil`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=2&countrycodes=br`,
      { headers:{'User-Agent':'MAPM-App/1.0'}, signal:AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    if (!data?.length) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch { return null; }
}

async function getCityCenter(cidade: string): Promise<{lat:number;lon:number}> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cidade+', Brasil')}&format=json&limit=1&countrycodes=br`,
      { headers:{'User-Agent':'MAPM-App/1.0'}, signal:AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    if (data[0]) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {}
  return { lat:-14.24, lon:-51.93 };
}

// ─── Parse dedurapreco.com ────────────────────────────────────────────────────
interface DeduraStation {
  nome: string;
  endereco: string;
  bandeira: string;
  precos: Record<string, number>; // tipo → preço real
}


function parseDeduraHtml(html: string): { stations: DeduraStation[]; bestPrices: Record<string, { preco: number; posto: string }> } {
  const stations: DeduraStation[] = [];
  const bestPrices: Record<string, { preco: number; posto: string }> = {};

  // ── "Melhores Preços" section ─────────────────────────────────────────────
  // Extrair do HTML: Gasolina Comum R$ X,XX | NOME POSTO
  const fuelLabels: Record<string, string> = {
    'gasolina comum':    'Gasolina Comum',
    'gasolina aditivada':'Gasolina Aditivada',
    'etanol':            'Etanol',
    'diesel s10':        'Diesel S10',
    'diesel s500':       'Diesel S500',
    'diesel':            'Diesel S10',
    'gnv':               'GNV',
  };

  // Busca padrão: "COMBUSTIVEL R$ PRECO | POSTO" ou variações no HTML
  for (const [label, tipo] of Object.entries(fuelLabels)) {
    const re = new RegExp(`${label}[\\s\\S]{0,80}?R\\$\\s*([\\d,\\.]+)[\\s\\S]{0,60}?([A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ][A-ZÀ-Ú\\s&.,-]{3,60})`, 'gi');
    const m = re.exec(html);
    if (m && !bestPrices[tipo]) {
      const preco = parseFloat(m[1].replace(',','.'));
      const posto = m[2].trim().replace(/\s+/g,' ');
      if (preco > 1 && preco < 20 && posto.length > 2) {
        bestPrices[tipo] = { preco, posto };
      }
    }
  }

  // ── Cards de posto ────────────────────────────────────────────────────────
  // Divide o HTML em blocos por h3 (cada posto é um card com h3)
  const blocks = html.split(/<h3[\s>]/i);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];

    // Nome — bloco começa com: class="...">NOME DO POSTO</h3>
    const nomeM = block.match(/^[^>]*>([^<]{2,100})<\/h3>/i);
    if (!nomeM) continue;
    const nome = nomeM[1].trim()
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
      .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n))
      .replace(/\s+/g,' ');
    if (nome.length < 2 || /melhores|preços|postos|busca|filtro/i.test(nome)) continue;

    // Endereço — padrão logradouro brasileiro
    const endM = block.match(/(?:Rua|Avenida|Av\b|Rod(?:ovia)?\.?|Alameda|Travessa|Praça|Estrada|BR-?\d{2,3}|Rodovia|Largo)[^<]{5,150}/i);
    const endereco = endM ? endM[0].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim() : '';

    // Bandeira
    let bandeira = 'Branco';
    if (/petrobras|br distribui/i.test(block)) bandeira = 'Petrobras';
    else if (/ipiranga/i.test(block)) bandeira = 'Ipiranga';
    else if (/shell|raizen/i.test(block)) bandeira = 'Shell';
    else if (/\bale\b/i.test(block)) bandeira = 'Ale';

    // Preços reais que aparecem no card
    const precos: Record<string, number> = {};

    for (const [label, tipo] of Object.entries(fuelLabels)) {
      const re = new RegExp(`${label}[^R<]{0,30}R\\$\\s*([\\d,\\.]+)`, 'i');
      const m = block.match(re);
      if (m) {
        const v = parseFloat(m[1].replace(',','.'));
        if (v > 1 && v < 20) precos[tipo] = v;
      }
    }

    if (nome.length >= 3) {
      stations.push({ nome, endereco, bandeira, precos });
    }
  }

  return { stations: stations.slice(0, 30), bestPrices };
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cidade = (searchParams.get('cidade') || '').trim();

  if (!cidade) {
    return NextResponse.json({ error: 'Informe cidade' }, { status: 400 });
  }

  const uf = await getStateUF(cidade);
  if (!uf) {
    return NextResponse.json({ error: 'Cidade não encontrada no Brasil' }, { status: 404 });
  }

  const stateSlug = UF_TO_STATE_SLUG[uf];
  const cidadeSlug = toSlug(cidade);
  const url = `https://dedurapreco.com/preco-do-combustivel/${stateSlug}/${cidadeSlug}`;

  let html = '';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return NextResponse.json({ error: `dedurapreco retornou ${res.status}` }, { status: 404 });
    html = await res.text();
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  const { stations, bestPrices } = parseDeduraHtml(html);

  if (stations.length === 0) {
    return NextResponse.json({ error: 'Nenhum posto encontrado no dedurapreco.com' }, { status: 404 });
  }

  // Preços regionais ANP para completar o que não veio do dedura
  const anpPrices = getANP(uf);

  const cityCenter = await getCityCenter(cidade);

  // Geocodifica em lotes de 4
  const results: any[] = [];
  const BATCH = 4;

  for (let i = 0; i < stations.length; i += BATCH) {
    const batch = stations.slice(i, i + BATCH);
    const geocoded = await Promise.all(
      batch.map(async (posto, idx) => {
        // Coordenadas
        let coords = { ...cityCenter };
        if (posto.endereco.length > 5) {
          const geo = await geocodeAddress(posto.endereco, cidade);
          if (geo) coords = geo;
          else { coords.lat += (Math.random()-0.5)*0.01; coords.lon += (Math.random()-0.5)*0.01; }
        } else {
          coords.lat += (Math.random()-0.5)*0.01; coords.lon += (Math.random()-0.5)*0.01;
        }

        const stationId = `dedura-${i+idx}`;
        const nomePosto = posto.nome;

        const stationInfo = {
          id: stationId, osm_id: null,
          nome: nomePosto, bandeira: posto.bandeira,
          endereco: posto.endereco || cidade,
          cidade, estado: uf.toUpperCase(),
          latitude: coords.lat, longitude: coords.lon,
          ticket_log: false,
        };

        const entries: any[] = [];

        for (const tipo of ALL_FUELS) {
          let preco: number | null = null;
          let fonte = 'dedurapreco.com';

          // 1. Preço real do card do posto
          if (posto.precos[tipo]) {
            preco = posto.precos[tipo];
          }
          // 2. Preço do "Melhores Preços" se este posto é o mencionado
          else if (bestPrices[tipo]) {
            const bp = bestPrices[tipo];
            const nomeNorm = nomePosto.toLowerCase().replace(/\s+/g,'');
            const bpNorm = bp.posto.toLowerCase().replace(/\s+/g,'');
            if (nomeNorm.includes(bpNorm.slice(0,8)) || bpNorm.includes(nomeNorm.slice(0,8))) {
              preco = bp.preco;
            }
          }
          // 3. Estimativa regional ANP
          if (!preco && anpPrices[tipo]) {
            preco = anpPrices[tipo];
            fonte = 'estimativa regional';
          }

          if (preco && preco > 0) {
            entries.push({
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

        // Se não tem nenhum preço
        if (entries.length === 0) {
          entries.push({
            id: `sem-preco-${stationId}`,
            tipo_combustivel: 'sem_preco', preco: 0,
            data_atualizacao: new Date().toISOString(),
            reportado_por: 'dedurapreco.com',
            ticket_log: 'Não', stations: stationInfo,
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
    cidade,
  });
}
