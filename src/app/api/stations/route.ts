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
    let filtered = (data || []).filter((item: Record<string, unknown>) => {
      const station = item.stations as Record<string, unknown> | null;
      if (!station) return false;
      const stationCidade = (station.cidade as string || '').toLowerCase();
      return stationCidade.includes(cidade.toLowerCase());
    });

    // Filter by fuel type if specified
    if (tipo && tipo !== 'Todos') {
      filtered = filtered.filter((item: Record<string, unknown>) => item.tipo_combustivel === tipo);
    }

    // Get latest price per station per fuel type
    const latestPrices = new Map<string, Record<string, unknown>>();
    for (const item of filtered) {
      const station = item.stations as Record<string, unknown>;
      const key = `${(station as Record<string, unknown>).id}-${item.tipo_combustivel}`;
      if (!latestPrices.has(key)) {
        latestPrices.set(key, item);
      }
    }

    const result = Array.from(latestPrices.values());

    // Sort by price (cheapest first)
    result.sort((a: Record<string, unknown>, b: Record<string, unknown>) => 
      (a.preco as number) - (b.preco as number)
    );

    return NextResponse.json({ data: result, total: result.length });
  } catch (err) {
    console.error('API error:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
