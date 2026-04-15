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

  console.log(`Buscando postos via GEMINI para: ${cidade}`);

  if (!cidade) {
    return NextResponse.json({ error: 'Cidade é obrigatória' }, { status: 400 });
  }

  // FALLBACK STATIC DATA FOR DEMO PURPOSES
  const isDemoCity = cidade.toLowerCase().includes('petrolina') || cidade.toLowerCase().includes('juazeiro');
  const demoData = [
    {
      "id": "ai-demo-1", "tipo_combustivel": "Gasolina Comum", "preco": 6.899, "data_atualizacao": new Date().toISOString(), "reportado_por": "IA Mercado (Ref)",
      "stations": { "id": "st-demo-1", "nome": "Posto Shell - Monsenhor", "bandeira": "SHELL", "endereco": "Av. Monsenhor Ângelo Sampaio, 100", "cidade": cidade, "estado": "PE", "latitude": -9.38, "longitude": -40.50 }
    },
    {
      "id": "ai-demo-2", "tipo_combustivel": "Etanol", "preco": 5.190, "data_atualizacao": new Date().toISOString(), "reportado_por": "IA Mercado (Ref)",
      "stations": { "id": "st-demo-1", "nome": "Posto Shell - Monsenhor", "bandeira": "SHELL", "endereco": "Av. Monsenhor Ângelo Sampaio, 100", "cidade": cidade, "estado": "PE", "latitude": -9.38, "longitude": -40.50 }
    }
  ];

  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiKey) {
      console.warn("GEMINI_API_KEY não configurada. Usando fallback...");
      if (isDemoCity) return NextResponse.json({ data: demoData, source: 'Demo Fallback' });
      return NextResponse.json({ error: 'Chave Gemini não configurada' }, { status: 401 });
    }

    const prompt = `Aja como um buscador de postos de combustível no Brasil. Seu objetivo é retornar JSON puro com uma lista de 5 postos reais conhecidos na cidade de ${cidade}.
          
    CONTEXTO DE MERCADO ATUAL (ABRIL 2026):
    - Preços subiram. Gasolina em Petrolina/Juazeiro está em R$ 6,80 a 7,10. Etanol R$ 5,20.
    - Baseie sua resposta nesses patamares realistas para essa região hoje.
    
    Retorne APENAS um JSON no formato EXATO abaixo:
    {
      "data": [
        {
          "id": "gemini-1",
          "tipo_combustivel": "Gasolina Comum",
          "preco": 6.75,
          "data_atualizacao": "2026-04-15",
          "reportado_por": "Gemini AI",
          "stations": { "id": "st-g-1", "nome": "NOME", "bandeira": "SHELL", "endereco": "LUGAR", "cidade": "${cidade}", "estado": "UF", "latitude": -9.1, "longitude": -40.2 }
        }
      ]
    }`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      if (isDemoCity) return NextResponse.json({ data: demoData, source: 'Demo Fallback (Gemini Fail)' });
      throw new Error("Resposta do Gemini vazia");
    }

    const parsed = JSON.parse(text);
    let results = parsed.data || [];

    if (tipo && tipo !== 'Todos') {
      results = results.filter((item: any) => item.tipo_combustivel === tipo);
    }
    results.sort((a: any, b: any) => a.preco - b.preco);

    return NextResponse.json({ 
      data: results, 
      total: results.length,
      source: 'Gemini 1.5 Real-time'
    });

  } catch (err: any) {
    console.error('Falha no Gemini:', err);
    if (isDemoCity) return NextResponse.json({ data: demoData, source: 'Demo Fallback (Erro)' });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}




