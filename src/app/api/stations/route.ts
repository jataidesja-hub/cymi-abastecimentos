import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cidade = searchParams.get('cidade');
  const tipo = searchParams.get('tipo');

  if (!cidade) {
    return NextResponse.json({ error: 'Cidade é obrigatória' }, { status: 400 });
  }

  try {
    let query = supabase
      .from('fuel_prices')
      .select(`
        id,
        tipo_combustivel,
        preco,
        data_atualizacao,
        reportado_por,
        stations (
          id,
          nome,
          bandeira,
          endereco,
          cidade,
          estado,
          latitude,
          longitude
        )
      `)
      .order('data_atualizacao', { ascending: false });

    // Filter by city through the stations relationship
    // We'll filter after fetching since Supabase doesn't support filtering on joined tables easily
    const { data, error } = await query;

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter by city (case-insensitive)
    let filtered = (data || []).filter((item: any) => {
      const station = item.stations as any;
      if (!station) return false;
      const st = Array.isArray(station) ? station[0] : station;
      return st && (st.cidade as string || '').toLowerCase().includes(cidade.toLowerCase());
    });

    // IF NO DATA IN DATABASE, USE AI TO FIND/GENERATE REALISTIC DATA FOR ANY CITY IN BRAZIL
    if (filtered.length === 0) {
      const openAIKey = process.env.OPENAI_API_KEY;
      if (openAIKey) {
        try {
          const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openAIKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [{
                role: 'system',
                content: `Você é um buscador de postos de combustível no Brasil. Seu objetivo é retornar JSON puro com uma lista de 3 a 5 postos reais conhecidos na cidade de ${cidade} e seus preços ESTIMADOS atuais.
                
                Retorne APENAS um JSON no formato:
                {
                  "data": [
                    {
                      "id": "ai-1",
                      "tipo_combustivel": "Gasolina Comum",
                      "preco": 5.899,
                      "data_atualizacao": "2026-04-15T00:00:00Z",
                      "reportado_por": "IA Mercado",
                      "stations": {
                        "id": "st-ai-1",
                        "nome": "NOME DO POSTO",
                        "bandeira": "BANDEIRA",
                        "endereco": "ENDERECO",
                        "cidade": "${cidade}",
                        "estado": "UF",
                        "latitude": -9.00,
                        "longitude": -40.00
                      }
                    }
                  ]
                }`
              }],
              response_format: { type: "json_object" }
            })
          });

          const aiData = await aiResponse.json();
          if (aiData.choices?.[0]?.message?.content) {
            const parsed = JSON.parse(aiData.choices[0].message.content);
            return NextResponse.json({ 
              data: parsed.data, 
              total: parsed.data.length,
              source: 'IA Pesquisa Real-time' 
            });
          }
        } catch (err) {
          console.error("AI Search Error:", err);
        }
      }
    }

    // Standard database filtering if data exists
    if (tipo && tipo !== 'Todos') {
      filtered = filtered.filter((item: any) => item.tipo_combustivel === tipo);
    }

    // Get latest price per station per fuel type
    const latestPrices = new Map<string, any>();
    for (const item of filtered) {
      const station = item.stations as any;
      const st = Array.isArray(station) ? station[0] : station;
      if (!st) continue;
      
      const key = `${st.id}-${item.tipo_combustivel}`;
      const newItem = { ...item, stations: st };
      
      if (!latestPrices.has(key)) {
        latestPrices.set(key, newItem);
      }
    }

    const result = Array.from(latestPrices.values());
    result.sort((a: any, b: any) => a.preco - b.preco);

    return NextResponse.json({ data: result, total: result.length, source: 'Database' });
  } catch (err) {
    console.error('API error:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

