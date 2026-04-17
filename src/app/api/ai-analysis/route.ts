import { NextRequest, NextResponse } from 'next/server';

const TAVILY_KEY = process.env.TAVILY_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

// ─── Tavily: busca web por preços reais na cidade ─────────────────────────────
async function searchWeb(cidade: string): Promise<string> {
  if (!TAVILY_KEY) return '';

  const queries = [
    `preço gasolina diesel etanol ${cidade} hoje`,
    `combustível ticket log ${cidade} posto`,
  ];

  const results: string[] = [];

  for (const query of queries) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_KEY,
          query,
          search_depth: 'basic',
          max_results: 4,
          include_answer: true,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) continue;
      const data = await res.json();

      if (data.answer) results.push(`🔎 ${query}:\n${data.answer}`);

      (data.results || []).forEach((r: any) => {
        if (r.content) {
          results.push(`📰 ${r.title}:\n${r.content.slice(0, 400)}`);
        }
      });
    } catch {
      // ignora falha de uma query e continua
    }
  }

  return results.join('\n\n');
}

// ─── Groq: analisa dados e gera recomendação ──────────────────────────────────
async function analyzeWithGroq(prompt: string): Promise<string> {
  if (!GROQ_KEY) throw new Error('GROQ_API_KEY não configurada');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq retornou ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'Análise indisponível.';
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const { cidade, prices, userLocation } = await request.json();

    if (!cidade) {
      return NextResponse.json({ error: 'Cidade obrigatória' }, { status: 400 });
    }

    if (!GROQ_KEY) {
      return NextResponse.json({
        analysis: '⚙️ Configure `GROQ_API_KEY` no arquivo `.env.local` para ativar a análise.',
      });
    }

    // 1. Busca web por dados recentes (Tavily)
    const webContext = await searchWeb(cidade);

    // 2. Monta lista de postos com preços reais (do OpenStreetMap + Supabase)
    const realPrices = (prices || []).filter((p: any) => p.preco > 0);
    const postosList =
      realPrices.length > 0
        ? realPrices
            .map(
              (p: any) =>
                `- ${p.stations.nome} (${p.stations.bandeira}): ${p.tipo_combustivel} R$ ${Number(p.preco).toFixed(3)}` +
                (p.ticket_log === 'Sim' ? ' ✅ Ticket Log' : '')
            )
            .join('\n')
        : 'Nenhum preço cadastrado ainda para essa cidade.';

    const locationCtx = userLocation
      ? `Localização do usuário: Lat ${userLocation.lat}, Lon ${userLocation.lng}`
      : 'Localização não informada.';

    // 3. Monta prompt combinando dados reais + pesquisa web
    const prompt = `Você é um consultor especialista em abastecimento e gestão de frotas no Brasil.

CIDADE ANALISADA: ${cidade}
${locationCtx}

=== PREÇOS REAIS CADASTRADOS (OpenStreetMap + Comunidade) ===
${postosList}

=== PESQUISA WEB RECENTE (Tavily) ===
${webContext || 'Pesquisa web indisponível no momento.'}

=== SUA ANÁLISE (responda em português) ===
Com base nos dados acima, forneça:

1. **Resumo de Preços** — faixa de preço atual em ${cidade} por tipo de combustível
2. **Melhor Posto** — cite o nome exato do posto mais barato dos dados cadastrados
3. **Ticket Log** — quais postos aceitam (badge ✅) e vale a pena para frota?
4. **Recomendação Final** — uma frase direta: "Para sua frota, recomendo abastecer no [NOME] com [COMBUSTÍVEL] a R$ [VALOR]"

Use formatação markdown (negrito, listas). Seja direto e preciso. Não invente dados — use apenas o que está nos dados acima.`;

    const analysis = await analyzeWithGroq(prompt);

    return NextResponse.json({ analysis });
  } catch (err: any) {
    console.error('[AI Analysis erro]:', err.message);
    return NextResponse.json(
      { analysis: `⚠️ Erro na análise: ${err.message}` },
      { status: 500 }
    );
  }
}
