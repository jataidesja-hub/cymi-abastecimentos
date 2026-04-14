import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { station_id, tipo_combustivel, preco, reportado_por } = body;

    if (!station_id || !tipo_combustivel || !preco) {
      return NextResponse.json(
        { error: 'Campos obrigatórios: station_id, tipo_combustivel, preco' },
        { status: 400 }
      );
    }

    if (preco <= 0 || preco > 20) {
      return NextResponse.json(
        { error: 'Preço deve ser entre R$ 0,01 e R$ 20,00' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('fuel_prices')
      .insert({
        station_id,
        tipo_combustivel,
        preco: parseFloat(preco),
        reportado_por: reportado_por || 'usuário',
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, message: 'Preço reportado com sucesso!' });
  } catch (err) {
    console.error('API error:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
