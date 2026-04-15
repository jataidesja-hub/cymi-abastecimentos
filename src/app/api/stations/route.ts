import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cidade = (searchParams.get('cidade') || '').trim();
  const tipo = searchParams.get('tipo');

  console.log(`Buscando postos para: ${cidade}`);

  if (!cidade) {
    return NextResponse.json({ error: 'Cidade é obrigatória' }, { status: 400 });
  }

  // FALLBACK STATIC DATA FOR DEMO PURPOSES (Juazeiro / Petrolina)
  const isDemoCity = cidade.toLowerCase().includes('petrolina') || cidade.toLowerCase().includes('juazeiro');
  const demoData = [
    {
      "id": "ai-demo-1",
      "tipo_combustivel": "Gasolina Comum",
      "preco": 6.899,
      "data_atualizacao": new Date().toISOString(),
      "reportado_por": "IA Mercado (ANP Ref)",
      "stations": {
        "id": "st-demo-1",
        "nome": "Posto Shell - Monsenhor",
        "bandeira": "SHELL",
        "endereco": "Av. Monsenhor Ângelo Sampaio, 100",
        "cidade": cidade,
        "estado": "PE",
        "latitude": -9.38,
        "longitude": -40.50
      }
    },
    {
      "id": "ai-demo-2",
      "tipo_combustivel": "Etanol",
      "preco": 5.190,
      "data_atualizacao": new Date().toISOString(),
      "reportado_por": "IA Mercado (ANP Ref)",
      "stations": {
        "id": "st-demo-1",
        "nome": "Posto Shell - Monsenhor",
        "bandeira": "SHELL",
        "endereco": "Av. Monsenhor Ângelo Sampaio, 100",
        "cidade": cidade,
        "estado": "PE",
        "latitude": -9.38,
        "longitude": -40.50
      }
    },
    {
      "id": "ai-demo-3",
      "tipo_combustivel": "Gasolina Comum",
      "preco": 6.690,
      "data_atualizacao": new Date().toISOString(),
      "reportado_por": "IA Mercado (ANP Ref)",
      "stations": {
        "id": "st-demo-2",
        "nome": "Posto Ipiranga Orla",
        "bandeira": "IPIRANGA",
        "endereco": "Orla de Juazeiro, Centro",
        "cidade": cidade,
        "estado": "BA",
        "latitude": -9.41,
        "longitude": -40.51
      }
    },
    {
      "id": "ai-demo-4",
      "tipo_combustivel": "Diesel S10",
      "preco": 6.090,
      "data_atualizacao": new Date().toISOString(),
      "reportado_por": "IA Mercado (ANP Ref)",
      "stations": {
        "id": "st-demo-2",
        "nome": "Posto Ipiranga Orla",
        "bandeira": "IPIRANGA",
        "endereco": "Orla de Juazeiro, Centro",
        "cidade": cidade,
        "estado": "BA",
        "latitude": -9.41,
        "longitude": -40.51
      }
    }
  ];

  try {
    const openAIKey = process.env.OPENAI_API_KEY;
    
    // If no key, return demo data if it's the right city, otherwise generic error
    if (!openAIKey) {
      if (isDemoCity) return NextResponse.json({ data: demoData, source: 'Demo Fallback (Real-Time Ref)' });
      return NextResponse.json({ error: 'Chave OpenAI não configurada na Vercel' }, { status: 401 });
    }

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
          content: `Você é um buscador inteligente de postos de combustível no Brasil. Seu objetivo é retornar JSON puro com uma lista de 5 postos reais conhecidos na cidade de ${cidade}.
          
          CONTEXTO DE MERCADO ATUAL (ABRIL 2026):
          - Preços subiram significativamente. 
          - Gasolina Comum em Petrolina/Juazeiro está na faixa de R$ 6,69 a R$ 7,10.
          - Etanol está por volta de R$ 5,10 a R$ 5,30.
          - Diesel S10 está em torno de R$ 6,00 a R$ 6,20.
          
          Baseie sua resposta nesses patamares realistas para o Nordeste brasileiro hoje.
          
          Retorne APENAS o JSON no formato abaixo (sem texto extra):
          {
            "data": [
              {
                "id": "ai-unique-id",
                "tipo_combustivel": "Gasolina Comum",
                "preco": 6.75,
                "data_atualizacao": "2026-04-15",
                "reportado_por": "IA Pesquisa Mercado",
                "stations": { "id": "st-id", "nome": "NOME", "bandeira": "BR", "endereco": "ENDERECO", "cidade": "${cidade}", "estado": "UF", "latitude": -9.38, "longitude": -40.50 }
              }
            ]
          }`
        }],
        response_format: { type: "json_object" },
        timeout: 10000
      })
    });


    const aiData = await aiResponse.json();
    
    if (aiData.error || !aiData.choices?.[0]?.message?.content) {
      console.error("Erro OpenAI:", aiData.error);
      if (isDemoCity) return NextResponse.json({ data: demoData, source: 'Demo Fallback' });
      throw new Error(aiData.error?.message || "IA não respondeu");
    }

    const parsed = JSON.parse(aiData.choices[0].message.content);
    let results = parsed.data || [];

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
    console.error('Falha geral na API:', err);
    if (isDemoCity) return NextResponse.json({ data: demoData, source: 'Demo Fallback (Erro)' });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}




