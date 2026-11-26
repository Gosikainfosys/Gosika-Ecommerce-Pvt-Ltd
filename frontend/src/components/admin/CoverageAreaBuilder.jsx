import React, { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { CheckCircle2, Layers, MapPin, Plus, Trash2 } from 'lucide-react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { errorMessage } from '../../utils/format'
import { useList } from '../../hooks/useApi'
import EmptyState from '../ui/EmptyState'
import ErrorState from '../ui/ErrorState'
import { addGeoJsonLayer, createOpenStreetMap } from '../../utils/leafletMap'

const NEPAL_CENTER = [28.3949, 84.124]

const EMPTY_FORM = {
  name: '',
  description: '',
  reason: '',
  province_id: '',
  district_id: '',
  municipality_id: '',
  ward_id: '',
  ward_number: '',
  geometry: null,
  is_active: true,
}

function geometryFromPoints(points) {
  if (points.length < 3) return null
  const ring = points.map(([lat, lng]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))])
  ring.push([...ring[0]])

  return { type: 'Polygon', coordinates: [ring] }
}

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

export default function CoverageAreaBuilder() {
  const toast = useToast()
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const previewLayerRef = useRef(null)
  const drawingLayerRef = useRef(null)

  const [provinces, setProvinces] = useState([])
  const [districts, setDistricts] = useState([])
  const [municipalities, setMunicipalities] = useState([])
  const [wards, setWards] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [points, setPoints] = useState([])
  const [drawing, setDrawing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [geoError, setGeoError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const { items: areas, loading, error, reload } = useList(
    () => api.get('/admin/delivery-coverage/areas'),
    { deps: [refreshKey] }
  )

  const isWardArea = Boolean(form.ward_id || form.ward_number)

  useEffect(() => {
    let cancelled = false
    api.get('/platform/provinces', { skipCache: true })
      .then((res) => { if (!cancelled) setProvinces(api.unwrapList(res.data)) })
      .catch((err) => { if (!cancelled) setGeoError(errorMessage(err, 'Unable to load provinces.')) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!form.province_id) {
      setDistricts([])
      return undefined
    }
    let cancelled = false
    api.get('/platform/districts', { params: { province_id: form.province_id }, skipCache: true })
      .then((res) => { if (!cancelled) setDistricts(api.unwrapList(res.data)) })
      .catch(() => { if (!cancelled) setDistricts([]) })
    return () => { cancelled = true }
  }, [form.province_id])

  useEffect(() => {
    if (!form.district_id) {
      setMunicipalities([])
      return undefined
    }
    let cancelled = false
    api.get('/platform/municipalities', { params: { district_id: form.district_id }, skipCache: true })
      .then((res) => { if (!cancelled) setMunicipalities(api.unwrapList(res.data)) })
      .catch(() => { if (!cancelled) setMunicipalities([]) })
    return () => { cancelled = true }
  }, [form.district_id])

  useEffect(() => {
    if (!form.municipality_id) {
      setWards([])
      return undefined
    }
    let cancelled = false
    api.get('/platform/wards', { params: { municipality_id: form.municipality_id }, skipCache: true })
      .then((res) => { if (!cancelled) setWards(api.unwrapList(res.data)) })
      .catch(() => { if (!cancelled) setWards([]) })
    return () => { cancelled = true }
  }, [form.municipality_id])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return undefined
    mapRef.current = createOpenStreetMap(mapContainerRef.current, NEPAL_CENTER, 7)
    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        previewLayerRef.current = null
        drawingLayerRef.current = null
      }
    }
  }, [])

  const previewTarget = useMemo(() => {
    if (!form.province_id) return null
    if (form.municipality_id) {
      return { type: 'municipality', id: form.municipality_id, context: isWardArea }
    }
    if (form.district_id) return { type: 'district', id: form.district_id, context: false }
    return { type: 'province', id: form.province_id, context: false }
  }, [form.province_id, form.district_id, form.municipality_id, isWardArea])

  useEffect(() => {
    if (!previewTarget) {
      setPreview(null)
      return undefined
    }

    let cancelled = false
    setGeoError('')
    api.get(`/admin/geo/boundaries/${previewTarget.type}/${previewTarget.id}`, {
      params: { display: 1 },
      skipCache: true,
    })
      .then((res) => {
        if (cancelled) return
        const data = res.data?.data
        setPreview({
          geometry: data?.geometry || null,
          name: data?.name || '',
          context: previewTarget.context,
        })
      })
      .catch((err) => {
        if (cancelled) return
        setPreview(null)
        setGeoError(errorMessage(err, 'Unable to load the verified boundary.'))
      })

    return () => { cancelled = true }
  }, [previewTarget?.type, previewTarget?.id, previewTarget?.context])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (previewLayerRef.current) {
      map.removeLayer(previewLayerRef.current)
      previewLayerRef.current = null
    }

    if (!preview?.geometry) return

    const style = preview.context
      ? { color: '#64748b', fillColor: '#94a3b8', fillOpacity: 0.08, dashArray: '4 4', interactive: false }
      : { color: '#10b981', fillColor: '#10b981', fillOpacity: 0.18, interactive: false }

    const layer = addGeoJsonLayer(map, preview.geometry, { style })
    previewLayerRef.current = layer
    map.invalidateSize()
    map.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: 14 })
  }, [preview])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !drawing) return undefined

    const onClick = (event) => {
      const next = [...points, [event.latlng.lat, event.latlng.lng]]
      setPoints(next)
      setForm((current) => ({ ...current, geometry: geometryFromPoints(next) }))
    }

    map.on('click', onClick)
    return () => map.off('click', onClick)
  }, [drawing, points])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (drawingLayerRef.current) {
      map.removeLayer(drawingLayerRef.current)
      drawingLayerRef.current = null
    }

    if (!drawing || points.length === 0) return

    const group = L.layerGroup()
    if (points.length > 1) {
      group.addLayer(L.polyline(points, { color: '#0ea5e9', weight: 2, dashArray: '5 5' }))
    }
    points.forEach((point) => {
      group.addLayer(L.circleMarker(point, { radius: 4, color: '#0ea5e9', fillOpacity: 1 }))
    })
    if (points.length >= 3) {
      group.addLayer(L.polygon([...points, points[0]], {
        color: '#ff5500',
        weight: 2,
        fillColor: '#ff5500',
        fillOpacity: 0.16,
      }))
    }
    group.addTo(map)
    drawingLayerRef.current = group
  }, [drawing, points])

  const updateForm = (key, value) => {
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === 'province_id') {
        next.district_id = ''
        next.municipality_id = ''
        next.ward_id = ''
        next.ward_number = ''
      }
      if (key === 'district_id') {
        next.municipality_id = ''
        next.ward_id = ''
        next.ward_number = ''
      }
      if (key === 'municipality_id') {
        next.ward_id = ''
        next.ward_number = ''
      }
      if (key === 'ward_id' && value) {
        next.ward_number = ''
      }
      if (key === 'ward_number' && value) {
        next.ward_id = ''
      }
      if (['ward_id', 'ward_number'].includes(key)) {
        next.geometry = null
      }
      return next
    })

    if (['province_id', 'district_id', 'municipality_id', 'ward_id', 'ward_number'].includes(key)) {
      setPoints([])
      setDrawing(false)
    }
  }

  const startDrawing = () => {
    setPoints([])
    setForm((current) => ({ ...current, geometry: null }))
    setDrawing(true)
    toast.info('Click the map to add ward vertices, then finish the shape.')
  }

  const finishDrawing = () => {
    if (points.length < 3) {
      toast.error('Click at least three points to close the ward polygon.')
      return
    }
    setDrawing(false)
    setForm((current) => ({ ...current, geometry: geometryFromPoints(points) }))
  }

  const saveArea = async (event) => {
    event.preventDefault()

    if (!form.name.trim()) {
      toast.error('Enter a name for this coverage area.')
      return
    }
    if (isWardArea && !form.geometry) {
      toast.error('Draw the ward coverage polygon before saving.')
      return
    }

    setBusy(true)
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      reason: form.reason.trim() || null,
      province_id: Number(form.province_id),
      district_id: form.district_id ? Number(form.district_id) : null,
      municipality_id: form.municipality_id ? Number(form.municipality_id) : null,
      is_active: Boolean(form.is_active),
    }

    if (isWardArea) {
      if (form.ward_id) payload.ward_id = Number(form.ward_id)
      else payload.ward_number = Number(form.ward_number)
      payload.geometry = form.geometry
    }

    try {
      await api.post('/admin/delivery-coverage/areas', payload)
      toast.success(`Coverage area "${payload.name}" created and activated`)
      setForm(EMPTY_FORM)
      setPoints([])
      setDrawing(false)
      setPreview(null)
      setRefreshKey((value) => value + 1)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const deleteArea = (area) => {
    const endpoint = area.is_coverage_area
      ? `/admin/delivery-coverage/areas/${area.uuid}`
      : `/admin/delivery-coverage/custom-polygons/${area.uuid}`

    if (!window.confirm(`Remove coverage area "${area.name}"? Delivery will no longer be allowed inside it.`)) return

    api.delete(endpoint)
      .then(() => {
        toast.success(`Coverage area "${area.name}" removed`)
        setRefreshKey((value) => value + 1)
      })
      .catch((err) => toast.error(errorMessage(err)))
  }

  const verifyArea = (area) => {
    api.post(`/admin/delivery-coverage/custom-polygons/${area.uuid}/verify`)
      .then(() => {
        toast.success(`Custom polygon "${area.name}" verified`)
        setRefreshKey((value) => value + 1)
      })
      .catch((err) => toast.error(errorMessage(err)))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card" style={{ padding: 18, margin: 0 }}>
        <div className="flex items-center justify-between wrap gap-3 mb-3">
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink)' }}>
              <Layers size={15} color="var(--primary)" /> Hierarchical Delivery Coverage Areas
            </h3>
            <p className="muted text-xs mt-1 mb-0">
              Create the areas where delivery is allowed. Only these created areas are serviceable; every other location is denied automatically.
            </p>
          </div>
          <span className="chip chip-sm" style={{ background: 'rgba(16,185,129,0.12)', color: '#047857', fontWeight: 800 }}>
            Allow-list mode
          </span>
        </div>

        <form onSubmit={saveArea} className="flex flex-col gap-3">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <SelectField
              label="Province"
              value={form.province_id}
              onChange={(value) => updateForm('province_id', value)}
              options={provinces}
              placeholder="Select province"
            />
            <SelectField
              label="District"
              value={form.district_id}
              onChange={(value) => updateForm('district_id', value)}
              options={districts}
              disabled={!form.province_id}
              placeholder="Whole district"
            />
            <SelectField
              label="Municipality"
              value={form.municipality_id}
              onChange={(value) => updateForm('municipality_id', value)}
              options={municipalities}
              disabled={!form.district_id}
              placeholder="Whole municipality"
            />
            <label className="flex flex-col gap-2" style={{ minWidth: 0 }}>
              <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Ward (optional)</span>
              <select
                className="input"
                value={form.ward_id}
                onChange={(event) => updateForm('ward_id', event.target.value)}
                disabled={!form.municipality_id}
              >
                <option value="">Whole municipality</option>
                {wards.map((ward) => (
                  <option key={ward.id} value={ward.id}>Ward {ward.ward_number}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label className="flex flex-col gap-2" style={{ minWidth: 0 }}>
              <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Or enter ward number</span>
              <input
                className="input"
                type="number"
                min={1}
                max={99}
                list="coverage-area-ward-options"
                value={form.ward_number}
                onChange={(event) => updateForm('ward_number', event.target.value)}
                disabled={!form.municipality_id || Boolean(form.ward_id)}
                placeholder="e.g. 4"
              />
              <datalist id="coverage-area-ward-options">
                {wards.map((ward) => (
                  <option key={ward.id} value={ward.ward_number}>Ward {ward.ward_number}</option>
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-2" style={{ minWidth: 0 }}>
              <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Coverage area name</span>
              <input
                className="input"
                required
                value={form.name}
                onChange={(event) => updateForm('name', event.target.value)}
                placeholder="e.g. Ward 4 — Kathmandu"
              />
            </label>
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label className="flex flex-col gap-2" style={{ minWidth: 0 }}>
              <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Description (optional)</span>
              <input
                className="input"
                value={form.description}
                onChange={(event) => updateForm('description', event.target.value)}
                placeholder="Operational note for this area"
              />
            </label>
            <label className="flex flex-col gap-2" style={{ minWidth: 0 }}>
              <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>
                Reason {isWardArea ? <span className="req">*</span> : null}
              </span>
              <input
                className="input"
                value={form.reason}
                onChange={(event) => updateForm('reason', event.target.value)}
                placeholder={isWardArea ? 'Why this ward boundary was drawn' : 'Optional note'}
              />
            </label>
          </div>

          <div style={{ position: 'relative', height: 360, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
            <div style={{ position: 'absolute', left: 12, top: 12, zIndex: 500, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <span className="chip chip-sm" style={{ background: '#fff', color: 'var(--ink)', fontWeight: 800 }}>
                {preview?.context ? `Municipality context: ${preview.name}` : preview?.name || 'Select an administrative unit'}
              </span>
              {isWardArea && (
                <span className="chip chip-sm" style={{ background: drawing ? '#fff7ed' : '#eff6ff', color: drawing ? '#9a3412' : '#1d4ed8', fontWeight: 800 }}>
                  {drawing ? `Drawing ward area — ${points.length} point${points.length === 1 ? '' : 's'}` : form.geometry ? 'Ward polygon ready' : 'Draw the ward polygon'}
                </span>
              )}
            </div>
            {geoError && (
              <div style={{ position: 'absolute', right: 12, top: 12, zIndex: 500, maxWidth: 260 }}>
                <ErrorState message={geoError} />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between wrap gap-3">
            <div className="flex items-center gap-2">
              {isWardArea && (
                <>
                  <button type="button" className="btn btn-outline btn-sm" onClick={startDrawing} disabled={!form.municipality_id}>
                    <MapPin size={14} /> {form.geometry ? 'Redraw ward area' : 'Start drawing'}
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={finishDrawing} disabled={!drawing}>
                    <CheckCircle2 size={14} /> Finish drawing
                  </button>
                </>
              )}
              {!isWardArea && (
                <span className="muted text-xs">
                  The verified administrative boundary above is used automatically — no drawing needed.
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
                />
                Active
              </label>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !form.province_id}>
                <Plus size={14} /> {busy ? 'Saving…' : 'Create coverage area'}
              </button>
            </div>
          </div>
        </form>
      </div>

      <div className="card card-pad-none" style={{ overflow: 'hidden', margin: 0 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0 }}>Created coverage areas</h3>
          <p className="muted text-xs mt-1 mb-0">These polygons are overlaid openly on the Delivery Coverage map.</p>
        </div>
        {loading ? (
          <div style={{ padding: 14 }}><span className="muted text-xs">Loading coverage areas…</span></div>
        ) : error ? (
          <ErrorState onRetry={reload} />
        ) : !areas.length ? (
          <EmptyState icon={Layers} title="No coverage areas yet" message="Create an area above. Until then, delivery is denied everywhere by default." />
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Area</th>
                  <th>Hierarchy</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {areas.map((area) => (
                  <tr key={area.uuid}>
                    <td>
                      <span className="font-bold text-ink text-sm">{area.name}</span>
                      {area.description ? <div className="muted text-xs">{area.description}</div> : null}
                    </td>
                    <td className="muted text-xs">{area.label || area.parent_label || '—'}</td>
                    <td className="muted text-xs">{area.is_coverage_area ? 'Coverage area' : 'Custom polygon'}</td>
                    <td>
                      <span
                        className="chip chip-sm"
                        style={{
                          background: area.verification_status === 'verified' && area.is_active
                            ? 'rgba(16,185,129,0.12)'
                            : 'rgba(245,158,11,0.12)',
                          color: area.verification_status === 'verified' && area.is_active ? '#047857' : '#b45309',
                          fontWeight: 800,
                        }}
                      >
                        {area.verification_status === 'verified' && area.is_active ? 'Live' : area.verification_status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        {area.verification_status !== 'verified' && (
                          <button type="button" className="btn btn-outline btn-xs" onClick={() => verifyArea(area)}>
                            Verify
                          </button>
                        )}
                        <button type="button" className="btn btn-danger-outline btn-xs" onClick={() => deleteArea(area)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
