import React, { useEffect, useMemo, useState } from 'react'
import {
  MapPin, Truck, Plus, Edit, Trash2, Power, Layers
} from 'lucide-react'
import api from '../../api/client'
import Modal from '../../components/ui/Modal'
import { Skeleton } from '../../components/ui/Skeleton'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import Pagination from '../../components/ui/Pagination'
import { money, errorMessage } from '../../utils/format'
import { useToast } from '../../context/ToastContext'
import { useList } from '../../hooks/useApi'
import PageHeader from '../../components/admin/PageHeader'
import CoverageAreaBuilder from '../../components/admin/CoverageAreaBuilder'

const EMPTY_ZONE = { name: '', provinces: [], standard_charge: 150, express_charge: 250, estimated_days: 2 }
const EMPTY_ZONE_HIERARCHY = { province: '', district: '', municipality: '', ward: '' }
const EMPTY_COURIER = { name: '', type: 'Primary Fast Delivery Partner', coverage: '', contact_phone: '', endpoint: '' }

function coverageAreaLabel(area) {
  return area?.label || area?.parent_label || area?.name || 'Unnamed coverage area'
}

function coverageWardKey(area) {
  if (area?.ward_id) return String(area.ward_id)
  if (area?.ward_number) return `n:${area.ward_number}`
  return ''
}

export default function AdminShipping() {
  const toast = useToast()
  const [zoneModal, setZoneModal] = useState(null)
  const [courierModal, setCourierModal] = useState(null)
  const [zoneForm, setZoneForm] = useState(EMPTY_ZONE)
  const [zoneHierarchy, setZoneHierarchy] = useState(EMPTY_ZONE_HIERARCHY)
  const [zoneGeoOptions, setZoneGeoOptions] = useState({ provinces: [], districts: [], municipalities: [], wards: [] })
  const [courierForm, setCourierForm] = useState(EMPTY_COURIER)
  const [busy, setBusy] = useState(false)

  const zonesFetcher = (page) => api.get('/admin/shipping/zones', { params: { page, per_page: 50 } })
  const couriersFetcher = (page) => api.get('/admin/shipping/couriers', { params: { page, per_page: 50 } })

  const {
    items: zones, meta: zonesMeta, page: zonesPage, setPage: setZonesPage,
    loading: zonesLoading, error: zonesError, reload: reloadZones,
  } = useList(zonesFetcher, { pageSize: 50 })

  const {
    items: couriers, meta: couriersMeta, page: couriersPage, setPage: setCouriersPage,
    loading: couriersLoading, error: couriersError, reload: reloadCouriers,
  } = useList(couriersFetcher, { pageSize: 50 })

  const {
    items: allCoverageAreas,
    loading: coverageAreasLoading,
    error: coverageAreasError,
    reload: reloadCoverageAreas,
  } = useList(() => api.get('/admin/delivery-coverage/areas', { skipCache: true }))

  const coverageAreas = useMemo(
    () => allCoverageAreas.filter(
      (area) => area.is_coverage_area && area.verification_status === 'verified' && area.is_active
    ),
    [allCoverageAreas]
  )

  const selectedAreaValues = Array.isArray(zoneForm.provinces) ? zoneForm.provinces : []
  const legacyAreaOptions = selectedAreaValues
    .filter((value) => !coverageAreas.some((area) => coverageAreaLabel(area) === value))
    .map((value) => ({ value, label: value, legacy: true }))

  const availableProvinceIds = useMemo(
    () => new Set(coverageAreas.map((area) => Number(area.province_id)).filter(Boolean)),
    [coverageAreas]
  )

  const districtsByProvince = useMemo(() => {
    const map = new Map()
    coverageAreas.forEach((area) => {
      if (!area.province_id || !area.district_id) return
      const key = Number(area.province_id)
      if (!map.has(key)) map.set(key, new Set())
      map.get(key).add(Number(area.district_id))
    })
    return map
  }, [coverageAreas])

  const municipalitiesByDistrict = useMemo(() => {
    const map = new Map()
    coverageAreas.forEach((area) => {
      if (!area.district_id || !area.municipality_id) return
      const key = Number(area.district_id)
      if (!map.has(key)) map.set(key, new Set())
      map.get(key).add(Number(area.municipality_id))
    })
    return map
  }, [coverageAreas])

  const wardsByMunicipality = useMemo(() => {
    const map = new Map()
    coverageAreas.forEach((area) => {
      const wardKey = coverageWardKey(area)
      if (!area.municipality_id || !wardKey) return
      const key = Number(area.municipality_id)
      if (!map.has(key)) map.set(key, new Set())
      map.get(key).add(wardKey)
    })
    return map
  }, [coverageAreas])

  const updateHierarchy = (key, value) => {
    setZoneHierarchy((current) => {
      const next = { ...current, [key]: value }
      if (key === 'province') {
        next.district = ''
        next.municipality = ''
        next.ward = ''
      }
      if (key === 'district') {
        next.municipality = ''
        next.ward = ''
      }
      if (key === 'municipality') next.ward = ''
      return next
    })
  }

  const resetHierarchy = (values = []) => {
    const match = coverageAreas.find((area) => values.includes(coverageAreaLabel(area)))
    setZoneHierarchy(match ? {
      province: String(match.province_id || ''),
      district: String(match.district_id || ''),
      municipality: String(match.municipality_id || ''),
      ward: coverageWardKey(match),
    } : EMPTY_ZONE_HIERARCHY)
  }

  const resolvedCoverageArea = useMemo(() => {
    const { province, district, municipality, ward } = zoneHierarchy
    if (!province) return null

    let candidates = coverageAreas.filter((area) => Number(area.province_id) === Number(province))
    if (district) {
      candidates = candidates.filter((area) => Number(area.district_id) === Number(district))
      if (municipality) {
        candidates = candidates.filter((area) => Number(area.municipality_id) === Number(municipality))
        if (ward) {
          return candidates.find((area) => coverageWardKey(area) === ward) || null
        }
        return candidates.find((area) => !coverageWardKey(area)) || null
      }
      return candidates.find((area) => !area.municipality_id) || null
    }
    return candidates.find((area) => !area.district_id) || null
  }, [zoneHierarchy, coverageAreas])

  useEffect(() => {
    let cancelled = false
    api.get('/platform/provinces', { skipCache: true })
      .then((res) => {
        if (!cancelled) {
          setZoneGeoOptions((current) => ({
            ...current,
            provinces: api.unwrapList(res.data).filter((item) => availableProvinceIds.has(Number(item.id))),
          }))
        }
      })
      .catch(() => {
        if (!cancelled) setZoneGeoOptions((current) => ({ ...current, provinces: [] }))
      })
    return () => { cancelled = true }
  }, [availableProvinceIds])

  useEffect(() => {
    if (!zoneHierarchy.province) {
      setZoneGeoOptions((current) => ({ ...current, districts: [], municipalities: [], wards: [] }))
      return undefined
    }
    let cancelled = false
    const allowed = districtsByProvince.get(Number(zoneHierarchy.province)) || new Set()
    api.get('/platform/districts', { params: { province_id: zoneHierarchy.province }, skipCache: true })
      .then((res) => {
        if (!cancelled) {
          setZoneGeoOptions((current) => ({
            ...current,
            districts: api.unwrapList(res.data).filter((item) => allowed.has(Number(item.id))),
            municipalities: [],
            wards: [],
          }))
        }
      })
      .catch(() => {
        if (!cancelled) setZoneGeoOptions((current) => ({ ...current, districts: [], municipalities: [], wards: [] }))
      })
    return () => { cancelled = true }
  }, [zoneHierarchy.province, districtsByProvince])

  useEffect(() => {
    if (!zoneHierarchy.district) {
      setZoneGeoOptions((current) => ({ ...current, municipalities: [], wards: [] }))
      return undefined
    }
    let cancelled = false
    const allowed = municipalitiesByDistrict.get(Number(zoneHierarchy.district)) || new Set()
    api.get('/platform/municipalities', { params: { district_id: zoneHierarchy.district }, skipCache: true })
      .then((res) => {
        if (!cancelled) {
          setZoneGeoOptions((current) => ({
            ...current,
            municipalities: api.unwrapList(res.data).filter((item) => allowed.has(Number(item.id))),
            wards: [],
          }))
        }
      })
      .catch(() => {
        if (!cancelled) setZoneGeoOptions((current) => ({ ...current, municipalities: [], wards: [] }))
      })
    return () => { cancelled = true }
  }, [zoneHierarchy.district, municipalitiesByDistrict])

  useEffect(() => {
    if (!zoneHierarchy.municipality) {
      setZoneGeoOptions((current) => ({ ...current, wards: [] }))
      return undefined
    }
    let cancelled = false
    const allowed = wardsByMunicipality.get(Number(zoneHierarchy.municipality)) || new Set()
    api.get('/platform/wards', { params: { municipality_id: zoneHierarchy.municipality }, skipCache: true })
      .then((res) => {
        if (!cancelled) {
          setZoneGeoOptions((current) => ({
            ...current,
            wards: api.unwrapList(res.data)
              .map((item) => {
                const value = allowed.has(String(item.id))
                  ? String(item.id)
                  : (allowed.has(`n:${item.ward_number}`) ? `n:${item.ward_number}` : null)
                return value ? { id: value, ward_number: item.ward_number } : null
              })
              .filter(Boolean),
          }))
        }
      })
      .catch(() => {
        if (!cancelled) setZoneGeoOptions((current) => ({ ...current, wards: [] }))
      })
    return () => { cancelled = true }
  }, [zoneHierarchy.municipality, wardsByMunicipality])

  const toggleAreaSelection = (value) => {
    setZoneForm((current) => {
      const selected = Array.isArray(current.provinces) ? current.provinces : []
      return {
        ...current,
        provinces: selected.includes(value)
          ? selected.filter((entry) => entry !== value)
          : [...selected, value],
      }
    })
  }

  const addResolvedArea = () => {
    if (!resolvedCoverageArea) return
    toggleAreaSelection(coverageAreaLabel(resolvedCoverageArea))
    setZoneHierarchy((current) => ({ ...current, municipality: '', ward: '' }))
  }

  const openAddZone = () => {
    setZoneForm(EMPTY_ZONE)
    resetHierarchy([])
    setZoneModal({ mode: 'add' })
  }

  const openEditZone = (z) => {
    const values = Array.isArray(z.provinces) ? z.provinces.map(String) : []
    setZoneForm({
      name: z.name || '',
      provinces: values,
      standard_charge: z.standard_charge != null ? Number(z.standard_charge) : 150,
      express_charge: z.express_charge != null ? Number(z.express_charge) : 250,
      estimated_days: z.estimated_days != null ? Number(z.estimated_days) : 2,
    })
    resetHierarchy(values)
    setZoneModal({ mode: 'edit', zone: z })
  }

  const saveZone = async (e) => {
    e.preventDefault()
    if (!zoneForm.name.trim()) {
      toast.error('Enter a zone title.')
      return
    }
    if (selectedAreaValues.length === 0) {
      toast.error('Select at least one created coverage area.')
      return
    }
    setBusy(true)
    const payload = {
      name: zoneForm.name.trim(),
      provinces: selectedAreaValues,
      standard_charge: Number(zoneForm.standard_charge),
      express_charge: Number(zoneForm.express_charge),
      estimated_days: Number(zoneForm.estimated_days),
      is_active: zoneModal?.mode === 'edit' ? zoneModal.zone.is_active : true,
    }
    try {
      if (zoneModal?.mode === 'edit') {
        await api.put(`/admin/shipping/zones/${zoneModal.zone.id}`, payload)
        toast.success(`Shipping rates for "${payload.name}" updated successfully`)
      } else {
        await api.post('/admin/shipping/zones', payload)
        toast.success(`Shipping zone "${payload.name}" created`)
      }
      setZoneModal(null)
      reloadZones()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const deleteZone = (z) => {
    if (!window.confirm(`Delete shipping zone "${z.name}"? This action cannot be undone.`)) return
    api.delete(`/admin/shipping/zones/${z.id}`)
      .then(() => {
        toast.success(`Shipping zone "${z.name}" deleted`)
        reloadZones()
      })
      .catch((err) => toast.error(errorMessage(err)))
  }

  const openAddCourier = () => {
    setCourierForm(EMPTY_COURIER)
    setCourierModal({ mode: 'add' })
  }

  const openEditCourier = (c) => {
    const parts = (c.description || '').split(' · ')
    const type = parts.shift() || 'Primary Fast Delivery Partner'
    setCourierForm({
      name: c.name || '',
      type,
      coverage: parts.join(' · '),
      contact_phone: c.contact_phone || '',
      endpoint: c.tracking_url_pattern || '',
    })
    setCourierModal({ mode: 'edit', courier: c })
  }

  const saveCourier = async (e) => {
    e.preventDefault()
    setBusy(true)
    const description = [courierForm.type, courierForm.coverage].filter(Boolean).join(' · ')
    const payload = {
      name: courierForm.name.trim(),
      contact_phone: courierForm.contact_phone.trim() || undefined,
      tracking_url_pattern: courierForm.endpoint.trim() || undefined,
      description: description || undefined,
      is_active: courierModal?.mode === 'edit' ? courierModal.courier.is_active : true,
    }
    try {
      if (courierModal?.mode === 'edit') {
        await api.put(`/admin/shipping/couriers/${courierModal.courier.id}`, payload)
        toast.success(`Delivery partner "${payload.name}" updated`)
      } else {
        await api.post('/admin/shipping/couriers', payload)
        toast.success(`Delivery partner "${payload.name}" integrated successfully`)
      }
      setCourierModal(null)
      reloadCouriers()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleCourierStatus = (c) => {
    api.put(`/admin/shipping/couriers/${c.id}`, { is_active: !c.is_active })
      .then(() => {
        toast.success(`Courier "${c.name}" ${c.is_active ? 'paused' : 'activated'}`)
        reloadCouriers()
      })
      .catch((err) => toast.error(errorMessage(err)))
  }

  const deleteCourier = (c) => {
    if (!window.confirm(`Remove delivery partner "${c.name}"?`)) return
    api.delete(`/admin/shipping/couriers/${c.id}`)
      .then(() => {
        toast.success(`Delivery partner "${c.name}" removed`)
        reloadCouriers()
      })
      .catch((err) => toast.error(errorMessage(err)))
  }

  const activeZonesCount = zones.filter((z) => z.is_active).length
  const pausedCouriersCount = couriers.filter((c) => !c.is_active).length

  return (
    <div className="w-full flex flex-col gap-4 pb-8">
      <PageHeader
        title="Shipping Zones & Logistics Governance"
        description="Configure nationwide Nepal shipping rates, provincial delivery hubs, and courier integrations."
        breadcrumbs={[
          { label: 'Fulfillment', to: '/admin/fulfillment/partners' },
          { label: 'Shipping Zones' }
        ]}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm flex items-center gap-1"
              onClick={openAddCourier}
            >
              <Truck size={14} /> Add Delivery Partner
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm flex items-center gap-1"
              onClick={openAddZone}
            >
              <Plus size={14} /> Add Shipping Zone
            </button>
          </div>
        }
      />

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div className="card flex flex-col justify-between" style={{ padding: '16px 18px', margin: 0 }}>
          <div className="flex items-center justify-between mb-2">
            <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Active Delivery Zones</span>
            <span className="avatar" style={{ width: 34, height: 34, background: 'var(--primary-50)', color: 'var(--primary)' }}>
              <MapPin size={18} />
            </span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>{activeZonesCount} Zones</div>
          <div className="muted text-xs mt-1">Live shipping rates</div>
        </div>

        <div className="card flex flex-col justify-between" style={{ padding: '16px 18px', margin: 0 }}>
          <div className="flex items-center justify-between mb-2">
            <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Courier Partners</span>
            <span className="avatar" style={{ width: 34, height: 34, background: 'rgba(99, 102, 241, 0.12)', color: '#6366f1' }}>
              <Truck size={18} />
            </span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>{couriers.length} Partners</div>
          <div className="muted text-xs mt-1">{couriers.filter((c) => c.is_active).length} active</div>
        </div>

        <div className="card flex flex-col justify-between" style={{ padding: '16px 18px', margin: 0 }}>
          <div className="flex items-center justify-between mb-2">
            <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Total Shipping Zones</span>
            <span className="avatar" style={{ width: 34, height: 34, background: 'rgba(16, 185, 129, 0.12)', color: '#10b981' }}>
              <Layers size={18} />
            </span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#10b981' }}>{zones.length} Zones</div>
          <div className="muted text-xs mt-1">All regions configured</div>
        </div>

        <div className="card flex flex-col justify-between" style={{ padding: '16px 18px', margin: 0 }}>
          <div className="flex items-center justify-between mb-2">
            <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Paused Couriers</span>
            <span className="avatar" style={{ width: 34, height: 34, background: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' }}>
              <Power size={18} />
            </span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>{pausedCouriersCount} Paused</div>
          <div className="muted text-xs mt-1">Not accepting dispatches</div>
        </div>
      </div>

      <CoverageAreaBuilder />

      <div className="card card-pad-none" style={{ overflow: 'hidden', margin: 0 }}>
        <div className="flex items-center justify-between" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink)' }}>
            <MapPin size={15} color="var(--primary)" /> Regional Shipping Zones & Rates (Nepal)
          </h3>
        </div>
        {zonesLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={60} />)}
          </div>
        ) : zonesError ? (
          <ErrorState onRetry={reloadZones} />
        ) : !zones.length ? (
          <EmptyState icon={MapPin} title="No shipping zones" message="Configure delivery zones and rates to enable nationwide shipping." />
        ) : (
          <>
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="table" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th>Zone Name</th>
                    <th>Covered Districts / Hubs</th>
                    <th>Standard Delivery</th>
                    <th>Express Delivery</th>
                    <th>Est. Delivery Time</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {zones.map((z) => (
                    <tr key={z.id}>
                      <td>
                        <span className="font-bold text-ink text-sm">{z.name}</span>
                      </td>
                      <td className="muted text-xs" style={{ maxWidth: 360 }}>
                        {(z.provinces || []).join(', ')}
                      </td>
                      <td>
                        <span className="font-bold text-primary">{money(z.standard_charge)}</span>
                      </td>
                      <td>
                        <span className="font-bold text-ink">{money(z.express_charge)}</span>
                      </td>
                      <td className="text-xs font-semibold text-ink">
                        {z.estimated_days != null ? `${z.estimated_days} day${z.estimated_days !== 1 ? 's' : ''}` : '—'}
                      </td>
                      <td>
                        <span
                          className="chip chip-sm"
                          style={{
                            background: z.is_active ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: z.is_active ? '#10b981' : '#ef4444',
                            fontWeight: 800,
                            fontSize: 10,
                          }}
                        >
                          ● {z.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-outline btn-xs flex items-center gap-1"
                            style={{ marginLeft: 'auto' }}
                            onClick={() => openEditZone(z)}
                          >
                            <Edit size={12} /> Edit Rates
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger-outline btn-xs flex items-center gap-1"
                            onClick={() => deleteZone(z)}
                            title="Delete zone"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={zonesPage} lastPage={zonesMeta.last_page} total={zonesMeta.total} onChange={setZonesPage} />
          </>
        )}
      </div>

      <div className="card" style={{ padding: 18, margin: 0 }}>
        <div className="flex items-center justify-between mb-3">
          <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink)' }}>
            <Truck size={16} color="var(--primary)" /> Integrated Courier Partners (Nepal)
          </h3>
          <button
            type="button"
            className="btn btn-outline btn-xs flex items-center gap-1"
            onClick={openAddCourier}
          >
            <Plus size={12} /> Add Partner
          </button>
        </div>

        {couriersLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={120} />)}
          </div>
        ) : couriersError ? (
          <ErrorState onRetry={reloadCouriers} />
        ) : !couriers.length ? (
          <EmptyState icon={Truck} title="No courier partners" message="Integrate courier partners to enable delivery dispatch." />
        ) : (
          <>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              {couriers.map((c) => {
                const isActive = c.is_active
                return (
                  <div
                    key={c.id}
                    className="card flex flex-col justify-between"
                    style={{
                      padding: 16,
                      margin: 0,
                      background: 'var(--bg)',
                      border: isActive ? '1px solid var(--border)' : '1px dashed var(--border)',
                      opacity: isActive ? 1 : 0.7,
                    }}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-sm text-ink">{c.name}</span>
                        <span
                          className="chip chip-sm"
                          style={{
                            background: isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: isActive ? '#10b981' : '#ef4444',
                            fontWeight: 800,
                            fontSize: 10,
                          }}
                        >
                          ● {isActive ? 'Live' : 'Paused'}
                        </span>
                      </div>
                      <p className="muted text-xs m-0 mb-2">{c.description || '—'}</p>
                      <div className="text-xs muted mb-2">
                        Phone: <strong className="text-ink">{c.contact_phone || '—'}</strong>
                        {c.contact_email ? <> · Email: <strong className="text-ink">{c.contact_email}</strong></> : null}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-2.5" style={{ borderTop: '1px solid var(--border)' }}>
                      <span className="font-mono text-primary font-bold text-xs truncate" style={{ maxWidth: 140 }}>
                        {c.tracking_url_pattern || c.code || 'No tracking endpoint'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          title={isActive ? 'Pause Partner' : 'Activate Partner'}
                          onClick={() => toggleCourierStatus(c)}
                        >
                          <Power size={12} color={isActive ? '#10b981' : '#94a3b8'} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline btn-xs"
                          onClick={() => openEditCourier(c)}
                        >
                          <Edit size={11} /> Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger-outline btn-xs"
                          onClick={() => deleteCourier(c)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <Pagination page={couriersPage} lastPage={couriersMeta.last_page} total={couriersMeta.total} onChange={setCouriersPage} />
          </>
        )}
      </div>

      {zoneModal && (
        <Modal
          open={!!zoneModal}
          onClose={() => setZoneModal(null)}
          title={zoneModal.mode === 'edit' ? `Edit Shipping Rates: ${zoneModal.zone.name}` : 'Add New Nepal Shipping Zone'}
        >
          <form onSubmit={saveZone} className="flex flex-col gap-3">
            <div className="form-group">
              <label className="label">Zone Title <span className="req">*</span></label>
              <input
                className="input"
                required
                value={zoneForm.name}
                onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })}
                placeholder="e.g. Terai Central Hub"
              />
            </div>
            <div className="form-group">
              <label className="label">Created Coverage Areas <span className="req">*</span></label>
              {coverageAreasLoading ? (
                <div className="muted text-xs">Loading created coverage areas…</div>
              ) : coverageAreasError ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="muted text-xs">Unable to load coverage areas.</span>
                  <button type="button" className="btn btn-outline btn-xs" onClick={reloadCoverageAreas}>Retry</button>
                </div>
              ) : coverageAreas.length === 0 && legacyAreaOptions.length === 0 ? (
                <EmptyState
                  icon={Layers}
                  title="No coverage areas yet"
                  message="Create and verify a coverage area in Shipping & Delivery before adding a shipping zone."
                />
              ) : (
                <>
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                    <label className="flex flex-col gap-2" style={{ minWidth: 0 }}>
                      <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Select province</span>
                      <select
                        className="input"
                        value={zoneHierarchy.province}
                        onChange={(event) => updateHierarchy('province', event.target.value)}
                      >
                        <option value="">Select province</option>
                        {zoneGeoOptions.provinces.map((province) => (
                          <option key={province.id} value={province.id}>{province.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-2" style={{ minWidth: 0 }}>
                      <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>District</span>
                      <select
                        className="input"
                        value={zoneHierarchy.district}
                        onChange={(event) => updateHierarchy('district', event.target.value)}
                        disabled={!zoneHierarchy.province}
                      >
                        <option value="">Whole district</option>
                        {zoneGeoOptions.districts.map((district) => (
                          <option key={district.id} value={district.id}>{district.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-2" style={{ minWidth: 0 }}>
                      <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Municipality</span>
                      <select
                        className="input"
                        value={zoneHierarchy.municipality}
                        onChange={(event) => updateHierarchy('municipality', event.target.value)}
                        disabled={!zoneHierarchy.district}
                      >
                        <option value="">Whole municipality</option>
                        {zoneGeoOptions.municipalities.map((municipality) => (
                          <option key={municipality.id} value={municipality.id}>{municipality.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-2" style={{ minWidth: 0 }}>
                      <span className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Ward (optional)</span>
                      <select
                        className="input"
                        value={zoneHierarchy.ward}
                        onChange={(event) => updateHierarchy('ward', event.target.value)}
                        disabled={!zoneHierarchy.municipality}
                      >
                        <option value="">Whole municipality</option>
                        {zoneGeoOptions.wards.map((ward) => (
                          <option key={ward.id} value={ward.id}>Ward {ward.ward_number}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex items-center justify-between wrap gap-2" style={{ marginTop: 8 }}>
                    <span className="muted text-xs">
                      {resolvedCoverageArea
                        ? `Selected: ${coverageAreaLabel(resolvedCoverageArea)}`
                        : 'Choose a level from the created coverage areas.'}
                    </span>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={addResolvedArea}
                      disabled={!resolvedCoverageArea}
                    >
                      <Plus size={14} /> Add to zone
                    </button>
                  </div>

                  {selectedAreaValues.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {selectedAreaValues.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className="chip chip-sm"
                          style={{ border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
                          onClick={() => toggleAreaSelection(value)}
                          title="Remove from zone"
                        >
                          {value} ×
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="label">Standard Delivery (NPR) <span className="req">*</span></label>
                <input
                  type="number"
                  className="input"
                  required
                  min={0}
                  value={zoneForm.standard_charge}
                  onChange={(e) => setZoneForm({ ...zoneForm, standard_charge: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="label">Express Delivery (NPR) <span className="req">*</span></label>
                <input
                  type="number"
                  className="input"
                  required
                  min={0}
                  value={zoneForm.express_charge}
                  onChange={(e) => setZoneForm({ ...zoneForm, express_charge: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Estimated Days (1-30) <span className="req">*</span></label>
              <input
                type="number"
                className="input"
                required
                min={1}
                max={30}
                value={zoneForm.estimated_days}
                onChange={(e) => setZoneForm({ ...zoneForm, estimated_days: Number(e.target.value) })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setZoneModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                {busy ? 'Saving…' : zoneModal.mode === 'edit' ? 'Save Rates' : 'Create Zone'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {courierModal && (
        <Modal
          open={!!courierModal}
          onClose={() => setCourierModal(null)}
          title={courierModal.mode === 'edit' ? `Configure Partner: ${courierModal.courier.name}` : 'Integrate New Delivery Partner'}
        >
          <form onSubmit={saveCourier} className="flex flex-col gap-3">
            <div className="form-group">
              <label className="label">Courier / Logistics Company Name <span className="req">*</span></label>
              <input
                className="input"
                required
                value={courierForm.name}
                onChange={(e) => setCourierForm({ ...courierForm, name: e.target.value })}
                placeholder="e.g. Nepal Can Move Logistics"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="label">Partner Category</label>
                <select
                  className="select"
                  value={courierForm.type}
                  onChange={(e) => setCourierForm({ ...courierForm, type: e.target.value })}
                >
                  <option value="Primary Fast Delivery Partner">Primary Fast Delivery Partner</option>
                  <option value="Government Registered Postal Network">Government Registered Postal Network</option>
                  <option value="Highway Commercial Freight">Highway Commercial Freight</option>
                  <option value="Same-day Local Dispatch">Same-day Local Dispatch</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">Support Contact Phone <span className="req">*</span></label>
                <input
                  className="input"
                  required
                  value={courierForm.contact_phone}
                  onChange={(e) => setCourierForm({ ...courierForm, contact_phone: e.target.value })}
                  placeholder="+977 1-XXXXXXX"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Operational Coverage Districts & Corridors <span className="req">*</span></label>
              <textarea
                className="textarea"
                rows={2}
                required
                value={courierForm.coverage}
                onChange={(e) => setCourierForm({ ...courierForm, coverage: e.target.value })}
                placeholder="e.g. Western Corridor (Butwal, Bhairahawa, Nepalgunj, Dhangadhi, Mahendranagar)"
              />
            </div>

            <div className="form-group">
              <label className="label">API Webhook / Tracking Endpoint (Optional)</label>
              <input
                className="input"
                value={courierForm.endpoint}
                onChange={(e) => setCourierForm({ ...courierForm, endpoint: e.target.value })}
                placeholder="https://api.partner.com/v1/shipments"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setCourierModal(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                {busy ? 'Saving…' : courierModal.mode === 'edit' ? 'Save Changes' : 'Integrate Partner'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
