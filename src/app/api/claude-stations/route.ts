import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Distância em km entre dois pontos (Haversine) ───────────────────────────
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Normaliza nome da cidade (remove UF, ex: "Curaça BA" -> "Curaçá") ────────
function normalizeCityName(input: string): string {
  let city = input.trim();
  const ufPattern = /[\s,\-]+(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i;
  const cleanCity = city.replace(ufPattern, '').trim();

  const corrections: Record<string, string> = {
    'curaca': 'Curaçá',
    'curaça': 'Curaçá',
    'paulo afonso': 'Paulo Afonso',
    'juazeiro': 'Juazeiro',
  };

  const key = cleanCity.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (corrections[key]) return corrections[key];

  return cleanCity || city;
}

// ─── Geocode centro da cidade ─────────────────────────────────────────────────
async function getCityCenter(cidade: string): Promise<{ lat: number; lon: number; name: string }> {
  const cleanName = normalizeCityName(cidade);
  const queries = [cidade, cleanName];

  for (const q of queries) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Brasil')}&format=json&limit=1&countrycodes=br`,
        { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(4000) }
      );
      const data = await res.json();
      if (data[0]) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), name: cleanName };
    } catch {}
  }
  // Fallback genérico para o Brasil se tudo falhar (não Petrolina)
  return { lat: -14.24, lon: -51.93, name: cleanName };
}

// ─── Geocode endereço → lat/lon via Nominatim com validação de distância ──────
async function geocodeAddress(address: string, cidadeName: string, cityCenter: { lat: number; lon: number }): Promise<{ lat: number; lon: number } | null> {
  try {
    const q = encodeURIComponent(`${address}, ${cidadeName}, Brasil`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=3&countrycodes=br`,
      { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.length === 0) return null;

    let best: { lat: number; lon: number } | null = null;
    let bestDist = Infinity;

    for (const item of data) {
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      const dist = haversineKm(cityCenter.lat, cityCenter.lon, lat, lon);
      // O endereço geocodificado não pode estar a mais de 25km do centro da cidade
      if (dist < bestDist && dist < 25) {
        bestDist = dist;
        best = { lat, lon };
      }
    }

    return best;
  } catch {
    return null;
  }
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 503 });
  }

  const buscaLocal = cidade || `coordenadas ${latParam},${lonParam}`;
  
  // Identifica o centro da cidade antes para usar no prompt
  const cityInfo = await getCityCenter(cidade || buscaLocal);

  try {
    // ── Claude com web_search busca postos e preços ───────────────────────────
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        {
          role: 'user',
          content: `Você é um assistente que encontra postos de combustível com preços reais e atuais.

Pesquise na internet: "postos de combustível ${cityInfo.name} preços gasolina etanol diesel"

Também pesquise: "postos ${cityInfo.name} gaspedia OR waze OR cnpj posto"

Com base nos resultados, monte uma lista dos postos de combustível encontrados ESPECIFICAMENTE em ${cityInfo.name}, Brasil.
REGRA ABSOLUTA: NÃO INVENTE nomes ou endereços. Liste APENAS postos REAIS que você confirmar a existência na cidade através da sua busca na web. É preferível retornar menos postos do que postos inventados. Se não encontrar nenhum posto real, retorne uma lista vazia "postos": [].

Para cada posto real encontrado, forneça:
- nome do posto (Nome real)
- endereço (Endereço real DENTRO da cidade ${cityInfo.name})
- bandeira (Shell, Ipiranga, Petrobras/BR, Ale, Branco)
- preços em reais para: gasolina comum, gasolina aditivada, etanol, diesel s10, diesel s500, gnv

Se encontrar o posto mas não encontrar os preços específicos dele, use a média atual da cidade/região para preencher os valores.

Responda SOMENTE com JSON válido, sem texto antes ou depois:
{
  "cidade": "${cityInfo.name}",
  "fonte": "nome do site ou fonte usada para achar os postos reais",
  "postos": [
    {
      "nome": "Posto X (Real)",
      "endereco": "Av. Y, 123, Bairro, Cidade",
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

Lembre-se: Nomes e endereços devem ser os REAIS encontrados na internet. Use null para preços não encontrados.`,
        },
      ],
    });

    // ── Extrai o JSON da resposta do Claude ───────────────────────────────────
    let jsonText = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        jsonText += block.text;
      }
    }

    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Claude não retornou dados estruturados' }, { status: 502 });
    }

    let claudeData: any;
    try {
      claudeData = JSON.parse(jsonMatch[0]);
    } catch {
      const cleaned = jsonMatch[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      claudeData = JSON.parse(cleaned);
    }
    
    const postos: any[] = claudeData.postos || [];

    if (postos.length === 0) {
      return NextResponse.json({ error: 'Nenhum posto encontrado na busca' }, { status: 404 });
    }

    // ── Geocoda endereços em paralelo ─────────────────────────────────────────
    const cityCenter = { lat: cityInfo.lat, lon: cityInfo.lon };

    const geocodedPostos = await Promise.all(
      postos.slice(0, 20).map(async (posto: any, idx: number) => {
        let coords = { ...cityCenter };
        let hasExactLocation = false;
        
        if (posto.endereco && posto.endereco.length > 3) {
          const geo = await geocodeAddress(posto.endereco, cityInfo.name, cityCenter);
          if (geo) {
            coords = geo;
            hasExactLocation = true;
          } else {
            // Tenta geocodar apenas o nome do posto
            if (posto.nome && posto.nome.length > 5) {
              const geoNome = await geocodeAddress(posto.nome, cityInfo.name, cityCenter);
              if (geoNome) {
                coords = geoNome;
                hasExactLocation = true;
              }
            }
          }
        }

        // Adiciona um pequeno jitter para postos que caem exatamente no centro da cidade
        if (!hasExactLocation) {
          const jitterLat = (Math.random() - 0.5) * 0.005; // ~250m
          const jitterLon = (Math.random() - 0.5) * 0.005; // ~250m
          coords.lat += jitterLat;
          coords.lon += jitterLon;
        }

        const precos = posto.precos || {};
        const FUEL_MAP: Record<string, string> = {
          gasolina_comum: 'Gasolina Comum',
          gasolina_aditivada: 'Gasolina Aditivada',
          etanol: 'Etanol',
          diesel_s10: 'Diesel S10',
          diesel_s500: 'Diesel S500',
          gnv: 'GNV',
        };

        const stationId = `claude-${idx}-${Date.now()}`;
        const stationInfo = {
          id: stationId,
          osm_id: null,
          nome: posto.nome || 'Posto de Combustível',
          bandeira: posto.bandeira || 'Branco',
          endereco: posto.endereco || cityInfo.name,
          cidade: cityInfo.name,
          estado: '',
          latitude: coords.lat,
          longitude: coords.lon,
          ticket_log: false,
        };

        const entries: any[] = [];
        let temPreco = false;

        for (const [key, tipo] of Object.entries(FUEL_MAP)) {
          const preco = precos[key];
          if (preco && typeof preco === 'number' && preco > 0) {
            temPreco = true;
            entries.push({
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
          entries.push({
            id: `sem-preco-${stationId}`,
            tipo_combustivel: 'sem_preco',
            preco: 0,
            data_atualizacao: new Date().toISOString(),
            reportado_por: 'Claude AI',
            ticket_log: 'Não',
            stations: stationInfo,
          });
        }

        return entries;
      })
    );

    const result = geocodedPostos.flat();

    return NextResponse.json({
      data: result,
      source: `Claude AI — ${claudeData.fonte || 'busca web'}`,
      total_osm: postos.length,
      osm_unavailable: false,
      cidade: cityInfo.name,
    });
  } catch (err: any) {
    console.error('[claude-stations]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
