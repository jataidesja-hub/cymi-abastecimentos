'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';

const GasMap = dynamic(() => import('@/components/Map'), { 
  ssr: false,
  loading: () => <div className="map-container flex items-center justify-center bg-gray-900 text-gray-500">Carregando mapa...</div>
});

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
  return 'brand-branco';
}

function getBrandInitials(bandeira: string): string {
  if (bandeira.toLowerCase().includes('petrobras')) return 'BR';
  return bandeira.slice(0, 2).toUpperCase();
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((new Date().getTime() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

export default function Home() {
  const [cidade, setCidade] = useState('');
  const [activeFuel, setActiveFuel] = useState('Todos');
  const [prices, setPrices] = useState<FuelPriceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [source, setSource] = useState('');
  const [showReport, setShowReport] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const [toast, setToast] = useState('');

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
      if (json.error) {
        showToast(json.error);
        setPrices([]);
      } else {
        setPrices(json.data || []);
        setSource(json.source || '');
      }
    } catch {
      showToast('Erro ao buscar dados');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => { if (cidade) fetchPrices(cidade, activeFuel); };
  const handleFuelFilter = (tipo: string) => { setActiveFuel(tipo); if (cidade) fetchPrices(cidade, tipo); };

  const handleGPS = async () => {
    if (!navigator.geolocation) return showToast('GPS não disponível');
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      setUserLocation({ lat: latitude, lng: longitude });
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=pt-BR`);
        const data = await res.json();
        const city = data.address?.city || data.address?.town || '';
        if (city) { setCidade(city); fetchPrices(city, activeFuel); }
      } catch { showToast('Erro de GPS'); } finally { setGpsLoading(false); }
    }, () => setGpsLoading(false));
  };

  const handleAIAnalysis = useCallback(async () => {
    if (!cidade || prices.length === 0) return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cidade, prices, userLocation }),
      });
      const data = await res.json();
      setAiAnalysis(data.analysis);
    } catch { setAiAnalysis('Houve um erro na análise.'); } finally { setAiLoading(false); }
  }, [cidade, prices, userLocation]);

  const groupedStations = useMemo(() => {
    const map = new Map<string, GroupedStation>();
    prices.forEach(p => {
      const sid = p.stations.id;
      if (!map.has(sid)) map.set(sid, { station: p.stations, prices: [] });
      map.get(sid)!.prices.push({ tipo: p.tipo_combustivel, preco: p.preco, data: p.data_atualizacao });
    });
    return Array.from(map.values()).sort((a, b) => Math.min(...a.prices.map(p => p.preco)) - Math.min(...b.prices.map(p => p.preco)));
  }, [prices]);

  const stats = {
    totalPostos: groupedStations.length,
    tipos: new Set(prices.map(p => p.tipo_combustivel)).size,
    menorPreco: prices.length > 0 ? Math.min(...prices.map(p => p.preco)) : 0,
    menorTipo: prices.length > 0 ? prices.reduce((a, b) => a.preco < b.preco ? a : b).tipo_combustivel : ''
  };

  const mapProps = useMemo(() => {
    if (groupedStations.length > 0) return { center: [groupedStations[0].station.latitude, groupedStations[0].station.longitude] as [number, number], zoom: 13 };
    return { center: [-23.55, -46.63] as [number, number], zoom: 12 };
  }, [groupedStations]);

  return (
    <div className="app-shell pb-24">
      <header className="app-header">
        <div className="header-top">
          <div className="app-logo">
            <div className="logo-icon">⛽</div>
            <div className="logo-text"><h1>Combustível Barato</h1><p>Encontre o menor preço</p></div>
          </div>
          <button className="ai-badge" onClick={() => { setActiveTab('ai'); handleAIAnalysis(); }}>
            <span className="ai-dot bg-purple-400"></span> IA Ativa
          </button>
        </div>
        <div className="location-bar">
          <input className="location-input" placeholder="Cidade..." value={cidade} onChange={e => setCidade(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} />
          <button className={`gps-btn ${gpsLoading ? 'loading' : ''}`} onClick={handleGPS}>🎯</button>
        </div>
      </header>

      <div className="fuel-pills">
        {FUEL_TYPES.map(t => (
          <button key={t} className={`fuel-pill ${activeFuel === t ? 'active' : ''}`} onClick={() => handleFuelFilter(t)}>
            {FUEL_ICONS[t]} {t}
          </button>
        ))}
      </div>

      {searched && prices.length > 0 && activeTab !== 'ai' && (
        <div className="stats-bar">
          <div className="stat-card"><div className="stat-value">{stats.totalPostos}</div><div className="stat-label">Postos</div></div>
          <div className="stat-card"><div className="stat-value">{stats.tipos}</div><div className="stat-label">Tipos</div></div>
          <div className="stat-card">
            <div className="stat-value text-green-400">R${stats.menorPreco.toFixed(2)}</div>
            <div className="stat-label">MENOR ({stats.menorTipo})</div>
          </div>
        </div>
      )}

      {searched && prices.length > 0 && activeTab !== 'ai' && (
        <div className="flex px-5 mb-4 gap-2">
          <button className={`flex-1 py-2 rounded-lg text-sm font-bold ${activeTab === 'home' ? 'bg-green-600' : 'bg-gray-800'}`} onClick={() => setActiveTab('home')}>📋 Lista</button>
          <button className={`flex-1 py-2 rounded-lg text-sm font-bold ${activeTab === 'map' ? 'bg-green-600' : 'bg-gray-800'}`} onClick={() => setActiveTab('map')}>🗺️ Mapa</button>
        </div>
      )}

      <main className="tab-content">
        {loading ? <div className="loading-container"><div className="loading-spinner"></div></div> :
         !searched ? <div className="empty-state">📍 Busque sua cidade para começar</div> :
         groupedStations.length === 0 ? <div className="empty-state">Nenhum posto encontrado</div> :
         activeTab === 'map' ? <div className="px-5"><GasMap stations={groupedStations} center={mapProps.center} zoom={mapProps.zoom} /></div> :
         activeTab === 'ai' ? (
           <div className="px-5">
             <div className="ai-panel">
               {aiLoading ? <div className="p-10 text-center">Analizando frotas...</div> :
                <div className="p-5 overflow-auto" dangerouslySetInnerHTML={{ __html: aiAnalysis.replace(/\n/g, '<br/>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />}
             </div>
             <button className="w-full mt-4 py-3 bg-purple-600 rounded-lg font-bold" onClick={handleAIAnalysis}>Recalcular Recomendação</button>
           </div>
         ) : (
           <div className="stations-container">
             {groupedStations.map((g, i) => (
               <div key={g.station.id} className={`station-card ${i === 0 ? 'cheapest' : ''}`}>
                 <div className="station-header">
                    <div className="station-info">
                      <div className="flex items-center gap-2">
                        <h3 className="text-white font-bold">{g.station.nome}</h3>
                        {prices.find(p => p.stations.id === g.station.id)?.ticket_log === 'Sim' && <span className="bg-blue-600 text-[10px] px-1 rounded">Ticket Log</span>}
                      </div>
                      <div className="text-xs text-gray-400">{g.station.endereco}</div>
                    </div>
                 </div>
                 <div className="station-prices mt-3 flex flex-wrap gap-2">
                   {g.prices.map(p => (
                     <div key={p.tipo} className="bg-gray-900 px-2 py-1 rounded text-xs">
                       <span className="text-gray-400 mr-2">{p.tipo}</span>
                       <span className="text-green-400 font-bold">R$ {p.preco.toFixed(3)}</span>
                     </div>
                   ))}
                 </div>
               </div>
             ))}
           </div>
         )}
      </main>

      <nav className="bottom-nav">
        <button className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')}>🏠<span className="nav-label">Início</span></button>
        <button className={`nav-item ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => { setActiveTab('ai'); handleAIAnalysis(); }}>🤖<span className="nav-label">IA Expert</span></button>
        <button className="nav-item" onClick={() => setShowReport(true)}>📝<span className="nav-label">Reportar</span></button>
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
