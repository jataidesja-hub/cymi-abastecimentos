'use client';

import { useState, useCallback, useMemo, useRef } from 'react';

const CACHE_TTL = 30 * 60 * 1000;
function getCacheKey(cidade: string) { return `mapm-v1-${cidade.toLowerCase().trim()}`; }
function saveCache(cidade: string, data: FuelPriceItem[], source: string) {
  try { sessionStorage.setItem(getCacheKey(cidade), JSON.stringify({ data, source, ts: Date.now() })); } catch {}
}
function loadCache(cidade: string): { data: FuelPriceItem[]; source: string } | null {
  try {
    const raw = sessionStorage.getItem(getCacheKey(cidade));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > CACHE_TTL) return null;
    return { data: parsed.data, source: parsed.source };
  } catch { return null; }
}
import dynamic from 'next/dynamic';
import InstallPrompt from '@/components/InstallPrompt';

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
  const [ticketLogOnly, setTicketLogOnly] = useState(false); // eslint-disable-line
  const [prices, setPrices] = useState<FuelPriceItem[]>([]);
  const allPricesRef = useRef<FuelPriceItem[]>([]);
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
  const [webPricesLoading, setWebPricesLoading] = useState(false);

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

  const applyFilter = (all: FuelPriceItem[], tipo: string) => {
    if (!tipo || tipo === 'Todos') return all;
    return all.filter(d => d.tipo_combustivel === tipo || d.tipo_combustivel === 'sem_preco');
  };

  const fetchPrices = useCallback(
    async (cidadeBusca: string, tipo?: string, coords?: { lat: number; lng: number }) => {
      if (!cidadeBusca.trim() && !coords) return;

      // Verifica cache primeiro
      if (cidadeBusca.trim()) {
        const cached = loadCache(cidadeBusca.trim());
        if (cached && cached.data.length > 0) {
          allPricesRef.current = cached.data;
          setPrices(applyFilter(cached.data, tipo || 'Todos'));
          setSource(cached.source + ' (cache)');
          setSearched(true);
          return;
        }
      }

      setLoading(true);
      setSearched(true);
      setPrices([]);

      try {
        const params = new URLSearchParams();
        if (cidadeBusca.trim()) params.append('cidade', cidadeBusca.trim());
        if (coords) {
          params.append('lat', String(coords.lat));
          params.append('lon', String(coords.lng));
        }

        // Claude AI como fonte primária
        const res = await fetch(`/api/claude-stations?${params}`);
        const json = await res.json();

        if (!json.error && json.data && json.data.length > 0) {
          const data: FuelPriceItem[] = json.data;
          allPricesRef.current = data;
          if (cidadeBusca.trim()) saveCache(cidadeBusca.trim(), data, json.source || 'Claude AI');
          setPrices(applyFilter(data, tipo || 'Todos'));
          setSource(json.source || 'Claude AI');
          return;
        }

        // Fallback: /api/stations (OSM + Supabase)
        setWebPricesLoading(true);
        const fallbackRes = await fetch(`/api/stations?${params}`);
        const fallbackJson = await fallbackRes.json();
        const fallbackData: FuelPriceItem[] = fallbackJson.data || [];
        allPricesRef.current = fallbackData;
        if (cidadeBusca.trim()) saveCache(cidadeBusca.trim(), fallbackData, fallbackJson.source || 'OpenStreetMap');
        setPrices(applyFilter(fallbackData, tipo || 'Todos'));
        setSource(fallbackJson.source || 'OpenStreetMap');
        setWebPricesLoading(false);

      } catch {
        showToast('Erro ao buscar dados', 'error');
      } finally {
        setLoading(false);
        setWebPricesLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleSearch = () => {
    if (cidade.trim()) {
      allPricesRef.current = [];
      fetchPrices(cidade, activeFuel);
    }
  };

  const handleFuelFilter = (tipo: string) => {
    setActiveFuel(tipo);
    if (allPricesRef.current.length > 0) {
      setPrices(applyFilter(allPricesRef.current, tipo));
    } else if (cidade || userLocation) {
      fetchPrices(cidade, tipo, userLocation || undefined);
    }
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

  const stats = useMemo(() => {
    const etanolList = realPrices.filter(p => p.tipo_combustivel === 'Etanol').map(p => p.preco);
    const gasolinaList = realPrices.filter(p => p.tipo_combustivel === 'Gasolina Comum').map(p => p.preco);
    const avgEtanol = etanolList.length ? etanolList.reduce((a, b) => a + b, 0) / etanolList.length : 0;
    const avgGasolina = gasolinaList.length ? gasolinaList.reduce((a, b) => a + b, 0) / gasolinaList.length : 0;
    const ratio = avgEtanol > 0 && avgGasolina > 0 ? (avgEtanol / avgGasolina) * 100 : 0;

    return {
      totalPostos: groupedStations.length,
      comPreco: groupedStations.filter(g => g.prices.length > 0).length,
      semPreco: groupedStations.filter(g => g.prices.length === 0).length,
      menorPreco: realPrices.length > 0 ? Math.min(...realPrices.map(p => p.preco)) : 0,
      maiorPreco: realPrices.length > 0 ? Math.max(...realPrices.map(p => p.preco)) : 0,
      menorTipo: realPrices.length > 0
        ? realPrices.reduce((a, b) => (a.preco < b.preco ? a : b)).tipo_combustivel
        : '',
      avgEtanol,
      avgGasolina,
      ratio: Math.round(ratio),
      etanolCompensa: ratio > 0 && ratio <= 70,
      temRatio: ratio > 0,
    };
  }, [groupedStations, realPrices]);

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
            <img src="/api/icon?size=42" alt="MAPM" className="logo-icon" style={{borderRadius:10, objectFit:'cover'}} />
            <div className="logo-text">
              <h1>MAPM</h1>
              <p>Melhor Abastecimento na Palma da Mão</p>
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

      {/* ── Stats ── */}
      {searched && groupedStations.length > 0 && activeTab !== 'ai' && (
        <>
          <div className="stats-bar">
            <div className="stat-card">
              <div className="stat-value">{stats.totalPostos}</div>
              <div className="stat-label">Postos</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: '#10b981' }}>{stats.comPreco}</div>
              <div className="stat-label">Com Preço</div>
            </div>
            {/* Ratio etanol/gasolina ou menor preço */}
            <div className={`stat-card ${stats.temRatio ? (stats.etanolCompensa ? 'stat-card-green' : 'stat-card-blue') : ''}`}>
              {stats.temRatio ? (
                <>
                  <div className="stat-value" style={{ color: stats.etanolCompensa ? '#10b981' : '#60a5fa', fontSize: '14px' }}>
                    {stats.etanolCompensa ? '🌿' : '⛽'} {stats.ratio}%
                  </div>
                  <div className="stat-label">{stats.etanolCompensa ? 'Etanol' : 'Gasolina'}</div>
                </>
              ) : stats.menorPreco > 0 ? (
                <>
                  <div className="stat-value" style={{ color: '#10b981' }}>R${stats.menorPreco.toFixed(2)}</div>
                  <div className="stat-label">Menor</div>
                </>
              ) : (
                <>
                  <div className="stat-value" style={{ color: '#f59e0b' }}>{stats.semPreco}</div>
                  <div className="stat-label">Sem Preço</div>
                </>
              )}
            </div>
          </div>

          {/* Recomendação etanol vs gasolina */}
          {stats.temRatio && (
            <div className="ratio-banner">
              <div className="ratio-banner-left">
                <span className="ratio-icon">{stats.etanolCompensa ? '🌿' : '⛽'}</span>
                <div>
                  <div className="ratio-title">
                    {stats.etanolCompensa ? 'Etanol compensa!' : 'Gasolina compensa mais'}
                  </div>
                  <div className="ratio-desc">
                    Etanol = {stats.ratio}% da gasolina
                    {stats.etanolCompensa
                      ? ' — abaixo de 70%, etanol é mais econômico'
                      : ' — acima de 70%, gasolina rende mais'}
                  </div>
                </div>
              </div>
              <div className={`ratio-badge ${stats.etanolCompensa ? 'green' : 'blue'}`}>
                {stats.etanolCompensa ? '✓ Etanol' : '✓ Gasolina'}
              </div>
            </div>
          )}
        </>
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
              {webPricesLoading && (
                <span className="text-xs text-amber-400 font-normal ml-2 animate-pulse">
                  🌐 buscando preços na web...
                </span>
              )}
            </div>

            {groupedStations.map((g, i) => {
              const hasPrices = g.prices.length > 0;
              const isWeb = g.prices.some(p => p.fonte === 'pesquisa web');
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
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white truncate leading-tight">
                          {g.station.nome}
                        </span>
                        {isTicketLog && (
                          <span className="text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0">
                            🎫 TL
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                        📍 {g.station.endereco}
                      </div>
                    </div>
                  </div>

                  {/* Preços */}
                  {hasPrices ? (
                    <>
                      {isWeb && (
                        <div className="flex items-center gap-1.5 mb-2 text-[10px] text-amber-400/70 font-medium">
                          <span>🌐</span>
                          <span>Estimativa regional — confirme no posto</span>
                        </div>
                      )}
                      <div className="price-list">
                        {g.prices.map(p => {
                          const pIsWeb = p.fonte === 'pesquisa web';
                          const isCheapestPrice = stats.menorPreco > 0 && p.preco === stats.menorPreco;
                          const isMostExp = stats.maiorPreco > 0 && p.preco === stats.maiorPreco && stats.totalPostos > 1;
                          const colorClass = pIsWeb ? 'amber' : isCheapestPrice ? 'green' : isMostExp ? 'red' : 'normal';
                          const fuelIcon = FUEL_ICONS[p.tipo] || '⛽';
                          return (
                            <div key={p.tipo} className="price-row">
                              <div className="price-row-left">
                                <span className="price-row-icon">{fuelIcon}</span>
                                <span className="price-row-label">{p.tipo}</span>
                              </div>
                              <span className={`price-row-value ${colorClass}`}>
                                <span className="price-row-rs">R$</span>
                                {p.preco.toFixed(2)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="card-footer">
                        <span className="card-footer-time">
                          {isWeb ? '🌐 via pesquisa web' : `🕐 ${timeAgo(g.prices[0].data)}`}
                        </span>
                        <button
                          className={`card-action-btn ${isWeb ? 'confirm' : ''}`}
                          onClick={() => openReport(g.station)}
                        >
                          {isWeb ? '✓ Confirmar' : '✏️ Atualizar'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="no-price-row">
                      <span className="text-xs text-gray-500">Sem preço cadastrado</span>
                      <button className="add-price-btn" onClick={() => openReport(g.station)}>
                        + Adicionar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      <InstallPrompt />

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
