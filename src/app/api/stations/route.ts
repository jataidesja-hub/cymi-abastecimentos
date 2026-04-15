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
      "id": "demo-1", "tipo_combustivel": "Gasolina Comum", "preco": 6.899, "data_atualizacao": new Date().toISOString(), "reportado_por": "IA Mercado",
      "ticket_log": "Sim", "stations": { "id": "st1", "nome": "Posto Shell - Monsenhor", "bandeira": "SHELL", "endereco": "Av. Monsenhor Ângelo Sampaio, 100", "cidade": cidade, "estado": "PE", "latitude": -9.38, "longitude": -40.50 }
    },
    {
      "id": "demo-2", "tipo_combustivel": "Etanol", "preco": 5.190, "data_atualizacao": new Date().toISOString(), "reportado_por": "IA Mercado",
      "ticket_log": "Sim", "stations": { "id": "st1", "nome": "Posto Shell - Monsenhor", "bandeira": "SHELL", "endereco": "Av. Monsenhor Ângelo Sampaio, 100", "cidade": cidade, "estado": "PE", "latitude": -9.38, "longitude": -40.50 }
    },
    {
      "id": "demo-3", "tipo_combustivel": "Diesel S10", "preco": 6.090, "data_atualizacao": new Date().toISOString(), "reportado_por": "IA Mercado",
      "ticket_log": "Sim", "stations": { "id": "st1", "nome": "Posto Shell - Monsenhor", "bandeira": "SHELL", "endereco": "Av. Monsenhor Ângelo Sampaio, 100", "cidade": cidade, "estado": "PE", "latitude": -9.38, "longitude": -40.50 }
    },
    {
      "id": "demo-4", "tipo_combustivel": "Gasolina Comum", "preco": 6.690, "data_atualizacao": new Date().toISOString(), "reportado_por": "IA Mercado",
      "ticket_log": "Não", "stations": { "id": "st2", "nome": "Posto Ipiranga Orla", "bandeira": "IPIRANGA", "endereco": "Orla de Juazeiro", "cidade": cidade, "estado": "BA", "latitude": -9.41, "longitude": -40.51 }
    }
  ];

  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    
    if (!geminiKey) {
      console.warn("GEMINI_API_KEY não configurada. Usando fallback...");
      if (isDemoCity) return NextResponse.json({ data: demoData, source: 'Demo Fallback' });
      return NextResponse.json({ error: 'Chave Gemini não configurada' }, { status: 401 });
    }

    const prompt = `ATUE COMO ANALISTA DE LOGÍSTICA DE FROTAS (TICKET LOG).
    Pesquise preços atuais de combustíveis (Gasolina, Etanol e Diesel S10) em ${cidade}.
    
    DIRETRIZES:
    1. Baseie-se em preços reais (ANP 2026): Gasolina ~R$ 6.80-7.30, Etanol ~R$ 5.20.
    2. Liste 5 postos REAIS conhecidos em ${cidade}.
    3. Informe se aceitam Ticket Log (Edenred) - Seja realista.
    
    RESPOSTA OBRIGATÓRIA EM JSON PURO:
    {
      "data": [
        {
          "station_info": {
            "nome": "Posto X",
            "bandeira": "BR",
            "endereco": "Av. Brasil, 100",
            "latitude": -12.97,
            "longitude": -38.50,
            "ticket_log": "Sim"
          },
          "prices": [
            { "tipo": "Gasolina Comum", "preco": 6.99, "data": "2026-04-15" },
            { "tipo": "Etanol", "preco": 5.25, "data": "2026-04-15" }
          ]
        }
      ]
    }`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    
    console.log(`Buscando postos para: ${cidade}`);

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // EXTRATOR ROBUSTO DE JSON: Localiza o primeiro { e o último }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Gemini não retornou JSON válido:", text);
      if (isDemoCity) return NextResponse.json({ data: demoData, source: 'Demo Fallback' });
      throw new Error(`Não encontramos postos em ${cidade} no momento.`);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const rawResults = parsed.data || [];

    // Flatten results into the format expected by the frontend
    let finalData: any[] = [];
    rawResults.forEach((item: any) => {
      item.prices.forEach((p: any) => {
        finalData.push({
          id: `${item.station_info.nome}-${p.tipo}`,
          tipo_combustivel: p.tipo,
          preco: p.preco,
          data_atualizacao: p.data,
          reportado_por: "Analista IA",
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
      finalData = finalData.filter((item: any) => item.tipo_combustivel.toLowerCase().includes(tipo.toLowerCase()));
    }
    
    return NextResponse.json({ 
      data: finalData, 
      total: finalData.length,
      source: 'Analista Logística IA'
    });

  } catch (err: any) {
    console.error('Falha no Gemini:', err);
    if (isDemoCity) return NextResponse.json({ data: demoData, source: 'Demo Fallback (Erro)' });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}




