import React, { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import {
  MapPin, Store, Navigation, ExternalLink, Compass, Truck, Copy,
} from 'lucide-react'
import { NEPAL_CITY_COORDINATES } from '../../utils/constants'
import { createOpenStreetMap, createRouteMarker } from '../../utils/leafletMap'
import { useToast } from '../../context/ToastContext'

function findApproximateCoords(address) {
  const search = (address || '').toLowerCase()
  const match = Object.entries(NEPAL_CITY_COORDINATES).find(([city]) => search.includes(city.toLowerCase()))
  return match ? { ...match[1], city: match[0] } : null
}

function isNepalCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 25 && lat <= 32 && lng >= 79 && lng <= 89.5
}

function normalizePoint(point, fallbackName, fallbackAddress) {
  const rawLat = typeof point === 'object' && point ? point.lat ?? point.latitude : null
  const rawLng = typeof point === 'object' && point ? point.lng ?? point.longitude : null
  const lat = rawLat === null || rawLat === '' ? NaN : Number(rawLat)
  const lng = rawLng === null || rawLng === '' ? NaN : Number(rawLng)
  const address = (typeof point === 'string' ? point : point?.address) || fallbackAddress
  const hasCoordinates = isNepalCoordinate(lat, lng)
  const approximate = !hasCoordinates ? findApproximateCoords(address) : null

  return {
    name: (typeof point === 'object' && point?.name) || fallbackName,
    address,
    phone: typeof point === 'object' ? point?.phone : null,
    ...(hasCoordinates
      ? { lat, lng, isApproximate: false }
      : approximate
        ? { lat: approximate.lat, lng: approximate.lng, isApproximate: true, approximateCity: approximate.city }
        : {}),
  }
}

export default function DeliveryRouteMap({
  pickup,
  dropoff,
  rider,
  tracking = [],
  status = 'assigned',
  height = 340,
  title = 'Map-Based Delivery Route',
  subtitle = 'Live visual delivery corridor and GPS navigation',
  showDirectionsBtn = true,
  className = '',
  style = {},
}) {
  const toast = useToast()
  const [isCopied, setIsCopied] = useState(false)
  const [routeGeometry, setRouteGeometry] = useState(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState('')
  const mapContainerRef = useRef(null)
  const leafletMapRef = useRef(null)
  const mapLayersRef = useRef(null)

  const pickupPoint = useMemo(
    () => normalizePoint(pickup, 'Merchant Store (Pickup)', 'Pickup address unavailable'),
    [pickup],
  )
  const dropoffPoint = useMemo(
    () => normalizePoint(dropoff, 'Customer Dropoff', 'Delivery address unavailable'),
    [dropoff],
  )

  const riderPoint = useMemo(() => {
    const directPoint = normalizePoint(rider, rider?.name || 'Assigned Courier Rider', '')
    if (directPoint.lat !== undefined) return directPoint

    const latestWithCoords = [...tracking].reverse().find((event) => (
      normalizePoint(event, '', '').lat !== undefined
    ))
    return latestWithCoords ? normalizePoint(latestWithCoords, rider?.name || 'Assigned Courier Rider', '') : null
  }, [rider, tracking])

  const routeCoordinatesComplete = pickupPoint.lat !== undefined
    && dropoffPoint.lat !== undefined
    && !pickupPoint.isApproximate
    && !dropoffPoint.isApproximate
  const routeEndpointsAvailable = [pickupPoint, dropoffPoint].every((point) => (
    (point.lat !== undefined && !point.isApproximate)
    || (point.address && !point.address.toLowerCase().includes('unavailable'))
  ))
  const routeEndpoint = (point) => point.lat !== undefined && !point.isApproximate
    ? `${point.lat},${point.lng}`
    : point.address
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(routeEndpoint(pickupPoint))}&destination=${encodeURIComponent(routeEndpoint(dropoffPoint))}&travelmode=driving`

  useEffect(() => {
    if (!mapContainerRef.current) return undefined

    const center = pickupPoint.lat !== undefined
      ? [pickupPoint.lat, pickupPoint.lng]
      : dropoffPoint.lat !== undefined
        ? [dropoffPoint.lat, dropoffPoint.lng]
        : [27.7172, 85.3240]
    const map = createOpenStreetMap(mapContainerRef.current, center, 13)
    const layers = L.layerGroup().addTo(map)
    leafletMapRef.current = map
    mapLayersRef.current = layers

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => map.invalidateSize())
    observer?.observe(mapContainerRef.current)

    return () => {
      observer?.disconnect()
      map.remove()
      leafletMapRef.current = null
      mapLayersRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!routeCoordinatesComplete) {
      setRouteGeometry(null)
      setRouteError('')
      setRouteLoading(false)
      return undefined
    }

    const controller = new AbortController()
    const url = `https://router.project-osrm.org/route/v1/driving/${pickupPoint.lng},${pickupPoint.lat};${dropoffPoint.lng},${dropoffPoint.lat}?overview=full&geometries=geojson&steps=false`
    setRouteGeometry(null)
    setRouteError('')
    setRouteLoading(true)

    const loadRoute = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw new Error(`Routing service returned ${response.status}.`)

        const result = await response.json()
        const coordinates = result.routes?.[0]?.geometry?.coordinates
        if (result.code !== 'Ok' || !Array.isArray(coordinates) || coordinates.length < 2) {
          throw new Error('No drivable route was found between these points.')
        }

        setRouteGeometry(coordinates)
      } catch (error) {
        if (error.name !== 'AbortError') {
          setRouteError(error.message || 'Road route could not be loaded.')
        }
      } finally {
        if (!controller.signal.aborted) setRouteLoading(false)
      }
    }

    loadRoute()
    return () => controller.abort()
  }, [routeCoordinatesComplete, pickupPoint.lat, pickupPoint.lng, dropoffPoint.lat, dropoffPoint.lng])

  useEffect(() => {
    const map = leafletMapRef.current
    const layers = mapLayersRef.current
    if (!map || !layers) return

    layers.clearLayers()
    const bounds = L.latLngBounds([])
    const stops = [
      { point: pickupPoint, label: pickupPoint.isApproximate ? 'A~' : 'A', color: pickupPoint.isApproximate ? '#818cf8' : '#4338ca' },
      { point: dropoffPoint, label: dropoffPoint.isApproximate ? 'B~' : 'B', color: dropoffPoint.isApproximate ? '#34d399' : '#059669' },
    ].filter(({ point }) => point.lat !== undefined)

    stops.forEach(({ point, label, color }) => {
      const position = [point.lat, point.lng]
      L.marker(position, { icon: createRouteMarker(label, color), keyboard: false }).addTo(layers)
      bounds.extend(position)
    })

    if (routeGeometry) {
      const route = L.polyline(routeGeometry.map(([lng, lat]) => [lat, lng]), {
        color: '#f97316',
        weight: 5,
        opacity: 0.9,
      }).addTo(layers)
      bounds.extend(route.getBounds())
    }

    if (bounds.isValid()) {
      const visibleBounds = bounds.pad(0.15)
      if (riderPoint?.lat !== undefined && visibleBounds.contains([riderPoint.lat, riderPoint.lng])) {
        L.marker([riderPoint.lat, riderPoint.lng], {
          icon: createRouteMarker('R', '#ea580c'),
          keyboard: false,
        }).addTo(layers)
      }
      map.fitBounds(visibleBounds, { padding: [28, 28], maxZoom: routeGeometry ? 16 : 14 })
    }
  }, [pickupPoint, dropoffPoint, riderPoint, routeGeometry])

  const copyCoordinates = () => {
    if (!routeCoordinatesComplete) return
    const text = `Pickup: ${pickupPoint.lat}, ${pickupPoint.lng} | Delivery: ${dropoffPoint.lat}, ${dropoffPoint.lng}`
    navigator.clipboard.writeText(text)
    setIsCopied(true)
    toast.success('Route GPS coordinates copied!')
    setTimeout(() => setIsCopied(false), 2000)
  }

  const routeStatus = routeLoading
    ? 'Calculating road route…'
    : routeError
      ? `Road route unavailable: ${routeError}`
      : routeCoordinatesComplete
        ? 'Road route shown'
        : 'Exact GPS points are needed for road routing; approximate pins are not routed.'

  return (
    <div
      className={`card card-pad-none ${className}`}
      style={{
        overflow: 'hidden',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 20px -4px rgba(15,23,42,0.08)',
        borderRadius: 14,
        background: 'var(--surface)',
        ...style,
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          background: 'linear-gradient(180deg, #fafafa 0%, #ffffff 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'rgba(255, 85, 0, 0.12)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Compass size={18} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{title}</div>
            <div style={{ fontSize: 11.5, color: '#64748b' }}>{subtitle}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={copyCoordinates}
            disabled={!routeCoordinatesComplete}
            title="Copy Coordinates"
            style={{ fontSize: 11, padding: '4px 8px' }}
          >
            <Copy size={12} /> {isCopied ? 'Copied' : 'GPS Coords'}
          </button>

          {showDirectionsBtn && routeEndpointsAvailable && (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-xs"
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 10px',
              }}
            >
              <Navigation size={12} /> Open in Google Maps <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', height, background: '#e2e8f0' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 52,
            right: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            pointerEvents: 'none',
            flexWrap: 'wrap',
            gap: 8,
            zIndex: 500,
          }}
        >
          <div style={{ pointerEvents: 'auto', background: 'rgba(255,255,255,.94)', border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 10px', boxShadow: '0 4px 12px rgba(0,0,0,.12)', maxWidth: 320, fontSize: 11.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 800, color: '#4338ca' }}>
              <Store size={12} /> Pickup: {pickupPoint.name}
            </div>
            <div style={{ color: '#475569', fontSize: 10.5, marginTop: 1, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
              {pickupPoint.address}
            </div>
          </div>

          <div style={{ pointerEvents: 'auto', background: 'rgba(255,255,255,.94)', border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 10px', boxShadow: '0 4px 12px rgba(0,0,0,.12)', maxWidth: 320, fontSize: 11.5, textAlign: 'right' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, fontWeight: 800, color: '#059669' }}>
              <MapPin size={12} /> Dropoff: {dropoffPoint.name}
            </div>
            <div style={{ color: '#475569', fontSize: 10.5, marginTop: 1, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
              {dropoffPoint.address}
            </div>
          </div>
        </div>

        <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 500, maxWidth: 'calc(100% - 20px)', padding: '5px 9px', borderRadius: 6, background: 'rgba(255,255,255,.95)', color: routeError ? '#b91c1c' : '#334155', fontSize: 10.5 }}>
          {routeStatus}
        </div>

        {(status === 'out_for_delivery' || status === 'picked_up') && (
          <div
            style={{
              position: 'absolute',
              bottom: 10,
              right: 10,
              zIndex: 500,
              background: 'rgba(15, 23, 42, 0.9)',
              color: '#fff',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 11.5,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            }}
          >
            <Truck size={13} color="#10b981" />
            <span>Rider In Transit</span>
          </div>
        )}
      </div>

      <div
        style={{
          padding: '12px 18px',
          background: '#f8fafc',
          borderTop: '1px solid var(--border)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          fontSize: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#e0e7ff', color: '#4338ca', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>1</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: 'var(--ink)' }}>Store Pickup</div>
            <div style={{ color: '#64748b', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pickupPoint.address}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: routeGeometry ? '#ffedd5' : '#f1f5f9', color: '#ea580c', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Navigation size={12} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: 'var(--ink)' }}>Road Route</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>
              {routeLoading ? 'Calculating…' : routeGeometry ? 'Driving route' : routeCoordinatesComplete ? 'Route unavailable' : 'Waiting for exact GPS'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#d1fae5', color: '#059669', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>3</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: 'var(--ink)' }}>Customer Dropoff</div>
            <div style={{ color: '#64748b', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dropoffPoint.address}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
