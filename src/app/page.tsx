'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';

// Dynamic import for Map to avoid SSR issues
const GasMap = dynamic(() => import('@/components/Map'), { 
  ssr: false,
  loading: () => <div className="map-container flex items-center justify-center bg-gray-900 text-gray-500">Carregando mapa...</div>
});

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
  ticket_log?: string;
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
  const [source, setSource] = useState<'Database' | 'IA Pesquisa Real-time' | ''>('');
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
    setSource('');
    try {
      const params = new URLSearchParams({ cidade: cidadeBusca });
      if (tipo && tipo !== 'Todos') params.append('tipo', tipo);
      const res = await fetch(`/api/stations?${params}`);
      const json = await res.json();
      
      if (json.error) {
        showToast(`Erro API: ${json.error}`);
        setPrices([]);
      } else {
        setPrices(json.data || []);
        setSource(json.source || 'Database');
      }
    } catch (err) {
      showToast('Erro técnico ao conectar com o servidor');
      console.error(err);
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

  const generateAnalysis = useCallback(async () => {
    if (!cidade || prices.length === 0) return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          cidade: cidade, 
          prices: prices,
          userLocation: userLocation 
        }),
      });
      const data = await res.json();
      setAiAnalysis(data.analysis);
    } catch {
      setAiAnalysis('Erro ao conectar com o especialista IA.');
    } finally {
      setAiLoading(false);
    }
  }, [cidade, prices, userLocation]);

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
  const groupedStations: GroupedStation[] = useMemo(() => {
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
  }, [prices]);

  // Cheapest prices per fuel type
  const cheapestByType: Record<string, number> = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of prices) {
      if (!map[item.tipo_combustivel] || item.preco < map[item.tipo_combustivel]) {
        map[item.tipo_combustivel] = item.preco;
      }
    }
    return map;
  }, [prices]);

  const stats = {
    totalPostos: Array.from(new Set(prices.map(p => p.stations.id))).length,
    tipos: Array.from(new Set(prices.map(p => p.tipo_combustivel))).length,
    menorPreco: prices.length > 0 ? Math.min(...prices.map(p => p.preco)) : 0,
    menorTipo: prices.length > 0 ? prices.reduce((prev, curr) => prev.preco < curr.preco ? prev : curr).tipo_combustivel : ''
  };

  // Map center
  const mapProps = useMemo(() => {
    if (groupedStations.length > 0) {
      const first = groupedStations[0].station;
      return { center: [first.latitude, first.longitude] as [number, number], zoom: 13 };
    }
    return { center: [-23.5505, -46.6333] as [number, number], zoom: 12 }; // SP default
  }, [groupedStations]);

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
          <button className="ai-badge" onClick={() => { setActiveTab('ai'); handleAIAnalysis(); }} title="Análise IA">
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
      {searched && prices.length > 0 && activeTab !== 'ai' && (
        <div className="stats-bar">
          <div className="stat-card">
            <div className="stat-value">{totalStations}</div>
            <div className="stat-label">Postos</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.tipos}</div>
            <div className="stat-label">Tipos</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-green-400">
              R${stats.menorPreco.toFixed(2)}
            </div>
            <div className="stat-label">
              MENOR ({stats.menorTipo})
            </div>
          </div>
        </div>
      )}

      {/* TABS NAVIGATION */}
      {searched && prices.length > 0 && activeTab !== 'ai' && (
        <div className="flex px-5 mb-4 gap-2">
          <button 
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'home' ? 'bg-green-600 text-white shadow-lg shadow-green-900/40' : 'bg-gray-800 text-gray-400'}`}
            onClick={() => setActiveTab('home')}
          >
            📋 Lista
          </button>
          <button 
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'map' ? 'bg-green-600 text-white shadow-lg shadow-green-900/40' : 'bg-gray-800 text-gray-400'}`}
            onClick={() => setActiveTab('map')}
          >
            🗺️ Mapa
          </button>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <main className="tab-content">
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <div className="loading-text">Buscando postos...</div>
          </div>
        ) : !searched ? (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <div className="empty-title">Aonde vamos hoje?</div>
            <div className="empty-text">
              Pesquise qualquer cidade do Brasil.<br/>
              Nossa IA buscará os postos mais baratos para você.
              <br/><br/>
              Ex: <strong>Petrolina</strong>, <strong>Juazeiro</strong>, <strong>Recife</strong>...
            </div>
          </div>
        ) : groupedStations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">😅</div>
            <div className="empty-title">Nenhum resultado</div>
            <div className="empty-text mb-6">
              Nossa pesquisa por IA não encontrou dados para &quot;{cidade}&quot; no momento. Tente novamente!
            </div>
          </div>
        ) : activeTab === 'map' ? (
          <div className="px-5">
             <div className="section-title mb-4">
              🗺️ Visualização Geográfica
            </div>
            <GasMap stations={groupedStations} center={mapProps.center} zoom={mapProps.zoom} />
            
            <div className="mt-4 flex flex-col gap-2">
               {groupedStations.slice(0, 3).map((group, i) => (
                 <div key={group.station.id} className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 flex justify-between items-center">
                    <div>
                      <div className="text-white text-sm font-bold">{i+1}. {group.station.nome}</div>
                      <div className="text-gray-400 text-xs">{group.station.endereco}</div>
                    </div>
                    <div className="text-green-400 font-bold">
                      R$ {Math.min(...group.prices.map(p => p.preco)).toFixed(3)}
                    </div>
                 </div>
               ))}
            </div>
          </div>
        ) : activeTab === 'ai' ? (
          <div className="px-5 pb-24">
             <div className="section-title mb-4">
              🤖 Análise da Inteligência Artificial
            </div>
            <div className="ai-panel !m-0">
              {aiLoading ? (
                <div className="ai-loading">
                  <div className="ai-loading-dots">
                    <span></span><span></span><span></span>
                  </div>
                  Analisando mercado local...
                </div>
              ) : (
                <div className="ai-panel-body p-5" dangerouslySetInnerHTML={{
                  __html: aiAnalysis
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n/g, '<br/>')
                }} />
              )}
            </div>
            
            <button 
              className="mt-6 w-full py-4 rounded-xl font-bold border border-purple-500/30 text-purple-400 bg-purple-500/10 flex items-center justify-center gap-2"
              onClick={handleAIAnalysis}
            >
              🔄 Recalcular Análise
            </button>
          </div>
        ) : (
          <div className="stations-container">
          <div className="section-title flex justify-between items-center">
            <span>🏆 Ranking de Preços — {cidade}</span>
            {source === 'IA Pesquisa Real-time' && (
              <span className="text-[10px] bg-purple-500/20 text-purple-400 px-2 py-1 rounded-full border border-purple-500/30 animate-pulse">
                ✨ Gerado por IA
              </span>
            )}
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
                      <div className="flex items-center gap-2">
                         <h3 className="m-0">{group.station.nome}</h3>
                         {prices.find(p => p.stations.id === group.station.id)?.ticket_log === 'Sim' && (
                            <span className="bg-blue-600 text-[10px] text-white px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                              Ticket Log
                            </span>
                         )}
                      </div>
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
      </main>

      {/* FAB - Report Button */}
      {searched && prices.length > 0 && activeTab !== 'ai' && (
        <div className="fab-container">
          <button
            className="fab-btn"
            onClick={() => setShowReport(true)}
            title="Reportar preço"
            id="report-fab"
          >
            <span className="text-2xl">+</span>
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
                  <option key={(s as any).id} value={(s as any).id}>
                    {(s as any).nome} — {(s as any).bandeira}
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
          className={`nav-item ${activeTab === 'home' || activeTab === 'map' ? 'active' : ''}`}
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
          <span className="nav-label">IA Expert</span>
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
