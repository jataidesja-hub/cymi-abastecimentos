import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const input = (new URL(request.url).searchParams.get('q') || '').trim();
  if (input.length < 2) return NextResponse.json({ suggestions: [] });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return NextResponse.json({ suggestions: [] });

  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=locality&components=country:br&language=pt-BR&key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const data = await res.json();

    const suggestions: string[] = (data.predictions || [])
      .map((p: any) => {
        // Remove ", Brasil" e estado do fim — só retorna o nome da cidade
        const parts = p.description.split(',');
        return parts[0].trim();
      })
      .filter(Boolean)
      .slice(0, 6);

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
