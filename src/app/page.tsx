'use client';

import { useState, useEffect, useCallback } from 'react';

// ============= TYPES =============
interface Station {
  id: string;
  nome: string;
  bandeira: string;
  endereco: string;
  cidade: string;
  estado: string;
  latitude: number;
  longitude: number;
}

interface FuelPriceItem {
  id: string;
  tipo_combustivel: string;
  preco: number;
  data_atualizacao: string;
  reportado_por: string;
  stations: Station;
}

interface GroupedStation {
  station: Station;
  prices: { tipo: string; preco: number; data: string }[];
}

// ============= CONSTANTS =============
const FUEL_TYPES = ['Todos', 'Gasolina Comum', 'Gasolina Aditivada', 'Etanol', 'Diesel S10', 'Diesel S500', 'GNV'];

const FUEL_ICONS: Record<string, string> = {
  'Gasolina Comum': '⛽',
  'Gasolina Aditivada': '🔷',
  'Etanol': '🌿',
  'Diesel S10': '🛢️',
  'Diesel S500': '🏭',
  'GNV': '💨',
  'Todos': '🔥',
};

function getBrandClass(bandeira: string): string {
  const b = bandeira.toLowerCase();
  if (b.includes('shell')) return 'brand-shell';
  if (b.includes('ipiranga')) return 'brand-ipiranga';
  if (b.includes('petrobras') || b.includes('br')) return 'brand-petrobras';
  if (b.includes('ale')) return 'brand-ale';
  return 'brand-branco';
}

function getBrandInitials(bandeira: string): string {
  if (bandeira.toLowerCase().includes('petrobras')) return 'BR';
  return bandeira.slice(0, 2).toUpperCase();
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

// ============= MAIN COMPONENT =============
export default function Home() {
  const [cidade, setCidade] = useState('');
  const [activeFuel, setActiveFuel] = useState('Todos');
  const [prices, setPrices] = useState<FuelPriceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [activeTab, setActiveTab] = useState('home');

  // Report form state
  const [reportStation, setReportStation] = useState('');
  const [reportFuel, setReportFuel] = useState('Gasolina Comum');
  const [reportPrice, setReportPrice] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchPrices = useCallback(async (cidadeBusca: string, tipo?: string) => {
    if (!cidadeBusca.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ cidade: cidadeBusca });
      if (tipo && tipo !== 'Todos') params.append('tipo', tipo);
      const res = await fetch(`/api/stations?${params}`);
      const json = await res.json();
      setPrices(json.data || []);
    } catch {
      showToast('Erro ao buscar postos');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => {
    if (cidade.trim()) {
      fetchPrices(cidade, activeFuel);
    }
  };

  const handleFuelFilter = (tipo: string) => {
    setActiveFuel(tipo);
    if (cidade.trim()) {
      fetchPrices(cidade, tipo);
    }
  };

  const handleGPS = async () => {
    if (!navigator.geolocation) {
      showToast('GPS não suportado neste dispositivo');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          // Reverse geocoding via Nominatim
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=pt-BR`
          );
          const data = await res.json();
          const city = data.address?.city || data.address?.town || data.address?.municipality || '';
          if (city) {
            setCidade(city);
            fetchPrices(city, activeFuel);
            showToast(`📍 Localização: ${city}`);
          } else {
            showToast('Não foi possível identificar sua cidade');
          }
        } catch {
          showToast('Erro ao obter localização');
        } finally {
          setGpsLoading(false);
        }
      },
      () => {
        showToast('Permissão de localização negada');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleAIAnalysis = async () => {
    if (!cidade.trim()) {
      showToast('Busque uma cidade primeiro');
      return;
    }
    setShowAI(true);
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cidade }),
      });
      const data = await res.json();
      setAiAnalysis(data.analysis || 'Sem dados para análise');
    } catch {
      setAiAnalysis('Erro ao gerar análise. Tente novamente.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleReport = async () => {
    if (!reportStation || !reportPrice) {
      showToast('Preencha todos os campos');
      return;
    }
    setReportSubmitting(true);
    try {
      const res = await fetch('/api/report-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          station_id: reportStation,
          tipo_combustivel: reportFuel,
          preco: parseFloat(reportPrice),
          reportado_por: 'usuário',
        }),
      });
      const data = await res.json();
      if (data.error) {
        showToast(`Erro: ${data.error}`);
      } else {
        showToast('✅ Preço reportado com sucesso!');
        setShowReport(false);
        setReportPrice('');
        if (cidade) fetchPrices(cidade, activeFuel);
      }
    } catch {
      showToast('Erro ao reportar preço');
    } finally {
      setReportSubmitting(false);
    }
  };

  // Group prices by station
  const groupedStations: GroupedStation[] = (() => {
    const map = new Map<string, GroupedStation>();
    for (const item of prices) {
      const sid = item.stations?.id;
      if (!sid) continue;
      if (!map.has(sid)) {
        map.set(sid, { station: item.stations, prices: [] });
      }
      map.get(sid)!.prices.push({
        tipo: item.tipo_combustivel,
        preco: item.preco,
        data: item.data_atualizacao,
      });
    }
    // Sort by cheapest price in the group
    return Array.from(map.values()).sort((a, b) => {
      const minA = Math.min(...a.prices.map((p) => p.preco));
      const minB = Math.min(...b.prices.map((p) => p.preco));
      return minA - minB;
    });
  })();

  // Cheapest prices per fuel type
  const cheapestByType: Record<string, number> = {};
  for (const item of prices) {
    if (!cheapestByType[item.tipo_combustivel] || item.preco < cheapestByType[item.tipo_combustivel]) {
      cheapestByType[item.tipo_combustivel] = item.preco;
    }
  }

  // Stats
  const totalStations = groupedStations.length;
  const totalFuelTypes = new Set(prices.map((p) => p.tipo_combustivel)).size;
  const cheapestPrice = prices.length > 0 ? Math.min(...prices.map((p) => p.preco)) : 0;

  // Unique stations for report dropdown
  const uniqueStations = Array.from(
    new Map(prices.map((p) => [p.stations?.id, p.stations])).values()
  ).filter(Boolean);

  return (
    <div className="app-shell">
      {/* HEADER */}
      <header className="app-header">
        <div className="header-top">
          <div className="app-logo">
            <div className="logo-icon">⛽</div>
            <div className="logo-text">
              <h1>Combustível Barato</h1>
              <p>Encontre o menor preço</p>
            </div>
          </div>
          <button className="ai-badge" onClick={handleAIAnalysis} title="Análise IA">
            <span className="ai-dot"></span>
            IA Ativa
          </button>
        </div>
        <div className="location-bar">
          <div className="location-input-wrapper">
            <span className="location-icon">📍</span>
            <input
              type="text"
              className="location-input"
              placeholder="Digite sua cidade..."
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              id="city-search"
            />
          </div>
          <button
            className={`gps-btn ${gpsLoading ? 'loading' : ''}`}
            onClick={handleGPS}
            disabled={gpsLoading}
            title="Usar GPS"
            id="gps-button"
          >
            🎯
          </button>
        </div>
      </header>

      {/* FUEL TYPE PILLS */}
      <div className="fuel-pills">
        {FUEL_TYPES.map((tipo) => (
          <button
            key={tipo}
            className={`fuel-pill ${activeFuel === tipo ? 'active' : ''}`}
            onClick={() => handleFuelFilter(tipo)}
            id={`fuel-${tipo.replace(/\s/g, '-').toLowerCase()}`}
          >
            {FUEL_ICONS[tipo]} {tipo}
          </button>
        ))}
      </div>

      {/* STATS BAR */}
      {searched && prices.length > 0 && (
        <div className="stats-bar">
          <div className="stat-card">
            <div className="stat-value">{totalStations}</div>
            <div className="stat-label">Postos</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{totalFuelTypes}</div>
            <div className="stat-label">Tipos</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">R${cheapestPrice.toFixed(2)}</div>
            <div className="stat-label">Menor</div>
          </div>
        </div>
      )}

      {/* AI ANALYSIS */}
      {showAI && (
        <div className="ai-panel">
          <div className="ai-panel-header" onClick={() => setShowAI(!showAI)}>
            <div className="ai-panel-title">
              🤖 Análise Inteligente
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>✕</span>
          </div>
          {aiLoading ? (
            <div className="ai-loading">
              <div className="ai-loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              Analisando preços...
            </div>
          ) : (
            <div className="ai-panel-body" dangerouslySetInnerHTML={{
              __html: aiAnalysis
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br/>')
            }} />
          )}
        </div>
      )}

      {/* STATION CARDS */}
      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <div className="loading-text">Buscando postos...</div>
        </div>
      ) : !searched ? (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">Busque sua cidade</div>
          <div className="empty-text">
            Digite o nome da sua cidade ou use o GPS para encontrar os postos com melhor preço perto de você.
          </div>
        </div>
      ) : groupedStations.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">😕</div>
          <div className="empty-title">Nenhum posto encontrado</div>
          <div className="empty-text">
            Não encontramos postos em &quot;{cidade}&quot;. Tente outra cidade ou seja o primeiro a reportar preços!
          </div>
        </div>
      ) : (
        <div className="stations-container">
          <div className="section-title">
            🏆 Ranking de Preços — {cidade}
          </div>
          {groupedStations.map((group, index) => {
            const isCheapest = index === 0;
            return (
              <div
                key={group.station.id}
                className={`station-card ${isCheapest ? 'cheapest' : ''}`}
                id={`station-${index}`}
              >
                {isCheapest && (
                  <div className="cheapest-badge">🏆 Mais Barato</div>
                )}
                <div className="station-header">
                  <div className={`station-brand ${getBrandClass(group.station.bandeira)}`}>
                    {getBrandInitials(group.station.bandeira)}
                  </div>
                  <div className="station-info">
                    <h3>{group.station.nome}</h3>
                    <div className="station-address">
                      📍 {group.station.endereco}
                    </div>
                  </div>
                </div>
                <div className="station-prices">
                  {group.prices
                    .sort((a, b) => a.preco - b.preco)
                    .map((price, pIdx) => {
                      const isCheapestForType = cheapestByType[price.tipo] === price.preco;
                      return (
                        <div key={pIdx} className="price-tag">
                          <span className="fuel-name">{price.tipo.replace('Gasolina ', 'Gas. ')}</span>
                          <span className={`fuel-price ${!isCheapestForType ? 'expensive' : ''}`}>
                            <span className="price-currency">R$ </span>
                            {price.preco.toFixed(3)}
                          </span>
                        </div>
                      );
                    })}
                </div>
                {group.prices[0] && (
                  <div className="price-time">
                    🕐 Atualizado {timeAgo(group.prices[0].data)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* FAB - Report Button */}
      {searched && prices.length > 0 && (
        <div className="fab-container">
          <button
            className="fab-btn"
            onClick={() => setShowReport(true)}
            title="Reportar preço"
            id="report-fab"
          >
            +
          </button>
        </div>
      )}

      {/* REPORT MODAL */}
      {showReport && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowReport(false)}>
          <div className="modal-content">
            <div className="modal-handle" />
            <h2 className="modal-title">📝 Reportar Preço</h2>
            <div className="form-group">
              <label className="form-label">Posto</label>
              <select
                className="form-select"
                value={reportStation}
                onChange={(e) => setReportStation(e.target.value)}
                id="report-station"
              >
                <option value="">Selecione o posto...</option>
                {uniqueStations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome} — {s.bandeira}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Tipo de Combustível</label>
              <select
                className="form-select"
                value={reportFuel}
                onChange={(e) => setReportFuel(e.target.value)}
                id="report-fuel"
              >
                {FUEL_TYPES.filter((t) => t !== 'Todos').map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Preço (R$)</label>
              <input
                type="number"
                className="form-input"
                placeholder="Ex: 5.799"
                step="0.001"
                min="0.001"
                max="20"
                value={reportPrice}
                onChange={(e) => setReportPrice(e.target.value)}
                id="report-price"
              />
            </div>
            <button
              className="submit-btn"
              onClick={handleReport}
              disabled={reportSubmitting}
              id="report-submit"
            >
              {reportSubmitting ? 'Enviando...' : '✅ Reportar Preço'}
            </button>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && <div className="toast">{toast}</div>}

      {/* BOTTOM NAV */}
      <nav className="bottom-nav">
        <button
          className={`nav-item ${activeTab === 'home' ? 'active' : ''}`}
          onClick={() => setActiveTab('home')}
          id="nav-home"
        >
          <span className="nav-icon">🏠</span>
          <span className="nav-label">Início</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'ai' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('ai');
            handleAIAnalysis();
          }}
          id="nav-ai"
        >
          <span className="nav-icon">🤖</span>
          <span className="nav-label">IA</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'report' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('report');
            setShowReport(true);
          }}
          id="nav-report"
        >
          <span className="nav-icon">📝</span>
          <span className="nav-label">Reportar</span>
        </button>
      </nav>
    </div>
  );
}
