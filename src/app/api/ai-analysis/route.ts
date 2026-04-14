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
      return station && (station.cidade as string || '').toLowerCase().includes(cidade.toLowerCase());
    });

    if (cityPrices.length === 0) {
      return NextResponse.json({
        analysis: `Ainda não temos dados suficientes para ${cidade}. Que tal ser o primeiro a reportar preços na sua região? 🚗`
      });
    }

    // Prepare clear text summary of the prices to send to OpenAI
    const fuelStats: Record<string, any[]> = {};
    for (const item of cityPrices) {
      const tipo = item.tipo_combustivel as string;
      const station = item.stations as any;
      if (!fuelStats[tipo]) fuelStats[tipo] = [];
      fuelStats[tipo].push({ preco: item.preco, posto: station.nome });
    }

    let summaryText = `Preços em ${cidade}:\n`;
    for (const [tipo, prices] of Object.entries(fuelStats)) {
      const sorted = prices.sort((a, b) => a.preco - b.preco);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      summaryText += `- ${tipo}: Varia de R$ ${min.preco} no '${min.posto}' até R$ ${max.preco} no '${max.posto}'.\n`;
    }

    const openAIKey = process.env.OPENAI_API_KEY;
    if (!openAIKey) {
       return NextResponse.json({ analysis: "Aviso: Chave OpenAI não configurada. A análise é manual." });
    }

    const aiPrompt = `Você é um assistente financeiro automotivo ajudando um usuário do aplicativo "Combustível Barato" a economizar combustível. Baseado nos dados de mercado da cidade de ${cidade} abaixo, gere um pequeno resumo informativo (máximo 4 parágrafos) formatado em Markdown, com dicas claras de que postos buscar, qual tipo de combustível pode ser melhor. Lembre da regra de 70% quando aplicável para Etanol e Gasolina. Evite rodeios, seja muito prestativo e simpático. Adicione emojis.
    
Dados:
${summaryText}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAIKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: aiPrompt }],
        temperature: 0.7
      })
    });

    const aiData = await response.json();
    
    if (aiData.error) {
      console.error(aiData.error);
      return NextResponse.json({ analysis: "Erro na IA: " + (aiData.error.message || 'Desconhecido') });
    }

    const iaResponse = aiData.choices?.[0]?.message?.content || "Análise indisponível";

    return NextResponse.json({ analysis: iaResponse });
  } catch (err) {
    console.error('AI Analysis error:', err);
    return NextResponse.json({ error: 'Erro ao gerar análise' }, { status: 500 });
  }
}
