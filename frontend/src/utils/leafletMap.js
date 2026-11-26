import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export function createOpenStreetMap(container, center, zoom = 12) {
  const map = L.map(container, {
    scrollWheelZoom: false,
  }).setView(center, zoom)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map)

  return map
}

export function addGeoJsonLayer(map, geometry, options = {}) {
  const { style, ...rest } = options

  return L.geoJSON(geometry, {
    style: {
      color: '#ff5500',
      weight: 2,
      fillColor: '#ff5500',
      fillOpacity: 0.16,
      ...(style || {}),
    },
    ...rest,
  }).addTo(map)
}

export function createRouteMarker(label, color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);color:#fff;font-size:12px;font-weight:800">${label}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}
