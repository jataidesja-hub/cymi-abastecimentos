import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const size = Math.min(parseInt(searchParams.get('size') || '192'), 512);

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          background: '#1a5f37',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: size * 0.18,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Stripes CYMI */}
        {[0.18, 0.28, 0.38, 0.48].map((t, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: size * 0.06,
              top: size * t,
              width: size * 0.28,
              height: size * 0.045,
              background: 'rgba(255,255,255,0.22)',
              borderRadius: size * 0.01,
            }}
          />
        ))}

        {/* MAPM */}
        <div
          style={{
            color: 'white',
            fontSize: size * 0.28,
            fontWeight: 900,
            letterSpacing: size * -0.01,
            lineHeight: 1,
            marginBottom: size * 0.04,
          }}
        >
          MAPM
        </div>

        {/* by CYMI */}
        <div
          style={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: size * 0.08,
            letterSpacing: size * 0.004,
            fontWeight: 500,
          }}
        >
          by CYMI
        </div>

        {/* Fuel drop */}
        <div
          style={{
            position: 'absolute',
            top: size * 0.06,
            right: size * 0.08,
            width: size * 0.1,
            height: size * 0.14,
            background: '#4ade80',
            borderRadius: '50% 50% 50% 50% / 40% 40% 60% 60%',
          }}
        />
      </div>
    ),
    { width: size, height: size }
  );
}
