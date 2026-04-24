import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      station_id,   // UUID do Supabase (se já existir)
      osm_id,       // ID do OpenStreetMap (para criar o posto se não existir)
      station_info, // Dados do posto (necessário se osm_id for novo)
      tipo_combustivel,
      preco,
      ticket_log,
      reportado_por,
    } = body;

    // Validações básicas
    if (!tipo_combustivel || preco == null) {
      return NextResponse.json(
        { error: 'Campos obrigatórios: tipo_combustivel, preco' },
        { status: 400 }
      );
    }
    const precoNum = parseFloat(preco);
    if (isNaN(precoNum) || precoNum <= 0 || precoNum > 20) {
      return NextResponse.json(
        { error: 'Preço inválido. Deve ser entre R$ 0,01 e R$ 20,00' },
        { status: 400 }
      );
    }

    let finalStationId: string | null = station_id || null;

    // Se não temos UUID do Supabase mas temos osm_id, resolve o posto
    if (!finalStationId && osm_id) {
      const { data: existing } = await supabase
        .from('stations')
        .select('id, ticket_log')
        .eq('osm_id', osm_id)
        .maybeSingle();

      if (existing) {
        finalStationId = existing.id;
      } else if (station_info) {
        // Cria o posto no Supabase na primeira vez que alguém reporta um preço
        const { data: newStation, error: createErr } = await supabase
          .from('stations')
          .insert({
            nome: station_info.nome,
            bandeira: station_info.bandeira || 'Branco',
            endereco: station_info.endereco,
            cidade: station_info.cidade,
            estado: station_info.estado || '',
            latitude: station_info.latitude,
            longitude: station_info.longitude,
            osm_id: Number(osm_id),
            ticket_log: ticket_log ?? false,
          })
          .select('id')
          .single();

        if (createErr) {
          console.error('Erro ao criar posto:', createErr);
          return NextResponse.json({ error: createErr.message }, { status: 500 });
        }
        finalStationId = newStation.id;
      }
    }

    if (!finalStationId) {
      return NextResponse.json(
        { error: 'Posto não identificado. Informe station_id ou osm_id + station_info.' },
        { status: 400 }
      );
    }

    // Atualiza ticket_log no posto se foi informado
    if (ticket_log !== undefined) {
      await supabase
        .from('stations')
        .update({ ticket_log: Boolean(ticket_log) })
        .eq('id', finalStationId);
    }

    // Insere o preço
    const { data, error } = await supabase
      .from('fuel_prices')
      .insert({
        station_id: finalStationId,
        tipo_combustivel,
        preco: precoNum,
        reportado_por: reportado_por || 'usuário',
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao inserir preço:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, message: 'Preço reportado com sucesso!' });
  } catch (err: any) {
    console.error('Erro interno report-price:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
