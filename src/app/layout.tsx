import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CYMI GO — Combustível Inteligente",
  description: "Encontre postos de combustível com os melhores preços da sua região. Compare gasolina, etanol, diesel e GNV em tempo real.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/icon-192.png", sizes: "192x192" },
    ],
    shortcut: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CYMI GO",
  },
  openGraph: {
    title: "CYMI GO — Combustível Inteligente",
    description: "Encontre o posto mais barato perto de você. Gasolina, Etanol, Diesel e GNV.",
    type: "website",
    images: [{ url: "/icon-512.png", width: 512, height: 512 }],
  },
  twitter: {
    card: "summary",
    title: "CYMI GO",
    description: "Combustível inteligente — melhor preço sempre",
  },
  keywords: ["combustível", "gasolina", "etanol", "diesel", "posto", "preço", "CYMI"],
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
        {/* iOS PWA */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="CYMI GO" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="apple-touch-startup-image" href="/icon-512.png" />
        {/* Android / Chrome */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="CYMI GO" />
      </head>
      <body>{children}</body>
    </html>
  );
}
