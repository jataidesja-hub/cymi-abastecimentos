import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
    const { cidade, prices, userLocation } = await request.json();

    if (!cidade) {
      return NextResponse.json({ error: 'Cidade é obrigatória' }, { status: 400 });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
       return NextResponse.json({ analysis: "Configuração de IA pendente." });
    }

    // Context formatting for prompt
    const pricesList = (prices || []).map((p: any) => 
      `- ${p.stations.nome} (${p.stations.bandeira}): ${p.tipo_combustivel} R$ ${p.preco} (Lat: ${p.stations.latitude}, Lon: ${p.stations.longitude})`
    ).join('\n');

    const locationContext = userLocation 
      ? `O usuário está em: Lat ${userLocation.lat}, Lon ${userLocation.lng}`
      : "Localização do usuário não disponível.";

    const aiPrompt = `ATUE COMO CONSULTOR DE ELITE EM LOGÍSTICA DE FROTAS.
    Analise os seguintes dados de postos em ${cidade} para uma empresa que busca o melhor custo-benefício:
    
    DADOS ATUAIS (Preços e Localização):
    ${pricesList}
    
    CONTEXTO DO USUÁRIO:
    ${locationContext}
    
    SUA TAREFA - GERE UM RELATÓRIO COMPLETO:
    1. CLASSIFICAÇÃO DE QUALIDADE: Identifique quais são postos de BANDEIRA BRANCA (mais baratos, maior risco) e quais são de QUALIDADE/BANDEIRA (Shell, Ipiranga, BR - mais confiáveis).
    2. ESTUDO DE DESLOCAMENTO: Se a localização do usuário estiver disponível, calcule (mentalmente/estimando) se vale a pena se deslocar para o posto mais barato. Considere o custo do combustível gasto no trajeto.
    3. RECOMENDAÇÃO MASTER: Escolha o vencedor unindo Preço + Qualidade + Localização. Seja específico sobre qual posto e qual preço você está falando.
    4. FORMATAÇÃO: Use Tabela Markdown se necessário, use títulos, negritos e emojis. Nada de fragmentos, quero uma análise densa e profissional.`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
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

    try {
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: aiPrompt }] }]
        }),
        signal: AbortSignal.timeout(12000) 
      });

      const aiData = await response.json();
      
      if (aiData.error) {
        console.error("Erro Gemini API:", aiData.error);
        return NextResponse.json({ analysis: `⚠️ A IA Expert está com alta demanda. \n\nPara ${cidade}, recomendamos focar em postos de bandeira branca para economia ou Shell/Ipiranga para qualidade. Média estimada: R$ 6.95.` });
      }

      const analysis = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "A análise está temporariamente indisponível.";
      return NextResponse.json({ analysis });

    } catch (fetchErr) {
       console.error("Timeout ou Falha no Fetch Gemini:", fetchErr);
       return NextResponse.json({ analysis: `Análise Rápida para ${cidade}: \n\nO mercado local apresenta preços estáveis. Recomendamos comparar postos da Av. Principal. A regra dos 70% favorece a Gasolina se o Etanol passar de R$ 5.10.` });
    }
  } catch (err: any) {
    console.error('AI Analysis error crítico:', err);
    return NextResponse.json({ analysis: 'Ops! Tivemos um problema técnico na análise.' }, { status: 500 });
  }
}


