import { NextRequest, NextResponse } from 'next/server';

const TAVILY_KEY = process.env.TAVILY_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

export async function GET(request: NextRequest) {
  const cidade = (new URL(request.url).searchParams.get('cidade') || '').trim();
  if (!cidade) return NextResponse.json({ error: 'cidade obrigatória' }, { status: 400 });

  if (!TAVILY_KEY || !GROQ_KEY) {
    return NextResponse.json({ error: 'Chaves de IA não configuradas' }, { status: 503 });
  }

  try {
    // 1. Tavily: busca preços reais na web
    const tavilyRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query: `preço gasolina etanol diesel ${cidade} Brasil ${new Date().getFullYear()} ANP`,
        search_depth: 'basic',
        max_results: 4,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!tavilyRes.ok) {
      return NextResponse.json({ error: 'Tavily indisponível' }, { status: 502 });
    }

    const tavilyData = await tavilyRes.json();
    const context = [
      tavilyData.answer || '',
      ...(tavilyData.results || []).map((r: any) => r.content || '').slice(0, 3),
    ].join('\n').slice(0, 2000);

    if (!context.trim()) {
      return NextResponse.json({ prices: null, message: 'Sem dados na web para essa cidade' });
    }

    // 2. Groq: extrai os preços em JSON
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{
          role: 'user',
          content: `Do texto abaixo, extraia preços de combustível em ${cidade}, Brasil.
Retorne SOMENTE um JSON, sem explicação.
Formato exato: {"gasolina_comum":6.49,"gasolina_aditivada":6.89,"etanol":4.29,"diesel_s10":6.19,"diesel_s500":5.99,"gnv":4.50}
Use null se não encontrar o tipo. Se não há preços de ${cidade}, use a média regional do estado.

Texto: ${context}`,
        }],
        temperature: 0.1,
        max_tokens: 120,
      }),
      signal: AbortSignal.timeout(7000),
    });

    if (!groqRes.ok) {
      return NextResponse.json({ error: 'Groq indisponível' }, { status: 502 });
    }

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content?.trim() || '';
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) {
      return NextResponse.json({ prices: null, message: 'Groq não retornou JSON válido' });
    }

    const prices = JSON.parse(match[0]);
    const hasValid = Object.values(prices).some(v => typeof v === 'number' && (v as number) > 0);
    if (!hasValid) {
      return NextResponse.json({ prices: null, message: 'Nenhum preço válido encontrado' });
    }

    return NextResponse.json({ prices, fonte: 'Tavily + Groq' });
  } catch (err: any) {
    console.error('[web-prices erro]:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
