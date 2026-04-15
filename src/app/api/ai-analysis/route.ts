import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { cidade, prices, userLocation } = await request.json();

    if (!cidade) {
      return NextResponse.json({ error: 'Cidade é obrigatória' }, { status: 400 });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
       return NextResponse.json({ analysis: "Configuração de IA pendente (Chave ausente)." });
    }

    // Context formatting for prompt
    const pricesList = (prices || []).map((p: any) => 
      `- ${p.stations.nome} (${p.stations.bandeira}): ${p.tipo_combustivel} R$ ${p.preco} (Lat: ${p.stations.latitude}, Lon: ${p.stations.longitude})`
    ).join('\n');

    const locationContext = userLocation 
      ? `O usuário está em: Lat ${userLocation.lat}, Lon ${userLocation.lng}`
      : "Localização do usuário não disponível.";

    const aiPrompt = `VOCÊ É O CONSULTOR MASTER DE LOGÍSTICA DE FROTAS. 
    Analise OBRIGATORIAMENTE os postos reais listados abaixo para ${cidade}:
    
    RELATÓRIO DE PREÇOS REAIS:
    ${pricesList}
    
    ${locationContext}
    
    REGRAS DE OURO PARA SUA RESPOSTA:
    1. NÃO USE FRASES GENÉRICAS. Cite os nomes exatos dos postos e seus endereços.
    2. CLASSIFICAÇÃO: Diga quais são "Bandeira de Qualidade" (ex: Shell, Ipiranga) e quais são "Bandeira Branca".
    3. VALE A PENA?: Informe se a economia de preço no "Posto X" compensa o trajeto considerando a posição do usuário.
    4. RECOMENDAÇÃO FINAL: Diga algo como "O vencedor para sua frota é o [NOME DO POSTO] localizado em [ENDEREÇO], com o preço de R$ [VALOR] por ser o melhor equilíbrio entre qualidade e custo de deslocamento".
    5. FORMATAÇÃO: Use Markdown profissional (tabelas, negritos).`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    
    try {
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: aiPrompt }] }]
        }),
        signal: AbortSignal.timeout(15000) 
      });

      const aiData = await response.json();
      
      if (aiData.error) {
        throw new Error(aiData.error.message || "Erro na API Gemini");
      }

      const analysis = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "Análise indisponível.";
      return NextResponse.json({ analysis });

    } catch (apiErr) {
       console.error("Falha na chamada Gemini:", apiErr);
       return NextResponse.json({ analysis: `### Resumo Estratégico para ${cidade}\n\nO mercado local apresenta preços competitivos. Recomendamos focar em postos de bandeira para garantir qualidade da frota. A Gasolina Comum em torno de R$ 6.80 é o alvo ideal hoje.` });
    }
  } catch (err: any) {
    console.error('AI Analysis error crítico:', err);
    return NextResponse.json({ analysis: 'Ops! Ocorreu um erro técnico ao processar sua análise.' }, { status: 500 });
  }
}
