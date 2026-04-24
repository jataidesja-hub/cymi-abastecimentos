'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showAndroid, setShowAndroid] = useState(false);
  const [showIOS, setShowIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Não mostra se já instalado ou já dispensado
    const isDismissed = localStorage.getItem('mapm-install-dismissed');
    if (isDismissed) return;

    // Detecta iOS (Safari)
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isInStandalone = (window.navigator as any).standalone === true;
    if (isIOS && !isInStandalone) {
      setTimeout(() => setShowIOS(true), 3000);
      return;
    }

    // Android: aguarda evento beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setShowAndroid(true), 2000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowAndroid(false);
      localStorage.setItem('mapm-install-dismissed', '1');
    }
    setDeferredPrompt(null);
  };

  const dismiss = () => {
    setShowAndroid(false);
    setShowIOS(false);
    setDismissed(true);
    localStorage.setItem('mapm-install-dismissed', '1');
  };

  if (dismissed) return null;

  // ── Android ──────────────────────────────────────────────────────────────────
  if (showAndroid) {
    return (
      <div className="install-banner">
        <div className="install-icon">
          <img src="/api/icon?size=44" alt="MAPM" width={44} height={44} style={{ borderRadius: 10 }} />
        </div>
        <div className="install-info">
          <div className="install-title">Instalar MAPM</div>
          <div className="install-sub">Melhor Abastecimento na Palma da Mão</div>
        </div>
        <button className="install-btn" onClick={handleInstall}>Instalar</button>
        <button className="install-close" onClick={dismiss}>✕</button>
      </div>
    );
  }

  // ── iOS ───────────────────────────────────────────────────────────────────────
  if (showIOS) {
    return (
      <div className="install-ios-overlay" onClick={dismiss}>
        <div className="install-ios-card" onClick={e => e.stopPropagation()}>
          <button className="install-close install-close-abs" onClick={dismiss}>✕</button>
          <img src="/api/icon?size=64" alt="MAPM" width={64} height={64} style={{ borderRadius: 14, margin: '0 auto 12px', display: 'block' }} />
          <div className="install-ios-title">Instalar MAPM</div>
          <div className="install-ios-desc">Adicione à tela inicial do seu iPhone para acesso rápido</div>
          <div className="install-ios-steps">
            <div className="ios-step">
              <span className="ios-step-num">1</span>
              <span>Toque no botão <strong>Compartilhar</strong> <span style={{fontSize:18}}>⬆️</span> na barra do Safari</span>
            </div>
            <div className="ios-step">
              <span className="ios-step-num">2</span>
              <span>Role para baixo e toque em <strong>"Adicionar à Tela de Início"</strong></span>
            </div>
            <div className="ios-step">
              <span className="ios-step-num">3</span>
              <span>Toque em <strong>Adicionar</strong> no canto superior direito</span>
            </div>
          </div>
          <div className="ios-arrow-down">▼</div>
        </div>
      </div>
    );
  }

  return null;
}
