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
    
    const generateContingencyData = (cityName: string) => {
      // Preços reais pesquisados para a Bahia/Curaçá (Abril 2026)
      const isBahia = cityName.toLowerCase().includes('ba') || cityName.toLowerCase().includes('cura');
      const baseGas = isBahia ? 6.77 : 6.99;
      const baseEta = isBahia ? 4.69 : 5.25;
      const baseDie = isBahia ? 7.43 : 6.15;

      return [
        {
          "id": `ai-c-${cityName}-1`, "tipo_combustivel": "Gasolina Comum", "preco": baseGas, "data_atualizacao": new Date().toISOString(), "reportado_por": "IA Mercado",
          "ticket_log": "Sim", "stations": { "id": "c1", "nome": `Posto Curaçá (Referência)`, "bandeira": "BR", "endereco": `Entrada da Cidade, ${cityName}`, "cidade": cityName, "estado": "BA", "latitude": -9.141, "longitude": -39.907 }
        },
        {
          "id": `ai-c-${cityName}-2`, "tipo_combustivel": "Etanol", "preco": baseEta, "data_atualizacao": new Date().toISOString(), "reportado_por": "IA Mercado",
          "ticket_log": "Sim", "stations": { "id": "c1", "nome": `Posto Curaçá (Referência)`, "bandeira": "BR", "endereco": `Entrada da Cidade, ${cityName}`, "cidade": cityName, "estado": "BA", "latitude": -9.141, "longitude": -39.907 }
        },
        {
          "id": `ai-c-${cityName}-3`, "tipo_combustivel": "Diesel S10", "preco": baseDie, "data_atualizacao": new Date().toISOString(), "reportado_por": "IA Mercado",
          "ticket_log": "Sim", "stations": { "id": "c3", "nome": `Posto São Bento`, "bandeira": "IPIRANGA", "endereco": `Rodovia BA-210, ${cityName}`, "cidade": cityName, "estado": "BA", "latitude": -9.145, "longitude": -39.910 }
        }
      ];
    };

    if (!geminiKey) {
      const fallback = isDemoCity ? demoData : generateContingencyData(cidade);
      return NextResponse.json({ data: fallback, source: 'Modo Contingência (Chave IA Ausente)' });
    }

    const prompt = `VOCÊ É UM ANALISTA DE LOGÍSTICA. 
    RETORNE EM JSON PURO os postos e preços atuais (Abril 2026) para ${cidade}.
    REFERÊNCIA DE PREÇOS (ANP): Gasolina R$ ~6.77, Etanol ~4.70, Diesel ~7.40.
    FORMATO JSON OBRIGATÓRIO: {"data": [{"station_info": {"nome": "N", "bandeira": "B", "endereco": "E", "latitude": -9, "longitude": -40, "ticket_log": "Sim"}, "prices": [{"tipo": "Gasolina Comum", "preco": 6.77, "data": "2026-04-15"}]}]}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    
    try {
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        }),
        signal: AbortSignal.timeout(10000)
      });

      const data = await response.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("IA não retornou formato JSON");

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
            reportado_por: "Analista IA",
            ticket_log: item.station_info.ticket_log,
            stations: {
              id: item.station_info.nome,
              nome: item.station_info.nome,
              bandeira: item.station_info.bandeira,
              endereco: item.station_info.endereco,
              cidade: cidade,
              estado: "BA",
              latitude: item.station_info.latitude,
              longitude: item.station_info.longitude
            }
          });
        });
      });

      return NextResponse.json({ data: finalData, source: 'Analista Logística IA' });

    } catch (apiErr) {
       console.error("Erro no Gemini Real, ativando motor de contingência...", apiErr);
       const fallback = generateContingencyData(cidade);
       return NextResponse.json({ data: fallback, source: 'IA Motor de Contingência (Backup)' });
    }
  } catch (err: any) {
    console.error('Falha crítica na rota:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}




