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

  console.log(`Buscando postos via IA para: ${cidade}`);

  if (!cidade) {
    return NextResponse.json({ error: 'Cidade é obrigatória' }, { status: 400 });
  }

  try {
    const openAIKey = process.env.OPENAI_API_KEY;
    if (!openAIKey) {
      console.error("ERRO: OPENAI_API_KEY não configurada!");
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
                "preco": 5.89,
                "data_atualizacao": "2026-04-15T00:00:00Z",
                "reportado_por": "IA Pesquisa",
                "stations": {
                  "id": "st-ai-1",
                  "nome": "NOME DO POSTO",
                  "bandeira": "SHELL",
                  "endereco": "AVENIDA PRINCIPAL, 100",
                  "cidade": "${cidade}",
                  "estado": "UF",
                  "latitude": -9.38,
                  "longitude": -40.50
                }
              }
            ]
          }`
        }],
        response_format: { type: "json_object" }
      })
    });

    const aiData = await aiResponse.json();
    
    if (aiData.error) {
      console.error("Erro da OpenAI API:", aiData.error);
      throw new Error(aiData.error.message || "Erro na API da OpenAI");
    }

    if (!aiData.choices?.[0]?.message?.content) {
      console.error("Resposta da OpenAI vazia:", aiData);
      throw new Error("Falha na resposta da IA");
    }

    const content = aiData.choices[0].message.content;
    const parsed = JSON.parse(content);
    let results = parsed.data || [];

    console.log(`IA retornou ${results.length} postos para ${cidade}`);

    if (tipo && tipo !== 'Todos') {
      results = results.filter((item: any) => item.tipo_combustivel === tipo);
    }

    results.sort((a: any, b: any) => a.preco - b.preco);

    return NextResponse.json({ 
      data: results, 
      total: results.length,
      source: 'IA Pesquisa Real-time'
    });

  } catch (err: any) {
    console.error('Erro crítico na Rota de IA:', err);
    return NextResponse.json({ error: 'Erro ao pesquisar via IA', details: err.message }, { status: 500 });
  }
}



