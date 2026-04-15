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
       return NextResponse.json({ analysis: "Aviso: Chave Gemini não configurada." });
    }

    let aiPrompt = "";
    
    if (cityPrices.length === 0) {
      aiPrompt = `O usuário busca preços de combustível em ${cidade}. Estime os preços médios atuais de Gasolina, Etanol e Diesel lá (Nordeste 2026: Gasolina ~R$ 6.90). Cite 3 postos reais famosos. Seja simpático. Use Markdown e emojis.`;
    } else {
      const fuelStats: Record<string, any[]> = {};
      for (const item of cityPrices) {
        const tipo = item.tipo_combustivel as string;
        const station = item.stations as any;
        const st = Array.isArray(station) ? station[0] : station;
        if (!fuelStats[tipo]) fuelStats[tipo] = [];
        fuelStats[tipo].push({ preco: item.preco, posto: st?.nome });
      }

      let summaryText = `Preços em ${cidade}:\n`;
      for (const [tipo, prices] of Object.entries(fuelStats)) {
        const sorted = prices.sort((a, b) => a.preco - b.preco);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        summaryText += `- ${tipo}: Varia de R$ ${min.preco} no '${min.posto}' até R$ ${max.preco} no '${max.posto}'.\n`;
      }

      aiPrompt = `Analise os preços de ${cidade} e dê dicas de economia e regra dos 70%. Markdown.\n\nDados:\n${summaryText}`;
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: aiPrompt }] }]
      })
    });

    const aiData = await response.json();
    const analysis = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "Análise indisponível no momento.";

    return NextResponse.json({ analysis });
  } catch (err: any) {
    console.error('AI Analysis error:', err);
    return NextResponse.json({ error: 'Erro ao gerar análise' }, { status: 500 });
  }
}

