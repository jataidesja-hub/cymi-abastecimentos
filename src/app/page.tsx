'use client';

import { useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';

const GasMap = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="map-container flex items-center justify-center bg-gray-900 text-gray-500">
      Carregando mapa...
    </div>
  ),
});

interface Station {
  id: string;
  osm_id?: number;
  nome: string;
  bandeira: string;
  endereco: string;
  cidade: string;
  estado: string;
  latitude: number;
  longitude: number;
  ticket_log?: boolean;
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
  prices: { tipo: string; preco: number; data: string; fonte: string }[];
}

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
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

export default function Home() {
  const [cidade, setCidade] = useState('');
  const [activeFuel, setActiveFuel] = useState('Todos');
  const [ticketLogOnly, setTicketLogOnly] = useState(false);
  const [prices, setPrices] = useState<FuelPriceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [source, setSource] = useState('');
  const [activeTab, setActiveTab] = useState('home');
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  // Estado do modal de reporte
  const [showReport, setShowReport] = useState(false);
  const [reportStationObj, setReportStationObj] = useState<Station | null>(null);
  const [reportFuel, setReportFuel] = useState('Gasolina Comum');
  const [reportPrice, setReportPrice] = useState('');
  const [reportTicketLog, setReportTicketLog] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg);
    setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  const fetchPrices = useCallback(
    async (cidadeBusca: string, tipo?: string, coords?: { lat: number; lng: number }) => {
      if (!cidadeBusca.trim() && !coords) return;
      setLoading(true);
      setSearched(true);
      try {
        const params = new URLSearchParams();
        if (cidadeBusca.trim()) params.append('cidade', cidadeBusca.trim());
        if (coords) {
          params.append('lat', String(coords.lat));
          params.append('lon', String(coords.lng));
        }
        if (tipo && tipo !== 'Todos') params.append('tipo', tipo);

        const res = await fetch(`/api/stations?${params}`);
        const json = await res.json();
        if (json.error) {
          showToast(json.error, 'error');
          setPrices([]);
        } else {
          const data: FuelPriceItem[] = json.data || [];
          setPrices(data);
          setSource(json.source || '');
          const semPreco = data.filter(d => d.tipo_combustivel === 'sem_preco').length;
          const comPreco = data.filter(d => d.preco > 0).length;
          if (data.length > 0 && comPreco === 0) {
            showToast(`${semPreco} postos encontrados. Seja o primeiro a reportar preços!`);
          }
        }
      } catch {
        showToast('Erro ao buscar dados', 'error');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleSearch = () => {
    if (cidade.trim()) fetchPrices(cidade, activeFuel);
  };

  const handleFuelFilter = (tipo: string) => {
    setActiveFuel(tipo);
    if (cidade || userLocation) fetchPrices(cidade, tipo, userLocation || undefined);
  };

  const handleGPS = async () => {
    if (!navigator.geolocation) return showToast('GPS não disponível', 'error');
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude, longitude } = pos.coords;
        const coords = { lat: latitude, lng: longitude };
        setUserLocation(coords);
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=pt-BR`
          );
          const data = await res.json();
          const city =
            data.address?.city ||
            data.address?.town ||
            data.address?.municipality ||
            '';
          if (city) setCidade(city);
          fetchPrices(city, activeFuel, coords);
        } catch {
          fetchPrices('', activeFuel, coords);
        } finally {
          setGpsLoading(false);
        }
      },
      () => {
        setGpsLoading(false);
        showToast('Erro ao obter localização GPS', 'error');
      }
    );
  };

  const handleAIAnalysis = useCallback(async () => {
    if (!cidade && !userLocation) return;
    setAiLoading(true);
    try {
      const realPrices = prices.filter(p => p.preco > 0);
      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cidade, prices: realPrices, userLocation }),
      });
      const data = await res.json();
      setAiAnalysis(data.analysis || 'Análise indisponível.');
    } catch {
      setAiAnalysis('Erro ao gerar análise.');
    } finally {
      setAiLoading(false);
    }
  }, [cidade, prices, userLocation]);

  const openReport = (station: Station) => {
    setReportStationObj(station);
    setReportTicketLog(station.ticket_log || false);
    setReportFuel('Gasolina Comum');
    setReportPrice('');
    setShowReport(true);
  };

  const handleReport = async () => {
    if (!reportStationObj || !reportPrice) return;
    const precoNum = parseFloat(reportPrice.replace(',', '.'));
    if (isNaN(precoNum) || precoNum <= 0 || precoNum > 20) {
      showToast('Preço inválido (deve ser entre 0,01 e 20,00)', 'error');
      return;
    }
    setReportSubmitting(true);
    try {
      const isOsmOnly = reportStationObj.id.startsWith('osm-');
      const res = await fetch('/api/report-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          station_id: isOsmOnly ? undefined : reportStationObj.id,
          osm_id: reportStationObj.osm_id,
          station_info: {
            nome: reportStationObj.nome,
            bandeira: reportStationObj.bandeira,
            endereco: reportStationObj.endereco,
            cidade: reportStationObj.cidade,
            estado: reportStationObj.estado,
            latitude: reportStationObj.latitude,
            longitude: reportStationObj.longitude,
          },
          tipo_combustivel: reportFuel,
          preco: precoNum,
          ticket_log: reportTicketLog,
          reportado_por: 'usuário',
        }),
      });
      const json = await res.json();
      if (json.error) {
        showToast(json.error, 'error');
      } else {
        showToast('Preço reportado! Obrigado pela contribuição! 🙌');
        setShowReport(false);
        fetchPrices(cidade, activeFuel, userLocation || undefined);
      }
    } catch {
      showToast('Erro ao enviar reporte', 'error');
    } finally {
      setReportSubmitting(false);
    }
  };

  // Agrupa por posto e filtra entradas sem preço das listas de preço
  const groupedStations = useMemo(() => {
    const map = new Map<string, GroupedStation>();
    prices.forEach(p => {
      const sid = p.stations.id;
      if (!map.has(sid)) map.set(sid, { station: p.stations, prices: [] });
      if (p.tipo_combustivel !== 'sem_preco' && p.preco > 0) {
        map.get(sid)!.prices.push({
          tipo: p.tipo_combustivel,
          preco: p.preco,
          data: p.data_atualizacao,
          fonte: p.reportado_por || 'comunidade',
        });
      }
    });

    let stations = Array.from(map.values());

    // Filtro Ticket Log (client-side)
    if (ticketLogOnly) {
      stations = stations.filter(g => {
        const entry = prices.find(p => p.stations.id === g.station.id);
        return entry?.ticket_log === 'Sim' || g.station.ticket_log === true;
      });
    }

    // Ordena: com preço mais barato primeiro, depois sem preço
    return stations.sort((a, b) => {
      const aMin = a.prices.length > 0 ? Math.min(...a.prices.map(p => p.preco)) : Infinity;
      const bMin = b.prices.length > 0 ? Math.min(...b.prices.map(p => p.preco)) : Infinity;
      return aMin - bMin;
    });
  }, [prices, ticketLogOnly]);

  const realPrices = useMemo(
    () => prices.filter(p => p.preco > 0 && p.tipo_combustivel !== 'sem_preco'),
    [prices]
  );

  const stats = useMemo(() => ({
    totalPostos: groupedStations.length,
    comPreco: groupedStations.filter(g => g.prices.length > 0).length,
    semPreco: groupedStations.filter(g => g.prices.length === 0).length,
    menorPreco: realPrices.length > 0 ? Math.min(...realPrices.map(p => p.preco)) : 0,
    maiorPreco: realPrices.length > 0 ? Math.max(...realPrices.map(p => p.preco)) : 0,
    menorTipo:
      realPrices.length > 0
        ? realPrices.reduce((a, b) => (a.preco < b.preco ? a : b)).tipo_combustivel
        : '',
  }), [groupedStations, realPrices]);

  const mapCenter = useMemo((): [number, number] => {
    const first = groupedStations.find(g => g.station.latitude && g.station.longitude);
    if (first) return [first.station.latitude, first.station.longitude];
    if (userLocation) return [userLocation.lat, userLocation.lng];
    return [-9.39, -40.50]; // Petrolina como fallback
  }, [groupedStations, userLocation]);

  return (
    <div className="app-shell pb-24">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-top">
          <div className="app-logo">
            <div className="logo-icon">⛽</div>
            <div className="logo-text">
              <h1>Combustível Barato</h1>
              <p>Dados reais da comunidade</p>
            </div>
          </div>
          <button
            className="ai-badge"
            onClick={() => {
              setActiveTab('ai');
              handleAIAnalysis();
            }}
          >
            <span className="ai-dot"></span> IA Expert
          </button>
        </div>
        <div className="location-bar">
          <input
            className="location-input"
            placeholder="Digite a cidade..."
            value={cidade}
            onChange={e => setCidade(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <button
            className={`gps-btn ${gpsLoading ? 'loading' : ''}`}
            onClick={handleGPS}
            title="Usar minha localização"
          >
            🎯
          </button>
        </div>
      </header>

      {/* ── Filtro por tipo de combustível ── */}
      <div className="fuel-pills">
        {FUEL_TYPES.map(t => (
          <button
            key={t}
            className={`fuel-pill ${activeFuel === t ? 'active' : ''}`}
            onClick={() => handleFuelFilter(t)}
          >
            {FUEL_ICONS[t]} {t}
          </button>
        ))}
      </div>

      {/* ── Filtro Ticket Log ── */}
      <div className="px-5 pb-2">
        <button
          className={`ticket-log-toggle ${ticketLogOnly ? 'active' : ''}`}
          onClick={() => setTicketLogOnly(v => !v)}
        >
          <span>🎫</span>
          <span>Somente Ticket Log</span>
          {ticketLogOnly && <span className="ticket-log-badge">ATIVO</span>}
        </button>
      </div>

      {/* ── Stats ── */}
      {searched && groupedStations.length > 0 && activeTab !== 'ai' && (
        <div className="stats-bar">
          <div className="stat-card">
            <div className="stat-value">{stats.totalPostos}</div>
            <div className="stat-label">Postos</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-green-400">{stats.comPreco}</div>
            <div className="stat-label">Com Preço</div>
          </div>
          {stats.menorPreco > 0 ? (
            <div className="stat-card">
              <div className="stat-value text-green-400">R${stats.menorPreco.toFixed(2)}</div>
              <div className="stat-label">MENOR</div>
            </div>
          ) : (
            <div className="stat-card">
              <div className="stat-value text-yellow-400">{stats.semPreco}</div>
              <div className="stat-label">Sem Preço</div>
            </div>
          )}
        </div>
      )}

      {/* ── Tabs Lista / Mapa ── */}
      {searched && groupedStations.length > 0 && activeTab !== 'ai' && (
        <div className="view-tabs">
          <button
            className={`view-tab lista ${activeTab === 'home' ? 'active' : ''}`}
            onClick={() => setActiveTab('home')}
          >
            <span className="view-tab-icon">📋</span>
            Lista
            {activeTab === 'home' && (
              <span className="text-[10px] font-normal opacity-60 ml-1">
                {groupedStations.length}
              </span>
            )}
          </button>
          <button
            className={`view-tab mapa ${activeTab === 'map' ? 'active' : ''}`}
            onClick={() => setActiveTab('map')}
          >
            <span className="view-tab-icon">🗺️</span>
            Mapa
          </button>
        </div>
      )}

      {/* ── Conteúdo principal ── */}
      <main className="tab-content">
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
            <div className="loading-text">Buscando postos reais...</div>
          </div>
        ) : !searched ? (
          <div className="empty-state">
            <div className="empty-icon">📍</div>
            <div className="empty-title">Busque sua cidade</div>
            <div className="empty-text">
              Digite o nome da cidade ou use o GPS para encontrar postos reais na sua região com dados reais de preço
            </div>
          </div>
        ) : groupedStations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <div className="empty-title">
              {ticketLogOnly ? 'Nenhum posto Ticket Log' : 'Nenhum posto encontrado'}
            </div>
            <div className="empty-text">
              {ticketLogOnly
                ? 'Nenhum posto com Ticket Log confirmado nessa região. Reporte um posto!'
                : 'Não encontramos postos para essa busca no OpenStreetMap.'}
            </div>
          </div>
        ) : activeTab === 'map' ? (
          <div className="px-5">
            <GasMap stations={groupedStations} center={mapCenter} zoom={13} />
          </div>
        ) : activeTab === 'ai' ? (
          <div className="px-5">
            <div className="ai-panel">
              {aiLoading ? (
                <div className="p-10 text-center text-gray-400">Analisando dados reais...</div>
              ) : aiAnalysis ? (
                <div
                  className="p-5 overflow-auto text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: aiAnalysis
                      .replace(/\n/g, '<br/>')
                      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
                  }}
                />
              ) : (
                <div className="p-10 text-center text-gray-400">
                  Clique em Recalcular para gerar análise
                </div>
              )}
            </div>
            <button
              className="w-full mt-4 py-3 bg-purple-600 rounded-lg font-bold"
              onClick={handleAIAnalysis}
            >
              Recalcular Recomendação
            </button>
          </div>
        ) : (
          /* ── Lista de postos ── */
          <div className="stations-container">
            <div className="section-title">
              🏆 Ranking — {cidade || 'Região GPS'}
              {source && (
                <span className="text-xs text-gray-600 font-normal ml-2">via {source}</span>
              )}
            </div>

            {groupedStations.map((g, i) => {
              const hasPrices = g.prices.length > 0;
              const isTicketLog =
                g.station.ticket_log ||
                prices.find(p => p.stations.id === g.station.id)?.ticket_log === 'Sim';

              return (
                <div
                  key={g.station.id}
                  className={`station-card ${i === 0 && hasPrices ? 'cheapest' : ''}`}
                >
                  {i === 0 && hasPrices && (
                    <div className="cheapest-badge">🏆 MAIS BARATO</div>
                  )}

                  {/* Cabeçalho do posto */}
                  <div className="station-header">
                    <div className={`station-brand ${getBrandClass(g.station.bandeira)}`}>
                      {getBrandInitials(g.station.bandeira)}
                    </div>
                    <div className="station-info flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="m-0 text-base font-bold text-white truncate">
                          {g.station.nome}
                        </h3>
                        {isTicketLog && (
                          <span className="bg-blue-600 text-[10px] text-white px-2 py-0.5 rounded font-bold uppercase tracking-wider shrink-0">
                            🎫 TL
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        📍 {g.station.endereco}
                      </div>
                    </div>
                  </div>

                  {/* Preços ou placeholder */}
                  {hasPrices ? (
                    <>
                      {g.prices.some(p => p.fonte === 'pesquisa web') && (
                        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-amber-400/80 font-medium">
                          <span>🌐</span>
                          <span>Preço estimado para a região via pesquisa web — confirme no posto</span>
                        </div>
                      )}
                      <div className="station-prices mt-2 flex flex-wrap gap-2">
                        {g.prices.map(p => {
                          const isWeb = p.fonte === 'pesquisa web';
                          const isCheapest = stats.menorPreco > 0 && p.preco === stats.menorPreco;
                          const isMostExpensive =
                            stats.maiorPreco > 0 &&
                            p.preco === stats.maiorPreco &&
                            stats.totalPostos > 1;
                          const priceColor = isWeb
                            ? 'text-amber-400'
                            : isCheapest
                            ? 'text-green-400'
                            : isMostExpensive
                            ? 'text-red-500'
                            : 'text-gray-300';

                          return (
                            <div
                              key={p.tipo}
                              className={`price-tag bg-gray-900/80 border ${
                                isWeb
                                  ? 'border-amber-500/20'
                                  : isCheapest
                                  ? 'border-green-500/30'
                                  : 'border-gray-700/50'
                              } p-2 rounded-lg flex flex-col min-w-[100px]`}
                            >
                              <span className="text-[10px] uppercase text-gray-500 font-bold">
                                {p.tipo.replace('Gasolina ', 'Gas. ')}
                              </span>
                              <span className={`${priceColor} font-bold text-sm`}>
                                <span className="text-[10px] font-normal mr-0.5 opacity-60">R$</span>
                                {p.preco.toFixed(3)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <div className="text-[10px] text-gray-500 italic">
                          {g.prices[0].fonte === 'pesquisa web'
                            ? '🌐 Atualizado agora via web'
                            : `🕐 ${timeAgo(g.prices[0].data)}`}
                        </div>
                        <button
                          className="text-[11px] text-blue-400 hover:text-blue-300 font-medium transition-colors"
                          onClick={() => openReport(g.station)}
                        >
                          📝 {g.prices[0].fonte === 'pesquisa web' ? 'Confirmar preço real' : 'Atualizar preço'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="mt-3 p-3 bg-gray-900/50 border border-dashed border-gray-700 rounded-lg flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-500">Sem preço cadastrado</span>
                      <button
                        className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-bold transition-colors shrink-0"
                        onClick={() => openReport(g.station)}
                      >
                        + Reportar preço
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Bottom Nav ── */}
      <nav className="bottom-nav">
        <button
          className={`nav-item ${activeTab === 'home' ? 'active' : ''}`}
          onClick={() => setActiveTab('home')}
        >
          🏠<span className="nav-label">Início</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'ai' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('ai');
            handleAIAnalysis();
          }}
        >
          🤖<span className="nav-label">IA Expert</span>
        </button>
        <button
          className="nav-item"
          onClick={() => {
            setReportStationObj(null);
            setReportPrice('');
            setReportFuel('Gasolina Comum');
            setReportTicketLog(false);
            setShowReport(true);
          }}
        >
          📝<span className="nav-label">Reportar</span>
        </button>
      </nav>

      {/* ── Modal de Reporte ── */}
      {showReport && (
        <div
          className="modal-overlay"
          onClick={e => {
            if (e.target === e.currentTarget) setShowReport(false);
          }}
        >
          <div className="modal-content">
            <div className="modal-handle" />
            <div className="flex items-center justify-between mb-5">
              <h2 className="modal-title">📝 Reportar Preço</h2>
              <button
                className="text-gray-500 text-xl font-bold leading-none"
                onClick={() => setShowReport(false)}
              >
                ✕
              </button>
            </div>

            {/* Posto pré-selecionado ou dropdown */}
            {reportStationObj ? (
              <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
                <div className="text-sm font-bold text-white">{reportStationObj.nome}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  📍 {reportStationObj.endereco}
                </div>
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">Posto</label>
                <select
                  className="form-select"
                  defaultValue=""
                  onChange={e => {
                    const g = groupedStations.find(x => x.station.id === e.target.value);
                    if (g) setReportStationObj(g.station);
                  }}
                >
                  <option value="" disabled>
                    Selecione um posto...
                  </option>
                  {groupedStations.map(g => (
                    <option key={g.station.id} value={g.station.id}>
                      {g.station.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Tipo de combustível */}
            <div className="form-group">
              <label className="form-label">Tipo de Combustível</label>
              <select
                className="form-select"
                value={reportFuel}
                onChange={e => setReportFuel(e.target.value)}
              >
                {FUEL_TYPES.filter(t => t !== 'Todos').map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Preço */}
            <div className="form-group">
              <label className="form-label">Preço (R$)</label>
              <input
                className="form-input"
                type="number"
                step="0.001"
                min="0.01"
                max="20"
                placeholder="Ex: 6.499"
                value={reportPrice}
                onChange={e => setReportPrice(e.target.value)}
              />
            </div>

            {/* Ticket Log */}
            <div className="form-group">
              <button
                type="button"
                className="flex items-center gap-3 cursor-pointer w-full text-left"
                onClick={() => setReportTicketLog(v => !v)}
              >
                <div className={`ticket-log-checkbox ${reportTicketLog ? 'checked' : ''}`}>
                  {reportTicketLog && '✓'}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">🎫 Aceita Ticket Log</div>
                  <div className="text-xs text-gray-500">
                    Marque se esse posto aceita cartão Ticket Log
                  </div>
                </div>
              </button>
            </div>

            <button
              className="submit-btn"
              onClick={handleReport}
              disabled={reportSubmitting || !reportStationObj || !reportPrice}
            >
              {reportSubmitting ? 'Enviando...' : 'Confirmar Preço'}
            </button>
            <p className="text-center text-xs text-gray-600 mt-3">
              Seus dados ajudam outros motoristas a economizar 🙌
            </p>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
      )}
    </div>
  );
}
