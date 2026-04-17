'use client';

import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';

// Fix for default marker icons in Leaflet
const iconRetinaUrl = 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png';
const iconUrl = 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png';
const shadowUrl = 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png';

// Change View component
function ChangeView({ center, zoom }: { center: [number, number], zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

interface Station {
  id: string;
  nome: string;
  latitude: number;
  longitude: number;
  bandeira: string;
}

interface FuelPrice {
  tipo: string;
  preco: number;
}

interface GroupedStation {
  station: Station;
  prices: FuelPrice[];
}

interface MapProps {
  stations: GroupedStation[];
  center: [number, number];
  zoom: number;
}

export default function GasMap({ stations, center, zoom }: MapProps) {
  
  const createCustomIcon = (isCheapest: boolean) => {
    return L.divIcon({
      className: 'custom-div-icon',
      html: `<div class="marker-pin ${isCheapest ? 'cheapest' : ''}"><div class="marker-content">⛽</div></div>`,
      iconSize: [40, 42],
      iconAnchor: [20, 42]
    });
  };

  return (
    <div className="map-container">
      <MapContainer 
        center={center} 
        zoom={zoom} 
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <ChangeView center={center} zoom={zoom} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          // Filter to make it look dark
          className="map-tiles"
        />
        {stations.map((group, idx) => {
          const isCheapest = idx === 0 && group.prices.length > 0;

          // Top 3 combustíveis de interesse
          const TOP_FUELS = ['Gasolina Comum', 'Etanol', 'Diesel S10'];
          const TOP_ICONS: Record<string, string> = {
            'Gasolina Comum': '⛽',
            'Etanol': '🌿',
            'Diesel S10': '🛢️',
          };
          const topPrices = TOP_FUELS.map(tipo => ({
            tipo,
            icon: TOP_ICONS[tipo],
            preco: group.prices.find(p => p.tipo === tipo)?.preco ?? null,
          })).filter(p => p.preco !== null);

          // Se nenhum dos top 3 disponível, mostra o mais barato disponível
          const fallback = group.prices.length > 0
            ? [group.prices.reduce((a, b) => a.preco < b.preco ? a : b)]
            : [];
          const displayPrices = topPrices.length > 0 ? topPrices : fallback;

          return (
            <Marker
              key={group.station.id}
              position={[group.station.latitude, group.station.longitude]}
              icon={createCustomIcon(isCheapest)}
            >
              <Tooltip direction="top" offset={[0, -44]} opacity={1} permanent={false}>
                <div style={{ fontWeight: '700', fontSize: '13px', marginBottom: '6px', color: '#f1f5f9' }}>
                  {group.station.nome}
                </div>
                {displayPrices.length > 0 ? (
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <tbody>
                      {displayPrices.map((p: any) => (
                        <tr key={p.tipo}>
                          <td style={{ fontSize: '11px', paddingRight: '10px', color: '#94a3b8', paddingBottom: '2px' }}>
                            {p.icon} {p.tipo.replace('Gasolina ', 'Gas. ')}
                          </td>
                          <td style={{ fontSize: '12px', fontWeight: '700', color: '#10b981', textAlign: 'right' }}>
                            R$ {p.preco.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ fontSize: '11px', color: '#64748b' }}>Sem preço cadastrado</div>
                )}
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
      
      <style jsx global>{`
        .map-tiles {
          filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%);
        }
      `}</style>
    </div>
  );
}
