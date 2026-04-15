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

    const openAIKey = process.env.OPENAI_API_KEY;
    if (!openAIKey) {
       return NextResponse.json({ analysis: "Aviso: Chave OpenAI não configurada." });
    }

    let aiPrompt = "";
    
    if (cityPrices.length === 0) {
      // Logic for NO DATA - Search simulation
      aiPrompt = `O usuário está buscando preços de combustível na cidade de ${cidade}, mas nosso banco de dados local está vazio para esta região.
      
      Sua tarefa:
      1. Use seu conhecimento de mercado (até sua data de corte) para estimar os preços médios de Gasolina, Etanol e Diesel em ${cidade}.
      2. Cite pelo menos 3 postos reais/famosos que você sabe que existem em ${cidade}.
      3. Seja muito simpático e explique que você está realizando uma "Busca em Tempo Real via IA" para ajudá-lo.
      4. Formate em Markdown com emojis. Dê dicas de economia.
      
      IMPORTANTE: Diga explicitamente que os dados são estimativas baseadas em análise de inteligência de mercado por ser uma região nova no app.`;
    } else {
      // Prepare clear text summary for existing data
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

      aiPrompt = `Você é um assistente financeiro automotivo no app "Combustível Barato". Baseado nos dados de mercado da cidade de ${cidade} abaixo, gere um pequeno resumo informativo (máximo 4 parágrafos) formatado em Markdown, com dicas claras de que postos buscar, qual tipo de combustível pode ser melhor. Lembre da regra de 70% para Etanol/Gasolina.
      
Dados Reais do App:
${summaryText}`;
    }

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
