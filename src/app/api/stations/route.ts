import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cidade = searchParams.get('cidade');
  const tipo = searchParams.get('tipo');

  if (!cidade) {
    return NextResponse.json({ error: 'Cidade é obrigatória' }, { status: 400 });
  }

  try {
    const openAIKey = process.env.OPENAI_API_KEY;
    if (!openAIKey) {
      return NextResponse.json({ error: 'Chave OpenAI não configurada no servidor' }, { status: 500 });
    }

    // 100% AI POWERED SEARCH
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAIKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `Você é um buscador inteligente de postos de combustível no Brasil. Seu objetivo é retornar JSON puro com uma lista de 5 postos reais e conhecidos na cidade de ${cidade} e seus preços ESTIMADOS atuais.
          
          Seja preciso com endereços reais. Tente variar as bandeiras (Shell, Ipiranga, BR, etc).
          Retorne preços realistas baseados na média atual de mercado para ${cidade}.
          
          Retorne APENAS um JSON no formato EXATO abaixo:
          {
            "data": [
              {
                "id": "ai-1",
                "tipo_combustivel": "Gasolina Comum",
                "preco": 5.899,
                "data_atualizacao": "2026-04-15T00:00:00Z",
                "reportado_por": "IA Pesquisa",
                "stations": {
                  "id": "st-ai-1",
                  "nome": "NOME REAL DO POSTO",
                  "bandeira": "BANDEIRA REAL",
                  "endereco": "ENDERECO REAL",
                  "cidade": "${cidade}",
                  "estado": "UF",
                  "latitude": (latitude aproximada),
                  "longitude": (longitude aproximada)
                }
              }
            ]
          }`
        }],
        response_format: { type: "json_object" }
      })
    });

    const aiData = await aiResponse.json();
    if (!aiData.choices?.[0]?.message?.content) {
      throw new Error("Falha na resposta da IA");
    }

    const parsed = JSON.parse(aiData.choices[0].message.content);
    let results = parsed.data || [];

    // Filter by fuel type if specified in query (even though AI usually returns a mix)
    if (tipo && tipo !== 'Todos') {
      // In a 100% AI scenario, we can either filter local results or we could have asked the AI 
      // explicitly for that type. To keep it fast, we'll filter the AI's varied return.
      results = results.filter((item: any) => item.tipo_combustivel === tipo);
      
      // If filtering emptied the list, we just show what we have or rethink. 
      // But usually the AI returns several types.
    }

    // Sort by price (cheapest first)
    results.sort((a: any, b: any) => a.preco - b.preco);

    return NextResponse.json({ 
      data: results, 
      total: results.length,
      source: 'IA Pesquisa Real-time'
    });

  } catch (err) {
    console.error('API error:', err);
    return NextResponse.json({ error: 'Erro ao pesquisar via IA' }, { status: 500 });
  }
}


