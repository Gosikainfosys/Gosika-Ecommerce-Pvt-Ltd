import React, { useEffect, useState } from 'react'
import {
  Truck, CheckCircle2, XCircle, AlertCircle, Clock, Eye,
  Phone, Mail, MapPin, Plus, ShieldCheck, Ban, UserCheck,
  RefreshCw, User, Layers
} from 'lucide-react'
import api from '../../api/client'
import PageHeader from '../../components/admin/PageHeader'
import DataTable from '../../components/admin/DataTable'
import FilterBar from '../../components/admin/FilterBar'
import ConfirmDialog from '../../components/admin/ConfirmDialog'
import Modal from '../../components/ui/Modal'
import StatusBadge from '../../components/commerce/StatusBadge'
import { formatDate, timeAgo } from '../../utils/format'
import { useToast } from '../../context/ToastContext'

export default function AdminDeliveryPartners() {
  const toast = useToast()
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [appliedDates, setAppliedDates] = useState({ from: '', to: '' })
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [zones, setZones] = useState([])
  const [zoneModal, setZoneModal] = useState({ partner: null, ids: [], saving: false })

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    vehicle_type: 'Motorcycle',
    vehicle_number: '',
    service_areas: '',
    shipping_zone_ids: [],
  })

  const [dialogState, setDialogState] = useState({
    isOpen: false,
    action: null, // 'approve' | 'reject' | 'suspend' | 'activate'
    partner: null,
    loading: false
  })

  const loadPartners = async () => {
    setLoading(true)
    try {
      const params = {}
      if (statusFilter && statusFilter !== 'all') params.status = statusFilter
      if (search.trim()) params.search = search.trim()
      if (appliedDates.from) params.date_from = appliedDates.from
      if (appliedDates.to) params.date_to = appliedDates.to

      const res = await api.get('/admin/delivery-partners', { params })
      setPartners(api.unwrapList(res.data))
    } catch (err) {
      toast.error('Failed to load delivery partners.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPartners()
  }, [statusFilter, search, appliedDates])

  useEffect(() => {
    api.get('/admin/shipping/zones', { params: { per_page: 100 }, skipCache: true })
      .then(res => setZones(api.unwrapList(res.data)))
      .catch(() => setZones([]))
  }, [])

  const zoneName = (id) => zones.find(zone => String(zone.id) === String(id))?.name || id
  const assignedZoneNames = (partner) => (Array.isArray(partner.shipping_zone_ids) ? partner.shipping_zone_ids : [])
    .map(zoneName)

  const openZoneModal = (partner) => setZoneModal({
    partner,
    ids: Array.isArray(partner.shipping_zone_ids) ? partner.shipping_zone_ids : [],
    saving: false,
  })

  const toggleZoneId = (id) => setZoneModal(current => ({
    ...current,
    ids: current.ids.includes(id) ? current.ids.filter(z => z !== id) : [...current.ids, id],
  }))

  const saveZones = async () => {
    if (!zoneModal.partner) return
    setZoneModal(current => ({ ...current, saving: true }))
    try {
      const targetId = zoneModal.partner.uuid || zoneModal.partner.id
      await api.put(`/admin/delivery-partners/${targetId}/zones`, { shipping_zone_ids: zoneModal.ids })
      toast.success(`Shipping zones updated for ${zoneModal.partner.name}.`)
      setZoneModal({ partner: null, ids: [], saving: false })
      loadPartners()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update shipping zones.')
      setZoneModal(current => ({ ...current, saving: false }))
    }
  }

  const handleAction = (action, partner) => {
    setDialogState({
      isOpen: true,
      action,
      partner,
      loading: false
    })
  }

  const handleConfirmAction = async (reason) => {
    const { action, partner } = dialogState
    if (!partner) return

    setDialogState(prev => ({ ...prev, loading: true }))
    const targetId = partner.uuid || partner.id

    try {
      if (action === 'approve') {
        await api.post(`/admin/delivery-partners/${targetId}/approve`)
        toast.success(`Delivery partner "${partner.name}" approved.`)
      } else if (action === 'reject') {
        await api.post(`/admin/delivery-partners/${targetId}/reject`, { reason })
        toast.success(`Delivery partner rejected.`)
      } else if (action === 'suspend') {
        await api.post(`/admin/delivery-partners/${targetId}/suspend`, { reason })
        toast.success(`Delivery partner suspended.`)
      } else if (action === 'activate') {
        await api.post(`/admin/delivery-partners/${targetId}/activate`)
        toast.success(`Delivery partner activated.`)
      }

      setDialogState({ isOpen: false, action: null, partner: null, loading: false })
      loadPartners()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action failed.')
      setDialogState(prev => ({ ...prev, loading: false }))
    }
  }

  const handleCreateSubmit = async (e) => {
    e.preventDefault()
    if (!form.name || !form.phone || !form.email) {
      toast.error('Please fill in all required fields.')
      return
    }

    setCreating(true)
    try {
      const response = await api.post('/admin/delivery-partners', {
        name: form.name,
        email: form.email,
        phone: form.phone,
        vehicle_type: form.vehicle_type,
        vehicle_number: form.vehicle_number,
        service_areas: form.service_areas ? form.service_areas.split(',').map(s => s.trim()) : ['Kathmandu Valley'],
        shipping_zone_ids: form.shipping_zone_ids,
      })
      if (response.data?.meta?.invitation_sent === false) {
        toast.error(response.data?.message || 'Delivery partner created, but the invitation email could not be sent.')
      } else {
        toast.success(`Delivery partner created. An invitation link was sent to ${form.email}.`)
      }
      setCreateOpen(false)
      setForm({ name: '', email: '', phone: '', vehicle_type: 'Motorcycle', vehicle_number: '', service_areas: '', shipping_zone_ids: [] })
      loadPartners()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to register delivery partner.')
    } finally {
      setCreating(false)
    }
  }

  const columns = [
    {
      header: 'Rider / Partner',
      render: item => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: '#f0fdf4',
              color: '#16a34a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <Truck size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{item.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              {item.email} · {item.phone}
            </div>
          </div>
        </div>
      )
    },
    {
      header: 'Vehicle Details',
      render: item => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--ink)' }}>
            {item.vehicle_type || 'Vehicle'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
            {item.vehicle_number || 'Plate not registered'}
          </div>
        </div>
      )
    },
    {
      header: 'Service Hub',
      render: item => {
        const areas = Array.isArray(item.service_areas) ? item.service_areas.join(', ') : (item.service_areas || 'Kathmandu')
        return (
          <span style={{ fontSize: 12, color: '#334155' }} title={areas}>
            {areas}
          </span>
        )
      }
    },
    {
      header: 'Assigned Zones',
      render: item => {
        const names = assignedZoneNames(item)
        return names.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {names.map(name => (
              <span key={name} className="chip chip-sm" style={{ background: '#eff6ff', color: '#1d4ed8', fontWeight: 700, fontSize: 10 }}>
                {name}
              </span>
            ))}
          </div>
        ) : <span style={{ fontSize: 11, color: 'var(--muted)' }}>No zones assigned</span>
      }
    },
    {
      header: 'Duty Status',
      render: item => (
        <span
          className="chip chip-sm"
          style={{
            background: item.is_online ? '#dcfce7' : '#f1f5f9',
            color: item.is_online ? '#16a34a' : '#64748b',
            fontWeight: 800,
            fontSize: 11
          }}
        >
          {item.is_online ? '● Online (On Duty)' : 'Offline'}
        </span>
      )
    },
    {
      header: 'Verification Status',
      accessor: 'status',
      render: item => <StatusBadge status={item.status} />
    },
    {
      header: 'Actions',
      align: 'right',
      render: item => {
        const isPending = item.status === 'pending'
        const isActive = item.status === 'active' || item.status === 'approved'
        const isSuspended = item.status === 'suspended'

        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
            <button
              type="button"
              className="btn btn-outline btn-xs"
              onClick={() => openZoneModal(item)}
              title="Assign shipping zones"
            >
              <Layers size={12} style={{ marginRight: 3 }} /> Zones
            </button>
            {isPending && (
              <>
                <button
                  type="button"
                  className="btn btn-xs"
                  style={{ background: '#16a34a', color: '#fff', border: 'none' }}
                  onClick={() => handleAction('approve', item)}
                  title="Approve Rider"
                >
                  <CheckCircle2 size={12} style={{ marginRight: 3 }} /> Approve
                </button>

                <button
                  type="button"
                  className="btn btn-outline btn-xs"
                  style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                  onClick={() => handleAction('reject', item)}
                  title="Reject Application"
                >
                  <XCircle size={12} /> Reject
                </button>
              </>
            )}

            {isActive && (
              <button
                type="button"
                className="btn btn-outline btn-xs"
                style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                onClick={() => handleAction('suspend', item)}
              >
                Suspend
              </button>
            )}

            {isSuspended && (
              <button
                type="button"
                className="btn btn-xs"
                style={{ background: '#2563eb', color: '#fff', border: 'none' }}
                onClick={() => handleAction('activate', item)}
              >
                Reactivate
              </button>
            )}
          </div>
        )
      }
    }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Delivery Fleet & Partners"
        description="Manage registered delivery personnel, dispatch couriers, vehicle compliance, and verification."
        breadcrumbs={[
          { label: 'Fulfillment', to: '/admin/fulfillment/partners' },
          { label: 'Delivery Partners' }
        ]}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setCreateOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8 }}
            >
              <Plus size={14} /> Register Partner
            </button>

            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={loadPartners}
              style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8 }}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
            </button>
          </div>
        }
      />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        debounceMs={300}
        searchPlaceholder="Search by rider name, phone, plate #..."
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        fromDate={fromDate}
        toDate={toDate}
        onFromDateChange={setFromDate}
        onToDateChange={setToDate}
        onApplyFilters={() => setAppliedDates({ from: fromDate, to: toDate })}
        statusOptions={[
          { value: 'active', label: 'Active & Verified' },
          { value: 'pending', label: 'Pending Approval' },
          { value: 'suspended', label: 'Suspended' },
        ]}
        onReset={() => {
          setSearch('')
          setStatusFilter('all')
          setFromDate('')
          setToDate('')
          setAppliedDates({ from: '', to: '' })
        }}
      />

      <DataTable
        columns={columns}
        data={partners}
        loading={loading}
        emptyTitle="No delivery partners found"
        emptyDescription="There are no delivery partners matching your criteria."
      />

      {/* Register Partner Modal */}
      {createOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(3px)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16
          }}
          onClick={e => { if (e.target === e.currentTarget) setCreateOpen(false) }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 520,
              background: '#fff',
              borderRadius: 16,
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
                Register New Delivery Partner
              </h3>
              <button className="btn btn-ghost btn-xs" onClick={() => setCreateOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleCreateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="label" style={{ fontSize: 12, fontWeight: 700 }}>Full Name *</label>
                <input
                  className="input"
                  style={{ width: '100%', height: 38, fontSize: 13 }}
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Rider's full legal name"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="label" style={{ fontSize: 12, fontWeight: 700 }}>Email Address *</label>
                  <input
                    type="email"
                    className="input"
                    style={{ width: '100%', height: 38, fontSize: 13 }}
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="rider@gosika.com.np"
                    required
                  />
                </div>
                <div>
                  <label className="label" style={{ fontSize: 12, fontWeight: 700 }}>Mobile Phone *</label>
                  <input
                    className="input"
                    style={{ width: '100%', height: 38, fontSize: 13 }}
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="98XXXXXXXX"
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="label" style={{ fontSize: 12, fontWeight: 700 }}>Vehicle Type</label>
                  <select
                    className="input"
                    style={{ width: '100%', height: 38, fontSize: 13 }}
                    value={form.vehicle_type}
                    onChange={e => setForm({ ...form, vehicle_type: e.target.value })}
                  >
                    <option value="Motorcycle">Motorcycle</option>
                    <option value="Scooter">Scooter</option>
                    <option value="Bicycle">Bicycle</option>
                    <option value="Van / Truck">Van / Mini-Truck</option>
                  </select>
                </div>
                <div>
                  <label className="label" style={{ fontSize: 12, fontWeight: 700 }}>License Plate #</label>
                  <input
                    className="input"
                    style={{ width: '100%', height: 38, fontSize: 13 }}
                    value={form.vehicle_number}
                    onChange={e => setForm({ ...form, vehicle_number: e.target.value })}
                    placeholder="BA 2 PA 1234"
                  />
                </div>
              </div>

              <div>
                <label className="label" style={{ fontSize: 12, fontWeight: 700 }}>Service Hub Areas (comma separated)</label>
                <input
                  className="input"
                  style={{ width: '100%', height: 38, fontSize: 13 }}
                  value={form.service_areas}
                  onChange={e => setForm({ ...form, service_areas: e.target.value })}
                  placeholder="Kathmandu, Lalitpur, Bhaktapur"
                />
              </div>

              <div>
                <label className="label" style={{ fontSize: 12, fontWeight: 700 }}>Assigned Shipping Zones</label>
                <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                  {zones.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>No shipping zones configured yet.</div>}
                  {zones.map(zone => (
                    <label key={zone.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 12, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={form.shipping_zone_ids.includes(zone.id)}
                        onChange={() => setForm(current => ({
                          ...current,
                          shipping_zone_ids: current.shipping_zone_ids.includes(zone.id)
                            ? current.shipping_zone_ids.filter(id => id !== zone.id)
                            : [...current.shipping_zone_ids, zone.id],
                        }))}
                      />
                      <span>{zone.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setCreateOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={creating}>
                  {creating ? 'Registering...' : 'Register Partner'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Zone assignment modal */}
      <Modal
        open={!!zoneModal.partner}
        onClose={() => setZoneModal({ partner: null, ids: [], saving: false })}
        title={`Assign Zones · ${zoneModal.partner?.name || ''}`}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setZoneModal({ partner: null, ids: [], saving: false })}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={saveZones} disabled={zoneModal.saving}>
              {zoneModal.saving ? 'Saving…' : 'Save Zones'}
            </button>
          </div>
        }
      >
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 0 }}>
          Select the shipping zones this rider may serve. Dispatch eligibility combines these zones with manual service areas.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {zones.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>No shipping zones configured yet.</div>}
          {zones.map(zone => (
            <label
              key={zone.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: 10,
                border: `1px solid ${zoneModal.ids.includes(zone.id) ? '#93c5fd' : 'var(--border)'}`,
                background: zoneModal.ids.includes(zone.id) ? '#eff6ff' : '#fff',
                borderRadius: 8, cursor: 'pointer',
              }}
              onClick={() => toggleZoneId(zone.id)}
            >
              <input type="checkbox" checked={zoneModal.ids.includes(zone.id)} onChange={() => {}} style={{ marginTop: 2 }} />
              <span>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13 }}>{zone.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>
                  {(zone.provinces || []).join(', ') || 'No coverage labels'}
                </span>
              </span>
            </label>
          ))}
        </div>
      </Modal>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.isOpen}
        onClose={() => setDialogState({ isOpen: false, action: null, partner: null, loading: false })}
        onConfirm={handleConfirmAction}
        loading={dialogState.loading}
        title={
          dialogState.action === 'approve'
            ? `Approve Partner "${dialogState.partner?.name}"?`
            : dialogState.action === 'reject'
            ? `Reject Application for "${dialogState.partner?.name}"?`
            : `Suspend Partner "${dialogState.partner?.name}"?`
        }
        message={
          dialogState.action === 'approve'
            ? 'Approving will grant active dispatch access to receive delivery assignments.'
            : 'Please specify the reason for rejecting or suspending this delivery partner.'
        }
        variant={dialogState.action === 'approve' || dialogState.action === 'activate' ? 'success' : 'danger'}
        confirmText={
          dialogState.action === 'approve' ? 'Approve Rider' : dialogState.action === 'reject' ? 'Reject' : 'Suspend'
        }
        requireReason={dialogState.action === 'reject' || dialogState.action === 'suspend'}
        reasonPlaceholder="Provide the administrative explanation..."
      />
    </div>
  )
}