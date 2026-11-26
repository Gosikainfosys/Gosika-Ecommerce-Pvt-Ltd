import React, { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { Link } from 'react-router-dom'
import { AlertTriangle, Layers, MapPin, RefreshCw, ShieldCheck } from 'lucide-react'
import api from '../../api/client'
import PageHeader from '../../components/admin/PageHeader'
import { Skeleton } from '../../components/ui/Skeleton'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import { errorMessage } from '../../utils/format'
import { addGeoJsonLayer, createOpenStreetMap } from '../../utils/leafletMap'

const NEPAL_CENTER = [28.3949, 84.124]

function SelectField({ label, value, onChange, options, disabled, placeholder }) {
  return (
    <label className="flex flex-col gap-2" style={{ minWidth: 0 }}>
      <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>{label}</span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">{placeholder}</option>
        {(options || []).map((option) => (
          <option key={option.id} value={option.id}>{option.name}</option>
        ))}
      </select>
    </label>
  )
}

export default function AdminCoverage() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const areasLayerRef = useRef(null)

  const [provinces, setProvinces] = useState([])
  const [districts, setDistricts] = useState([])
  const [municipalities, setMunicipalities] = useState([])
  const [geoError, setGeoError] = useState('')

  const [provinceId, setProvinceId] = useState('')
  const [districtId, setDistrictId] = useState('')
  const [municipalityId, setMunicipalityId] = useState('')

  const [areas, setAreas] = useState([])
  const [showAreas, setShowAreas] = useState(true)

  const [geometryMode, setGeometryMode] = useState('display')
  const [boundary, setBoundary] = useState(null)
  const [boundaryLoading, setBoundaryLoading] = useState(false)
  const [boundaryError, setBoundaryError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    const loadProvinces = async () => {
      try {
        const res = await api.get('/platform/provinces', { skipCache: true })
        if (!cancelled) setProvinces(api.unwrapList(res.data))
      } catch (err) {
        if (!cancelled) setGeoError(errorMessage(err, 'Unable to load provinces.'))
      }
    }

    loadProvinces()

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false

    api.get('/admin/delivery-coverage/areas', { skipCache: true })
      .then((res) => { if (!cancelled) setAreas(res.data?.data || []) })
      .catch(() => { if (!cancelled) setAreas([]) })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!provinceId) {
      setDistricts([])
      return undefined
    }

    let cancelled = false

    const loadDistricts = async () => {
      try {
        const res = await api.get('/platform/districts', {
          params: { province_id: provinceId },
          skipCache: true,
        })
        if (!cancelled) setDistricts(api.unwrapList(res.data))
      } catch (err) {
        if (!cancelled) setGeoError(errorMessage(err, 'Unable to load districts.'))
      }
    }

    loadDistricts()

    return () => { cancelled = true }
  }, [provinceId])

  useEffect(() => {
    if (!districtId) {
      setMunicipalities([])
      return undefined
    }

    let cancelled = false

    const loadMunicipalities = async () => {
      try {
        const res = await api.get('/platform/municipalities', {
          params: { district_id: districtId },
          skipCache: true,
        })
        if (!cancelled) setMunicipalities(api.unwrapList(res.data))
      } catch (err) {
        if (!cancelled) setGeoError(errorMessage(err, 'Unable to load municipalities.'))
      }
    }

    loadMunicipalities()

    return () => { cancelled = true }
  }, [districtId])

  const target = useMemo(() => {
    if (municipalityId) return { type: 'municipality', uuid: municipalityId }
    if (districtId) return { type: 'district', uuid: districtId }
    if (provinceId) return { type: 'province', uuid: provinceId }
    return null
  }, [municipalityId, districtId, provinceId])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return undefined

    mapRef.current = createOpenStreetMap(mapContainerRef.current, NEPAL_CENTER, 7)
    mapRef.current.invalidateSize()

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        layerRef.current = null
        areasLayerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    if (!boundary?.geometry) return

    const layer = addGeoJsonLayer(map, boundary.geometry)
    layerRef.current = layer
    map.invalidateSize()
    map.fitBounds(layer.getBounds(), { padding: [32, 32], maxZoom: 14 })
  }, [boundary])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (areasLayerRef.current) {
      map.removeLayer(areasLayerRef.current)
      areasLayerRef.current = null
    }

    if (!showAreas || !areas.length) return

    const group = L.layerGroup()
    areas.forEach((area) => {
      if (!area.geometry) return
      const live = area.verification_status === 'verified' && area.is_active
      const color = area.is_coverage_area ? '#059669' : '#7c3aed'
      const layer = L.geoJSON(area.geometry, {
        style: {
          color,
          weight: live ? 2 : 1,
          fillColor: color,
          fillOpacity: live ? 0.18 : 0.06,
          dashArray: live ? undefined : '4 4',
        },
      })
      const popup = L.DomUtil.create('div')
      const title = L.DomUtil.create('strong', '', popup)
      title.textContent = area.name
      L.DomUtil.create('br', '', popup)
      const label = L.DomUtil.create('div', '', popup)
      label.textContent = area.label || area.parent_label || ''
      const detail = L.DomUtil.create('div', '', popup)
      detail.textContent = `${area.is_coverage_area ? 'Delivery coverage area' : 'Exceptional custom polygon'} · ${area.verification_status}`
      layer.bindPopup(popup)
      group.addLayer(layer)
    })
    group.addTo(map)
    areasLayerRef.current = group
  }, [areas, showAreas])

  useEffect(() => {
    if (!target) {
      setBoundary(null)
      setBoundaryError('')
      setBoundaryLoading(false)
      return undefined
    }

    let cancelled = false

    const loadBoundary = async () => {
      setBoundaryLoading(true)
      setBoundaryError('')

      try {
        const res = await api.get(`/admin/geo/boundaries/${target.type}/${target.uuid}`, {
          params: { display: geometryMode === 'display' ? 1 : 0 },
          skipCache: true,
        })
        if (!cancelled) setBoundary(res.data?.data ?? null)
      } catch (err) {
        if (!cancelled) {
          setBoundary(null)
          setBoundaryError(errorMessage(err, 'Unable to load the verified boundary.'))
        }
      } finally {
        if (!cancelled) setBoundaryLoading(false)
      }
    }

    loadBoundary()

    return () => { cancelled = true }
  }, [target?.type, target?.uuid, geometryMode, reloadToken])

  const handleProvinceChange = (value) => {
    setProvinceId(value)
    setDistrictId('')
    setMunicipalityId('')
    setDistricts([])
    setMunicipalities([])
    setBoundary(null)
    setBoundaryError('')
  }

  const handleDistrictChange = (value) => {
    setDistrictId(value)
    setMunicipalityId('')
    setMunicipalities([])
    setBoundary(null)
    setBoundaryError('')
  }

  const handleMunicipalityChange = (value) => {
    setMunicipalityId(value)
    setBoundary(null)
    setBoundaryError('')
  }

  const retryBoundary = () => setReloadToken((value) => value + 1)

  const bboxLabel = boundary?.bbox
    ? `${Number(boundary.bbox.min_lng).toFixed(4)}, ${Number(boundary.bbox.min_lat).toFixed(4)} → ${Number(boundary.bbox.max_lng).toFixed(4)}, ${Number(boundary.bbox.max_lat).toFixed(4)}`
    : '—'

  return (
    <div className="w-full flex flex-col gap-4 pb-8">
      <PageHeader
        title="Delivery Coverage Map"
        description="Inspect verified administrative boundaries and every created coverage area. All created areas and custom polygons are overlaid openly on the map."
        breadcrumbs={[
          { label: 'Fulfillment', to: '/admin/fulfillment/zones' },
          { label: 'Coverage' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link className="btn btn-outline btn-sm" to="/admin/fulfillment/zones">
              <MapPin size={14} /> Manage coverage areas
            </Link>
            <button
              type="button"
              className={`btn btn-sm ${geometryMode === 'display' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setGeometryMode('display')}
            >
              Map detail
            </button>
            <button
              type="button"
              className={`btn btn-sm ${geometryMode === 'full' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setGeometryMode('full')}
            >
              Full precision
            </button>
          </div>
        }
      />

      <div className="card" style={{ padding: 18, margin: 0 }}>
        {geoError ? (
          <ErrorState message={geoError} onRetry={() => window.location.reload()} />
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <SelectField
              label="Province"
              value={provinceId}
              onChange={handleProvinceChange}
              options={provinces}
              placeholder="Select province"
            />
            <SelectField
              label="District"
              value={districtId}
              onChange={handleDistrictChange}
              options={districts}
              disabled={!provinceId}
              placeholder="Select district"
            />
            <SelectField
              label="Municipality"
              value={municipalityId}
              onChange={handleMunicipalityChange}
              options={municipalities}
              disabled={!districtId}
              placeholder="Select municipality"
            />
            <label className="flex flex-col gap-2" style={{ minWidth: 0 }}>
              <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Ward</span>
              <select className="input" disabled value="">
                <option value="">No verified ward dataset</option>
              </select>
              <span className="muted text-xs">Drawn ward areas appear as map overlays.</span>
            </label>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 14, margin: 0 }}>
        <div className="flex items-center justify-between wrap gap-3">
          <label className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--ink)' }}>
            <input
              type="checkbox"
              checked={showAreas}
              onChange={(event) => setShowAreas(event.target.checked)}
            />
            Show all created coverage areas on the map
          </label>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="muted text-xs">
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#059669', marginRight: 6 }} />
              Coverage areas ({areas.filter((area) => area.is_coverage_area).length})
            </span>
            <span className="muted text-xs">
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#7c3aed', marginRight: 6 }} />
              Custom polygons ({areas.filter((area) => !area.is_coverage_area).length})
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' }}>
        <div className="card card-pad-none" style={{ margin: 0, overflow: 'hidden' }}>
          <div style={{ position: 'relative', height: 520 }}>
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

            {!target && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(255,255,255,0.72)',
                zIndex: 500,
              }}>
                <EmptyState
                  icon={MapPin}
                  title="Select an administrative unit"
                  message="Choose a province, district, or municipality to render its verified boundary."
                />
              </div>
            )}

            {boundaryLoading && (
              <div style={{
                position: 'absolute',
                top: 14,
                right: 14,
                zIndex: 500,
                background: '#fff',
                borderRadius: 12,
                padding: '10px 14px',
                boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <RefreshCw size={15} className="animate-spin" />
                <span className="text-sm font-semibold">Loading boundary…</span>
              </div>
            )}

            {boundaryError && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(255,255,255,0.82)',
                zIndex: 500,
              }}>
                <ErrorState message={boundaryError} onRetry={retryBoundary} />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="card" style={{ padding: 18, margin: 0 }}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0 }}>Boundary verification</h3>
              {boundary?.is_verified ? (
                <span className="chip chip-sm" style={{ background: 'rgba(16,185,129,0.12)', color: '#047857' }}>
                  <ShieldCheck size={13} /> Verified
                </span>
              ) : (
                <span className="chip chip-sm" style={{ background: 'rgba(148,163,184,0.12)', color: '#475569' }}>
                  <Layers size={13} /> No boundary
                </span>
              )}
            </div>

            {!boundary ? (
              <Skeleton height={180} />
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="muted text-xs font-bold uppercase">Selected unit</div>
                  <div style={{ fontWeight: 800 }}>{boundary.name}</div>
                </div>
                <div>
                  <div className="muted text-xs font-bold uppercase">Source</div>
                  <div className="text-sm">{boundary.source || '—'}</div>
                  {boundary.source_url && (
                    <a className="text-xs" href={boundary.source_url} target="_blank" rel="noreferrer">
                      View source
                    </a>
                  )}
                </div>
                <div>
                  <div className="muted text-xs font-bold uppercase">Dataset / license</div>
                  <div className="text-sm">{boundary.dataset_version}</div>
                  <div className="muted text-xs">{boundary.license || '—'}</div>
                </div>
                <div>
                  <div className="muted text-xs font-bold uppercase">Rendered geometry</div>
                  <div className="text-sm">
                    {boundary.geometry_mode === 'display' ? 'Simplified display geometry from the verified dataset' : 'Full-resolution verified geometry'}
                  </div>
                </div>
                <div>
                  <div className="muted text-xs font-bold uppercase">Bounding box</div>
                  <div className="text-xs" style={{ wordBreak: 'break-word' }}>{bboxLabel}</div>
                </div>
              </div>
            )}
          </div>

          {boundary?.validation_errors?.length > 0 && (
            <div className="card" style={{ padding: 18, margin: 0, borderColor: 'rgba(245,158,11,0.45)' }}>
              <div className="flex items-center gap-2 mb-2" style={{ color: '#b45309' }}>
                <AlertTriangle size={15} />
                <strong style={{ fontSize: 13 }}>Source notes</strong>
              </div>
              <ul className="muted text-xs mb-0" style={{ paddingLeft: 18 }}>
                {boundary.validation_errors.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
