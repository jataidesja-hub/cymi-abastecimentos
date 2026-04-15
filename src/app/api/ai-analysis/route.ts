import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { cidade } = await request.json();

    if (!cidade) {
      return NextResponse.json({ error: 'Cidade é obrigatória' }, { status: 400 });
    }

    // Fetch all prices for the city
    const { data: allPrices, error } = await supabase
      .from('fuel_prices')
      .select(`
        tipo_combustivel,
        preco,
        data_atualizacao,
        stations (
          nome,
          bandeira,
          cidade
        )
      `)
      .order('data_atualizacao', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter by city
    const cityPrices = (allPrices || []).filter((item: Record<string, unknown>) => {
      const station = item.stations as Record<string, unknown> | null;
      const st = Array.isArray(station) ? station[0] : station;
      return st && (st.cidade as string || '').toLowerCase().includes(cidade.toLowerCase());
    });

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
       console.error("ERRO: GEMINI_API_KEY ausente na análise");
       return NextResponse.json({ analysis: "Aviso: Configuração de IA pendente (Chave ausente)." });
    }

    let aiPrompt = "";
    if (cityPrices.length === 0) {
      aiPrompt = `Aja como um Expert em Combustíveis. O usuário quer saber sobre preços em ${cidade}. 
      Como não temos dados históricos hoje, faça uma análise de mercado para essa região baseada em 2026. 
      Cite valores médios aproximados: Gasolina ~R$ 6.90, Etanol ~R$ 5.20, Diesel ~R$ 6.10. 
      Dê 3 dicas de economia e cite 2 postos famosos da cidade. Use Markdown e emojis.`;
    } else {
      aiPrompt = `Analise os preços de combustíveis em ${cidade} e dê dicas de economia focada em frotas e regra dos 70%. Use Markdown.`;
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    
    console.log(`Solicitando análise Gemini para ${cidade}...`);

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: aiPrompt }] }]
      })
    });

    const aiData = await response.json();
    
    if (aiData.error) {
      console.error("Erro Gemini API:", aiData.error);
      return NextResponse.json({ analysis: "Ocorreu um erro na IA ao gerar a análise." });
    }

    const analysis = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "A análise está temporariamente indisponível.";

    return NextResponse.json({ analysis });
  } catch (err: any) {
    console.error('AI Analysis error crítico:', err);
    return NextResponse.json({ analysis: 'Ops! Tivemos um problema técnico na análise.' }, { status: 500 });
  }
}


