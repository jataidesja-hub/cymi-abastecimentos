import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cidade = (searchParams.get('cidade') || '').trim();
    const tipo = searchParams.get('tipo');

    if (!cidade) return NextResponse.json({ error: 'Cidade é obrigatória' }, { status: 400 });

    console.log(`[LOG] PESQUISA REAL IA SOLICITADA PARA: ${cidade}`);

    const geminiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiKey) {
      return NextResponse.json({ 
        error: 'IA DESCONECTADA: Você precisa configurar a GEMINI_API_KEY na Vercel.',
        source: 'Erro de Configuração'
      }, { status: 401 });
    }

    const prompt = `Liste postos e preços de combustíveis (Gasolina/Etanol) para ${cidade}. Retorne somente JSON: {"data": [{"station_info": {"nome": "N", "bandeira": "B", "endereco": "E", "latitude": -9, "longitude": -40, "ticket_log": "Sim"}, "prices": [{"tipo": "Gasolina Comum", "preco": 6.80, "data": "2026-04-15"}]}]}`;

    // LISTA DE ENDPOINTS PARA TENTATIVA AUTOMÁTICA (Resiliência total contra 404)
    const endpoints = [
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiKey}`,
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${geminiKey}`
    ];

    let response: Response | null = null;
    let lastError = "";

    for (const url of endpoints) {
      try {
        console.log(`Tentando IA via: ${url.split('models/')[1].split(':')[0]}`);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
          }),
          signal: AbortSignal.timeout(10000)
        });

        if (res.ok) {
          response = res;
          break;
        } else {
          const errText = await res.text();
          lastError = `URL ${url} falhou: ${errText}`;
        }
      } catch (e: any) {
        lastError = e.message;
      }
    }

    if (!response) {
      throw new Error(`A IA não pôde ser ativada com sua chave. Erro final: ${lastError.slice(0, 150)}`);
    }

    const data = await response.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("A IA não conseguiu encontrar dados para esta cidade.");

    const parsed = JSON.parse(jsonMatch[0]);
    const rawResults = parsed.data || [];

    let finalData: any[] = [];
    rawResults.forEach((item: any) => {
      item.prices.forEach((p: any) => {
        finalData.push({
          id: `${item.station_info.nome}-${p.tipo}`,
          tipo_combustivel: p.tipo,
          preco: p.preco,
          data_atualizacao: p.data,
          reportado_por: "Busca IA em Tempo Real",
          ticket_log: item.station_info.ticket_log,
          stations: {
            id: item.station_info.nome,
            nome: item.station_info.nome,
            bandeira: item.station_info.bandeira,
            endereco: item.station_info.endereco,
            cidade: cidade,
            estado: "",
            latitude: item.station_info.latitude,
            longitude: item.station_info.longitude
          }
        });
      });
    });

    if (tipo && tipo !== 'Todos') {
      finalData = finalData.filter((f: any) => f.tipo_combustivel.toLowerCase().includes(tipo.toLowerCase()));
    }

    return NextResponse.json({ data: finalData, source: 'Analista de Logística IA' });

  } catch (err: any) {
    console.error('[ERRO IA]:', err.message);
    return NextResponse.json({ 
      error: `Erro na Busca: ${err.message}`,
      source: 'Falha na IA'
    }, { status: 500 });
  }
}
