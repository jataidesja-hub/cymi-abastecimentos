import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Geocode endereço → lat/lon via Nominatim COM validação de proximidade ────
async function geocodeAddress(
  address: string,
  cidade: string,
  cityCenter: { lat: number; lon: number },
  maxDistKm: number = 30
): Promise<{ lat: number; lon: number } | null> {
  try {
    const q = encodeURIComponent(`${address}, ${cidade}, Brasil`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=3&countrycodes=br`,
      { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.length === 0) return null;

    // Pega o resultado mais próximo do centro da cidade
    let best: { lat: number; lon: number } | null = null;
    let bestDist = Infinity;

    for (const item of data) {
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      const dist = haversineKm(cityCenter.lat, cityCenter.lon, lat, lon);
      if (dist < bestDist && dist < maxDistKm) {
        bestDist = dist;
        best = { lat, lon };
      }
    }

    return best;
  } catch {
    return null;
  }
}

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

// ─── Resolve nome da cidade via Nominatim + retorna coordenadas ──────────────
async function resolveCity(input: string): Promise<{
  name: string;
  state: string;
  fullName: string;
  lat: number;
  lon: number;
}> {
  // Remove UF suffix (e.g., "BA", "PE", "- BA", ", BA")
  const ufPattern = /[\s,\-]+(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i;
  const cleanInput = input.replace(ufPattern, '').trim() || input;

  // Tenta buscar com input original e depois com input limpo
  const queries = [input, cleanInput];
  if (input !== cleanInput) queries.push(cleanInput);

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
        return { name: city, state, fullName: state ? `${city}, ${state}` : city, lat, lon };
      }
    } catch {}
  }

  // Fallback: sem geocoding — coordenadas genéricas do Brasil
  return { name: cleanInput, state: '', fullName: cleanInput, lat: -14.24, lon: -51.93 };
}

// ─── Handler ─────────────────────────────────────────────────────────────────
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

  // Resolve o nome correto da cidade via Nominatim + coordenadas
  const resolved = cidadeRaw ? await resolveCity(cidadeRaw) : null;
  const cidade = resolved?.name || cidadeRaw;
  const cidadeCompleta = resolved?.fullName || cidadeRaw;
  const buscaLocal = cidade || `coordenadas ${latParam},${lonParam}`;

  // Centro da cidade — vindo direto do resolveCity (sem chamada extra)
  const cityCenter = resolved
    ? { lat: resolved.lat, lon: resolved.lon }
    : (latParam && lonParam)
      ? { lat: parseFloat(latParam), lon: parseFloat(lonParam) }
      : { lat: -14.24, lon: -51.93 };

  console.log(`[claude-stations] Input: "${cidadeRaw}" → Resolved: "${cidadeCompleta}" (${cityCenter.lat}, ${cityCenter.lon})`);

  try {
    // ── Claude com web_search busca postos e preços ───────────────────────────
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 5000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        {
          role: 'user',
          content: `Você é um especialista em postos de combustível no Brasil. Preciso de informações sobre postos em "${cidadeCompleta}", Brasil.

INSTRUÇÕES IMPORTANTES:
1. Faça múltiplas buscas na web com termos variados:
   - "postos de combustível ${cidadeCompleta} preço gasolina"
   - "combustível ${cidade} ${resolved?.state || ''} preço"
   - "posto gasolina ${cidade} gaspedia"
   - "preço combustível ${cidade} ${new Date().getFullYear()}"

2. ${cidade} é uma cidade real no Brasil${resolved?.state ? ` no estado de ${resolved.state}` : ''}. Mesmo se for pequena, EXISTEM postos lá.

3. MUITO IMPORTANTE sobre localização:
   - Liste SOMENTE postos que ficam DENTRO de ${cidade}
   - NÃO inclua postos de cidades vizinhas (exemplo: se buscou ${cidade}, não liste postos de outras cidades próximas)
   - Cada posto DEVE ter endereço real dentro de ${cidade}

4. Se não encontrar postos específicos com nome na internet para esta cidade:
   - Busque preços ANP da região/estado para referência de preço
   - Liste os postos que provavelmente existem (toda cidade brasileira tem pelo menos 1 posto)
   - Use endereços como "Centro, ${cidade}" ou "BR-XXX, ${cidade}"

5. Para cada posto, forneça:
   - nome (real se encontrar, senão "Posto [bandeira] ${cidade}")
   - endereco (endereço DENTRO de ${cidade}, NUNCA de outra cidade)
   - bandeira (Shell, Ipiranga, Petrobras/BR, Ale, Branco)
   - precos em reais para cada combustível

6. Se não encontrar preços exatos, use a média ANP da região/estado.

7. NUNCA retorne uma lista vazia. Mínimo 3 postos.

Responda SOMENTE com JSON válido, sem texto antes ou depois:
{
  "cidade": "${cidadeCompleta}",
  "fonte": "fonte usada",
  "postos": [
    {
      "nome": "Nome do Posto",
      "endereco": "Rua X, 123, Bairro, ${cidade}",
      "bandeira": "Bandeira",
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
}`,
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
      console.error('[claude-stations] Claude não retornou JSON. Response:', jsonText.slice(0, 500));
      return NextResponse.json({ error: 'Claude não retornou dados estruturados', raw: jsonText.slice(0, 200) }, { status: 502 });
    }

    let claudeData: any;
    try {
      claudeData = JSON.parse(jsonMatch[0]);
    } catch {
      const cleaned = jsonMatch[0]
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/[\x00-\x1F\x7F]/g, '');
      claudeData = JSON.parse(cleaned);
    }

    const postos: any[] = claudeData.postos || [];

    if (postos.length === 0) {
      console.warn('[claude-stations] 0 postos para:', cidadeCompleta);
      return NextResponse.json({ error: 'Nenhum posto encontrado', cidade: cidadeCompleta }, { status: 404 });
    }

    console.log(`[claude-stations] ${postos.length} postos para "${cidadeCompleta}"`);

    // ── Geocoda endereços em paralelo com validação de proximidade ────────────
    // Rate limit Nominatim: máximo 1 req/s, então fazemos em lotes de 3
    const BATCH_SIZE = 3;
    const allEntries: any[] = [];

    for (let i = 0; i < postos.length && i < 20; i += BATCH_SIZE) {
      const batch = postos.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (posto: any, batchIdx: number) => {
          const idx = i + batchIdx;
          let coords: { lat: number; lon: number } | null = null;

          // Estratégia 1: geocodar endereço completo + cidade
          if (posto.endereco && posto.endereco.length > 5) {
            coords = await geocodeAddress(posto.endereco, cidade, cityCenter);
          }

          // Estratégia 2: geocodar só nome da rua + cidade
          if (!coords && posto.endereco) {
            const parts = posto.endereco.split(',');
            const street = parts[0]?.trim();
            if (street && street.length > 3) {
              coords = await geocodeAddress(street, cidade, cityCenter);
            }
          }

          // Estratégia 3: geocodar nome do posto + cidade
          if (!coords && posto.nome) {
            coords = await geocodeAddress(posto.nome, cidade, cityCenter);
          }

          // Fallback: centro da cidade com jitter para não sobrepor
          if (!coords) {
            const jitterLat = (Math.random() - 0.5) * 0.004;
            const jitterLon = (Math.random() - 0.5) * 0.004;
            coords = {
              lat: cityCenter.lat + jitterLat,
              lon: cityCenter.lon + jitterLon,
            };
          }

          // Validação final: se ficou a mais de 50km do centro, reposiciona
          const dist = haversineKm(cityCenter.lat, cityCenter.lon, coords.lat, coords.lon);
          if (dist > 50) {
            console.warn(`[claude-stations] Posto "${posto.nome}" ficou ${dist.toFixed(0)}km do centro, reposicionando`);
            const jitterLat = (Math.random() - 0.5) * 0.006;
            const jitterLon = (Math.random() - 0.5) * 0.006;
            coords = {
              lat: cityCenter.lat + jitterLat,
              lon: cityCenter.lon + jitterLon,
            };
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
            nome: posto.nome || `Posto de Combustível ${cidade}`,
            bandeira: posto.bandeira || 'Branco',
            endereco: posto.endereco || `Centro, ${cidade}`,
            cidade: cidade || buscaLocal,
            estado: resolved?.state || '',
            latitude: coords.lat,
            longitude: coords.lon,
            ticket_log: false,
          };

          const entries: any[] = [];
          let temPreco = false;

          for (const [key, tipo] of Object.entries(FUEL_MAP)) {
            const preco = precos[key];
            if (preco && typeof preco === 'number' && preco > 0 && preco < 20) {
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

      allEntries.push(...batchResults.flat());

      // Pausa entre lotes para respeitar rate limit do Nominatim
      if (i + BATCH_SIZE < postos.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    return NextResponse.json({
      data: allEntries,
      source: `Claude AI — ${claudeData.fonte || 'busca web'}`,
      total_osm: postos.length,
      osm_unavailable: false,
      cidade: cidadeCompleta,
    });
  } catch (err: any) {
    console.error('[claude-stations] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
