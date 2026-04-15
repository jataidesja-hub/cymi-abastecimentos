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

  if (!cidade) return NextResponse.json({ error: 'Cidade é obrigatória' }, { status: 400 });

  console.log(`[LOG] PESQUISA REAL IA SOLICITADA PARA: ${cidade}`);

  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    
    // Se não tiver chave, o app não consegue pesquisar na internet real
    if (!geminiKey) {
      return NextResponse.json({ 
        error: 'IA DESCONECTADA: Você precisa configurar a GEMINI_API_KEY nas variáveis de ambiente da Vercel para realizar buscas em tempo real.',
        source: 'Erro de Configuração'
      }, { status: 401 });
    }

    const prompt = `VOCÊ É UM AGENTE DE BUSCA EM TEMPO REAL.
    PESQUISE AGORA os postos de combustível mais conhecidos em ${cidade} e seus preços atuais (Abril 2026).
    Foque em postos que aceitam TICKET LOG.
    
    RETORNE ESTRITAMENTE UM JSON (SEM TEXTO EXTRA):
    {
      "data": [
        {
          "station_info": {
            "nome": "NOME DO POSTO REAL",
            "bandeira": "BANDEIRA REAL",
            "endereco": "ENDEREÇO REAL",
            "latitude": -9.0,
            "longitude": -40.0,
            "ticket_log": "Sim"
          },
          "prices": [
            { "tipo": "Gasolina Comum", "preco": 6.80, "data": "2026-04-15" }
          ]
        }
      ]
    }`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      }),
      signal: AbortSignal.timeout(15000) // 15 segundos de timeout
    });

    if (!response.ok) throw new Error(`Gemini API retornou erro ${response.status}`);

    const data = await response.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("A IA não conseguiu encontrar dados em tempo real para esta cidade agora.");

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

    return NextResponse.json({ data: finalData, source: 'Analista de Logística IA (Tempo Real)' });

  } catch (err: any) {
    console.error('[ERRO IA]:', err.message);
    return NextResponse.json({ 
      error: `Erro na Busca: ${err.message}. Certifique-se de que a IA está configurada corretamente.`,
      source: 'Falha na IA'
    }, { status: 500 });
  }
}
  } catch (err: any) {
    console.error('Falha crítica na rota:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}




