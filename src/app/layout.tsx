import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAPM — Melhor Abastecimento na Palma da Mão",
  description: "Melhor Abastecimento na Palma da Mão. Compare preços de gasolina, etanol, diesel e GNV em tempo real. by CYMI",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/api/icon?size=32", sizes: "32x32", type: "image/png" },
      { url: "/api/icon?size=192", sizes: "192x192", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/api/icon?size=192", sizes: "192x192", type: "image/png" }],
    shortcut: "/api/icon?size=192",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MAPM",
  },
  openGraph: {
    title: "MAPM — Melhor Abastecimento na Palma da Mão",
    description: "Encontre o posto mais barato perto de você. by CYMI",
    type: "website",
    images: [{ url: "/icon-512.png", width: 512, height: 512 }],
  },
  keywords: ["combustível", "gasolina", "etanol", "diesel", "posto", "preço", "MAPM", "CYMI"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1a5f37",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MAPM" />
        <link rel="apple-touch-icon" href="/api/icon?size=192" />
        <link rel="apple-touch-startup-image" href="/api/icon?size=512" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="MAPM" />
      </head>
      <body>{children}</body>
    </html>
  );
}
