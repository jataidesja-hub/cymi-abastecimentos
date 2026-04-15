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
          const isCheapest = idx === 0; // Assuming stations are sorted by price
          const lowestPrice = Math.min(...group.prices.map(p => p.preco));
          
          return (
            <Marker 
              key={group.station.id} 
              position={[group.station.latitude, group.station.longitude]}
              icon={createCustomIcon(isCheapest)}
            >
              <Tooltip direction="top" offset={[0, -40]} opacity={1} permanent={false}>
                <div style={{ fontWeight: 'bold' }}>{group.station.nome}</div>
                <div style={{ color: 'var(--accent-green)', fontSize: '12px' }}>
                  A partir de R$ ${lowestPrice.toFixed(3)}
                </div>
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
