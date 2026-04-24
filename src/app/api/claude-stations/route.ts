import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Geocode endereço → lat/lon via Nominatim ────────────────────────────────
async function geocodeAddress(address: string, cidade: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const q = encodeURIComponent(`${address}, ${cidade}, Brasil`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br`,
      { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data[0]) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

// ─── Geocode centro da cidade ─────────────────────────────────────────────────
async function getCityCenter(cidade: string): Promise<{ lat: number; lon: number }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cidade + ', Brasil')}&format=json&limit=1&countrycodes=br`,
      { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    if (data[0]) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {}
  return { lat: -9.39, lon: -40.50 };
}

// ─── Normaliza nome da cidade (acentos, abreviações de estado) ───────────────
function normalizeCityName(input: string): string {
  // Remove UF no final: "Curaça BA" → "Curaçá"
  // Adiciona acentos comuns que faltam
  let city = input.trim();

  // Mapeamento de cidades com erros comuns de digitação
  const corrections: Record<string, string> = {
    'curaca': 'Curaçá',
    'curaça': 'Curaçá',
    'paulo afonso': 'Paulo Afonso',
    'petrolina': 'Petrolina',
    'juazeiro': 'Juazeiro',
    'feira de santana': 'Feira de Santana',
    'vitoria da conquista': 'Vitória da Conquista',
    'aracaju': 'Aracaju',
    'maceio': 'Maceió',
    'joao pessoa': 'João Pessoa',
    'recife': 'Recife',
    'natal': 'Natal',
    'teresina': 'Teresina',
    'sao luis': 'São Luís',
    'belem': 'Belém',
    'manaus': 'Manaus',
    'goiania': 'Goiânia',
    'brasilia': 'Brasília',
    'cuiaba': 'Cuiabá',
    'campo grande': 'Campo Grande',
    'sao paulo': 'São Paulo',
    'rio de janeiro': 'Rio de Janeiro',
    'belo horizonte': 'Belo Horizonte',
    'salvador': 'Salvador',
    'fortaleza': 'Fortaleza',
  };

  // Remove UF suffix (e.g., "BA", "PE", "- BA", ", BA")
  const ufPattern = /[\s,\-]+(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i;
  const cleanCity = city.replace(ufPattern, '').trim();

  const key = cleanCity.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (corrections[key]) return corrections[key];

  return cleanCity || city;
}

// ─── Resolve nome da cidade via Nominatim ────────────────────────────────────
async function resolveCity(input: string): Promise<{ name: string; state: string; fullName: string }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input + ', Brasil')}&format=json&limit=1&addressdetails=1&featuretype=city`,
      { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    if (data[0]) {
      const city = data[0].address?.city || data[0].address?.town ||
        data[0].address?.municipality || data[0].address?.village || data[0].name || input;
      const state = data[0].address?.state || '';
      return { name: city, state, fullName: state ? `${city}, ${state}` : city };
    }
  } catch {}
  const normalized = normalizeCityName(input);
  return { name: normalized, state: '', fullName: normalized };
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

  // Resolve o nome correto da cidade via Nominatim
  const resolved = cidadeRaw ? await resolveCity(cidadeRaw) : null;
  const cidade = resolved?.name || cidadeRaw;
  const cidadeCompleta = resolved?.fullName || cidadeRaw;
  const buscaLocal = cidade || `coordenadas ${latParam},${lonParam}`;

  console.log(`[claude-stations] Input: "${cidadeRaw}" → Resolved: "${cidadeCompleta}"`);

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
   - "combustível ${cidade} ${resolved?.state || 'Bahia'} preço"
   - "posto gasolina ${cidade} gaspedia"
   - "preço combustível ${cidade} ${new Date().getFullYear()}"

2. ${cidade} é uma cidade real no Brasil${resolved?.state ? ` no estado de ${resolved.state}` : ''}. Mesmo se for pequena, EXISTEM postos lá.

3. Se não encontrar postos específicos com nome na internet para esta cidade:
   - Pesquise a cidade vizinha mais próxima para ter referência de preço
   - Busque preços ANP da região/estado
   - Liste os postos que provavelmente existem (toda cidade brasileira tem pelo menos 1 posto)
   - Use nomes genéricos como "Posto de Combustível ${cidade}" se necessário

4. Para cada posto encontrado ou estimado, forneça:
   - nome (real ou estimado)
   - endereco (use nomes de ruas reais se possível, ou "Centro, ${cidade}")
   - bandeira (Shell, Ipiranga, Petrobras/BR, Ale, Branco)
   - precos em reais para cada combustível

5. Se não encontrar preços exatos, use a média ANP da região/estado.

6. NUNCA retorne uma lista vazia. Mínimo 3 postos.

Responda SOMENTE com JSON válido, sem texto antes ou depois:
{
  "cidade": "${cidadeCompleta}",
  "fonte": "fonte usada",
  "postos": [
    {
      "nome": "Nome do Posto",
      "endereco": "Endereço completo",
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
      console.error('[claude-stations] Claude não retornou JSON válido. Response:', jsonText.slice(0, 500));
      return NextResponse.json({ error: 'Claude não retornou dados estruturados', raw: jsonText.slice(0, 200) }, { status: 502 });
    }

    let claudeData: any;
    try {
      claudeData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('[claude-stations] JSON parse error:', parseErr);
      // Tenta limpar o JSON
      const cleaned = jsonMatch[0]
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/[\x00-\x1F\x7F]/g, '');
      claudeData = JSON.parse(cleaned);
    }

    const postos: any[] = claudeData.postos || [];

    if (postos.length === 0) {
      console.warn('[claude-stations] Claude retornou 0 postos para:', cidadeCompleta);
      return NextResponse.json({ error: 'Nenhum posto encontrado', cidade: cidadeCompleta }, { status: 404 });
    }

    console.log(`[claude-stations] Claude encontrou ${postos.length} postos para "${cidadeCompleta}"`);

    // ── Geocoda endereços em paralelo ─────────────────────────────────────────
    const cityCenter = await getCityCenter(cidade || buscaLocal);

    const geocodedPostos = await Promise.all(
      postos.slice(0, 20).map(async (posto: any, idx: number) => {
        let coords = cityCenter;
        if (posto.endereco && posto.endereco.length > 5) {
          const geo = await geocodeAddress(posto.endereco, cidade || buscaLocal);
          if (geo) coords = geo;
          else {
            // Tenta geocodar só com o nome da rua + cidade
            const simpleAddr = posto.endereco.split(',')[0];
            if (simpleAddr && simpleAddr.length > 3) {
              const geo2 = await geocodeAddress(simpleAddr, cidade || buscaLocal);
              if (geo2) coords = geo2;
            }
          }
        }

        // Pequeno offset para postos no mesmo ponto não sobreporem
        const jitterLat = (Math.random() - 0.5) * 0.002;
        const jitterLon = (Math.random() - 0.5) * 0.002;
        if (coords.lat === cityCenter.lat && coords.lon === cityCenter.lon) {
          coords = { lat: coords.lat + jitterLat, lon: coords.lon + jitterLon };
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

    const result = geocodedPostos.flat();

    return NextResponse.json({
      data: result,
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
