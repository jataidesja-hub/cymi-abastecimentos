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

// ─── Geocode centro da cidade (fallback para postos sem endereço) ─────────────
async function getCityCenter(cidade: string): Promise<{ lat: number; lon: number }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cidade + ', Brasil')}&format=json&limit=1&countrycodes=br`,
      { headers: { 'User-Agent': 'CombustivelApp/1.0' }, signal: AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    if (data[0]) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {}
  return { lat: -9.39, lon: -40.50 }; // fallback Petrolina
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

  try {
    // ── Claude com web_search busca postos e preços ───────────────────────────
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        {
          role: 'user',
          content: `Pesquise na internet os preços REAIS e ATUAIS de combustível em postos de ${buscaLocal}, Brasil.

Faça as seguintes pesquisas:
1. "preço gasolina ${buscaLocal} 2025 posto"
2. "preço etanol diesel ${buscaLocal} hoje"
3. site:dedurapreco.com "${buscaLocal}"
4. "postos ${buscaLocal} gaspedia OR waze"

IMPORTANTE:
- Retorne APENAS postos com dados encontrados na web — NÃO invente postos ou preços.
- Busque o NOME REAL do posto. Não responda "Posto (sem nome identificado)". Se achou apenas o endereço, tente buscar no Google/Waze qual posto fica nesse endereço.
- Cada posto pode ter preços DIFERENTES entre si — NÃO use o mesmo valor para todos.
- Use null para combustíveis que não encontrou para aquele posto específico.
- O endereço deve ser o real encontrado na busca (rua, número, bairro).
- A bandeira deve ser a real do posto (Shell, Ipiranga, Petrobras/BR, Ale, Branco).

Responda SOMENTE com JSON válido:
{
  "cidade": "${buscaLocal}",
  "fonte": "nome do site usado",
  "postos": [
    {
      "nome": "Auto Posto Vale do São Francisco (Nome Real)",
      "endereco": "Avenida Guararapes, 2040A, Centro",
      "bandeira": "Petrobras",
      "precos": {
        "gasolina_comum": 6.29,
        "gasolina_aditivada": null,
        "etanol": 4.15,
        "diesel_s10": null,
        "diesel_s500": null,
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
      return NextResponse.json({ error: 'Claude não retornou dados estruturados' }, { status: 502 });
    }

    const claudeData = JSON.parse(jsonMatch[0]);
    const postos: any[] = claudeData.postos || [];

    if (postos.length === 0) {
      return NextResponse.json({ error: 'Nenhum posto encontrado na busca' }, { status: 404 });
    }

    // ── Geocoda endereços em paralelo (até 8 postos de uma vez) ───────────────
    const cityCenter = await getCityCenter(cidade || buscaLocal);

    const geocodedPostos = await Promise.all(
      postos.slice(0, 20).map(async (posto: any, idx: number) => {
        let coords = cityCenter;
        if (posto.endereco && posto.endereco.length > 5) {
          const geo = await geocodeAddress(posto.endereco, cidade || buscaLocal);
          if (geo) coords = geo;
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
          endereco: posto.endereco || cidade,
          cidade: cidade || buscaLocal,
          estado: '',
          latitude: coords.lat,
          longitude: coords.lon,
          ticket_log: false,
        };

        const entries: any[] = [];
        let temPreco = false;

        for (const [key, tipo] of Object.entries(FUEL_MAP)) {
          const precoRaw = precos[key];
          const preco = (typeof precoRaw === 'number' && precoRaw > 0) ? precoRaw : 0;
          
          if (preco > 0) {
            temPreco = true;
          }

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

        return entries;
      })
    );

    const result = geocodedPostos.flat();

    return NextResponse.json({
      data: result,
      source: `Claude AI — ${claudeData.fonte || 'busca web'}`,
      total_osm: postos.length,
      osm_unavailable: false,
      cidade: cidade || buscaLocal,
    });
  } catch (err: any) {
    console.error('[claude-stations]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
