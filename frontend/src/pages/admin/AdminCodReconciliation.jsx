import React, { useCallback, useEffect, useState } from 'react'
import {
  Banknote, CheckCircle2, Clock, Download, RefreshCw, Search,
  User, Phone, MapPin, Package
} from 'lucide-react'
import api from '../../api/client'
import Drawer from '../../components/ui/Drawer'
import ErrorState from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { money, formatDateTime, errorMessage } from '../../utils/format'
import { exportReportFromRows, companyFromBranding, personLabel } from '../../utils/reportExport'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useBranding } from '../../context/BrandingContext'

const PARTNER_STATUSES = [
  ['pending', 'Pending collection'],
  ['collected', 'Received'],
  ['all', 'All partners'],
]

const DETAIL_STATUSES = [
  ['pending', 'Pending'],
  ['collected', 'Received'],
  ['refunded', 'Fully refunded'],
  ['all', 'All records'],
]

export default function AdminCodReconciliation() {
  const toast = useToast()
  const { user } = useAuth()
  const branding = useBranding()

  const [partners, setPartners] = useState([])
  const [summary, setSummary] = useState({})
  const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0 })
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('pending')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [appliedDates, setAppliedDates] = useState({ from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [collectingId, setCollectingId] = useState(null)

  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailPage, setDetailPage] = useState(1)
  const [detailStatus, setDetailStatus] = useState('pending')
  const [detailSearchInput, setDetailSearchInput] = useState('')
  const [detailSearch, setDetailSearch] = useState('')
  const [detailDateFrom, setDetailDateFrom] = useState('')
  const [detailDateTo, setDetailDateTo] = useState('')
  const [detailDates, setDetailDates] = useState({ from: '', to: '' })
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)
  const [collectingPartner, setCollectingPartner] = useState(false)
  const [collectingOrder, setCollectingOrder] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/admin/deliveries/cod-partners', {
        params: {
          page,
          per_page: 15,
          status,
          search,
          date_from: appliedDates.from || undefined,
          date_to: appliedDates.to || undefined,
        },
      })
      setPartners(response.data?.data || [])
      setSummary(response.data?.meta?.summary || {})
      setPagination(response.data?.meta?.pagination || { current_page: 1, last_page: 1, total: 0 })
    } catch (loadError) {
      setError(loadError)
    } finally {
      setLoading(false)
    }
  }, [page, status, search, appliedDates])

  const loadDetail = useCallback(async () => {
    if (!selectedId) return
    setDetailLoading(true)
    setDetailError(null)
    try {
      const response = await api.get(`/admin/deliveries/cod-partners/${selectedId}`, {
        params: {
          page: detailPage,
          per_page: 15,
          status: detailStatus,
          search: detailSearch,
          date_from: detailDates.from || undefined,
          date_to: detailDates.to || undefined,
        },
      })
      setDetail(response.data)
    } catch (loadError) {
      setDetailError(loadError)
    } finally {
      setDetailLoading(false)
    }
  }, [selectedId, detailPage, detailStatus, detailSearch, detailDates])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadDetail() }, [loadDetail])

  const applySearch = (event) => {
    event.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  const openProfile = (partner) => {
    setSelectedId(partner.id)
    setDetail(null)
    setDetailPage(1)
    setDetailStatus('pending')
    setDetailSearch('')
    setDetailSearchInput('')
    setDetailDates({ from: '', to: '' })
    setDetailDateFrom('')
    setDetailDateTo('')
  }

  const closeProfile = () => {
    setSelectedId(null)
    setDetail(null)
    setDetailError(null)
  }

  const recordPartnerCash = async () => {
    if (!selectedId) return
    setCollectingPartner(true)
    try {
      const response = await api.post(`/admin/deliveries/cod-partners/${selectedId}/collect`)
      toast.success(`Recorded ${money(response.data?.data?.collected_amount || 0)} received from ${detail?.meta?.profile?.name || 'delivery partner'}.`)
      closeProfile()
      await load()
    } catch (collectError) {
      toast.error(errorMessage(collectError))
    } finally {
      setCollectingPartner(false)
    }
  }

  const recordOrderCash = async (record) => {
    setCollectingOrder(record.id)
    try {
      await api.post(`/admin/deliveries/cod-reconciliation/${record.id}/collect`)
      toast.success(`Recorded ${money(record.cod_amount)} received for ${record.order_number || record.vendor_order_number}.`)
      await Promise.all([loadDetail(), load()])
    } catch (collectError) {
      toast.error(errorMessage(collectError))
    } finally {
      setCollectingOrder(null)
    }
  }

  const exportPartners = () => {
    exportReportFromRows({
      columns: [
        { label: 'Delivery Partner' },
        { label: 'Phone' },
        { label: 'Assigned Zones', align: 'right' },
        { label: 'Total Orders', align: 'right' },
        { label: 'Pending Orders', align: 'right' },
        { label: 'Received Orders', align: 'right' },
        { label: 'Pending COD', align: 'right' },
        { label: 'Received COD', align: 'right' },
        { label: 'Refunded COD', align: 'right' },
        { label: 'Last Delivery' },
      ],
      rows: partners.map(partner => [
        partner.name || '—',
        partner.phone || '—',
        (partner.shipping_zone_ids || []).length,
        partner.order_count || 0,
        partner.pending_orders || 0,
        partner.collected_orders || 0,
        money(partner.pending_amount || 0),
        money(partner.collected_amount || 0),
        money(partner.refunded_amount || 0),
        formatDateTime(partner.last_delivered_at),
      ]),
      title: 'COD Partner Reconciliation Report',
      subtitle: 'Outstanding and received cash grouped by delivery partner.',
      sectionLabel: 'Delivery Partners',
      fileName: `gosika_cod_partners_${new Date().toISOString().slice(0, 10)}`,
      preparedBy: personLabel(user),
      company: companyFromBranding(branding),
      rangeLabel: appliedDates.from || appliedDates.to
        ? `${appliedDates.from || 'Start'} to ${appliedDates.to || 'End'}`
        : undefined,
    })
    toast.success('Partner COD report exported.')
  }

  const exportDetail = () => {
    const records = detail?.data || []
    exportReportFromRows({
      columns: [
        { label: 'Order' },
        { label: 'Customer' },
        { label: 'Delivered' },
        { label: 'Original COD', align: 'right' },
        { label: 'Refunded', align: 'right' },
        { label: 'Net COD', align: 'right' },
        { label: 'Status' },
        { label: 'Received At' },
        { label: 'Received By' },
      ],
      rows: records.map(record => [
        record.order_number || record.vendor_order_number || '—',
        record.customer_name || '—',
        formatDateTime(record.delivered_at),
        money(record.original_cod_amount || 0),
        money(record.refunded_amount || 0),
        money(record.cod_amount || 0),
        record.status || '',
        formatDateTime(record.cod_reconciled_at),
        record.cod_reconciled_by || '—',
      ]),
      title: `${detail?.meta?.profile?.name || 'Delivery Partner'} COD History`,
      subtitle: 'Order-level COD collections and refund adjustments for this delivery partner.',
      sectionLabel: 'COD Order History',
      fileName: `gosika_cod_partner_history_${new Date().toISOString().slice(0, 10)}`,
      preparedBy: personLabel(user),
      company: companyFromBranding(branding),
      rangeLabel: detailDates.from || detailDates.to
        ? `${detailDates.from || 'Start'} to ${detailDates.to || 'End'}`
        : undefined,
    })
    toast.success('Partner COD history exported.')
  }

  if (loading && partners.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="page-header"><Skeleton width={280} height={28} /></div>
        <div className="card"><Skeleton height={180} /></div>
      </div>
    )
  }

  if (error && partners.length === 0) {
    return <ErrorState message={errorMessage(error)} onRetry={load} />
  }

  const profile = detail?.meta?.profile
  const partnerSummary = detail?.meta?.partner_summary || {}
  const detailPagination = detail?.meta?.pagination || { current_page: 1, last_page: 1, total: 0 }
  const detailRows = detail?.data || []
  const pendingAmount = Number(partnerSummary.pending_amount || 0)

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="page-header">
        <div className="page-header-left">
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>COD Reconciliation</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
            Collect cash from delivery partners in one handover, then drill into every COD order they delivered.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-outline btn-sm" onClick={exportPartners} disabled={partners.length === 0}>
            <Download size={14} /> Export report
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        <SummaryCard
          label="Cash to collect"
          amount={summary.pending_amount}
          count={summary.pending_count}
          Icon={Clock}
          color="#d97706"
          background="#fffbeb"
        />
        <SummaryCard
          label="Cash received"
          amount={summary.collected_amount}
          count={summary.collected_count}
          Icon={CheckCircle2}
          color="#059669"
          background="#ecfdf5"
        />
        <SummaryCard
          label="Partners with pending COD"
          display={pagination.total || 0}
          count={pagination.total || 0}
          Icon={User}
          color="#2563eb"
          background="#eff6ff"
          suffix="partners"
        />
      </div>

      <div className="card" style={{ padding: 14, margin: 0 }}>
        <div className="flex items-center justify-between wrap gap-3">
          <div className="flex gap-2">
            {PARTNER_STATUSES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`btn btn-sm ${status === value ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => { setPage(1); setStatus(value) }}
              >
                {label}
              </button>
            ))}
          </div>
          <form onSubmit={applySearch} style={{ position: 'relative', width: 'min(100%, 280px)' }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input
              className="input"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search partner name or phone…"
              style={{ paddingLeft: 32, height: 36 }}
            />
          </form>
        </div>
        <div className="flex items-center gap-2 wrap mt-3">
          <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ height: 34, width: 150 }} />
          <span className="muted text-xs">to</span>
          <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ height: 34, width: 150 }} />
          <button type="button" className="btn btn-outline btn-xs" onClick={() => { setPage(1); setAppliedDates({ from: dateFrom, to: dateTo }) }}>Apply dates</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setDateFrom(''); setDateTo(''); setAppliedDates({ from: '', to: '' }); setSearch(''); setSearchInput(''); setPage(1) }}>Reset</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{errorMessage(error)}</div>}

      <div className="card card-pad-none" style={{ overflow: 'hidden', margin: 0 }}>
        <div className="table-responsive">
          <table className="table" style={{ width: '100%', margin: 0 }}>
            <thead>
              <tr>
                <th>Delivery partner</th>
                <th style={{ textAlign: 'right' }}>Orders</th>
                <th style={{ textAlign: 'right' }}>Pending COD</th>
                <th style={{ textAlign: 'right' }}>Received COD</th>
                <th style={{ textAlign: 'right' }}>Refunded</th>
                <th>Last delivery</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7}><Skeleton height={36} /></td></tr>
              ) : partners.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 36, color: 'var(--muted)' }}>
                    {status === 'pending' ? 'No delivery partners have pending COD.' : 'No COD partners found.'}
                  </td>
                </tr>
              ) : partners.map((partner) => (
                <tr key={partner.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="avatar" style={{ width: 34, height: 34, background: '#eff6ff', color: '#2563eb' }}><User size={16} /></span>
                      <div>
                        <button
                          type="button"
                          className="font-bold"
                          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: '#1d4ed8', textAlign: 'left' }}
                          onClick={() => openProfile(partner)}
                        >
                          {partner.name || 'Unknown partner'}
                        </button>
                        <div className="muted text-xs">{partner.phone || '—'}</div>
                        <div className="muted text-xs">{(partner.shipping_zone_ids || []).length} assigned zone(s)</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="font-bold">{partner.pending_orders || 0} pending</div>
                    <div className="muted text-xs">{partner.order_count || 0} total · {partner.collected_orders || 0} received</div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: '#b45309' }}>{money(partner.pending_amount || 0)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: '#15803d' }}>{money(partner.collected_amount || 0)}</td>
                  <td style={{ textAlign: 'right', color: '#dc2626' }}>{money(partner.refunded_amount || 0)}</td>
                  <td className="text-sm">{formatDateTime(partner.last_delivered_at)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openProfile(partner)}>
                        View profile
                      </button>
                      {Number(partner.pending_amount) > 0 && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={collectingId === partner.id}
                          onClick={async () => {
                            setCollectingId(partner.id)
                            try {
                              const response = await api.post(`/admin/deliveries/cod-partners/${partner.id}/collect`)
                              toast.success(`Recorded ${money(response.data?.data?.collected_amount || 0)} received from ${partner.name}.`)
                              await load()
                            } catch (collectError) {
                              toast.error(errorMessage(collectError))
                            } finally {
                              setCollectingId(null)
                            }
                          }}
                        >
                          <Banknote size={14} /> {collectingId === partner.id ? 'Saving…' : 'Collect all'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <span className="muted text-xs">{pagination.total || 0} partners</span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-outline btn-xs" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}>Previous</button>
            <span className="muted text-xs">{pagination.current_page || page} / {pagination.last_page || 1}</span>
            <button type="button" className="btn btn-outline btn-xs" disabled={page >= (pagination.last_page || 1) || loading} onClick={() => setPage(current => current + 1)}>Next</button>
          </div>
        </div>
      </div>

      <Drawer
        open={!!selectedId}
        onClose={closeProfile}
        title={profile?.name ? `${profile.name} · COD Profile` : 'COD Partner Profile'}
        panelClassName="cod-profile-drawer"
      >
        {detailLoading && !detail ? (
          <Skeleton height={220} />
        ) : detailError && !detail ? (
          <ErrorState message={errorMessage(detailError)} onRetry={loadDetail} />
        ) : detail ? (
          <div className="flex flex-col gap-4">
            <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="avatar" style={{ width: 44, height: 44, background: '#eff6ff', color: '#2563eb' }}><User size={20} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 900, fontSize: 16, color: 'var(--ink)' }}>{profile?.name || 'Delivery partner'}</div>
                  <div className="muted text-xs" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={12} /> {profile?.phone || '—'}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} /> {(profile?.service_areas || []).join(', ') || 'No service areas'}</span>
                  </div>
                </div>
                <span className={`badge ${profile?.status === 'approved' ? 'badge-success' : 'badge-warning'}`}>{profile?.status || '—'}</span>
              </div>
              <div className="grid mt-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                <MiniStat label="Pending COD" value={money(partnerSummary.pending_amount || 0)} color="#b45309" />
                <MiniStat label="Received COD" value={money(partnerSummary.collected_amount || 0)} color="#15803d" />
                <MiniStat label="Refunded" value={money(partnerSummary.refunded_amount || 0)} color="#dc2626" />
                <MiniStat label="Orders" value={`${partnerSummary.pending_count || 0} pending / ${partnerSummary.order_count || 0} total`} color="#1d4ed8" />
              </div>
              <div className="flex gap-2 mt-3">
                <button type="button" className="btn btn-outline btn-sm" onClick={exportDetail} disabled={detailRows.length === 0}>
                  <Download size={14} /> Export history
                </button>
                {pendingAmount > 0 && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={recordPartnerCash} disabled={collectingPartner}>
                    <Banknote size={14} /> {collectingPartner ? 'Saving…' : `Collect all · ${money(pendingAmount)}`}
                  </button>
                )}
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Package size={15} style={{ color: 'var(--muted)' }} /> Order History
              </div>
              <div className="flex gap-2 wrap mb-2">
                {DETAIL_STATUSES.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`btn btn-xs ${detailStatus === value ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => { setDetailPage(1); setDetailStatus(value) }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(event) => { event.preventDefault(); setDetailPage(1); setDetailSearch(detailSearchInput.trim()) }}
                style={{ position: 'relative', marginBottom: 8 }}
              >
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
                <input className="input" value={detailSearchInput} onChange={e => setDetailSearchInput(e.target.value)} placeholder="Search order…" style={{ paddingLeft: 30, height: 34 }} />
              </form>
              <div className="flex items-center gap-2 wrap mb-3">
                <input className="input" type="date" value={detailDateFrom} onChange={e => setDetailDateFrom(e.target.value)} style={{ height: 32, width: 140 }} />
                <span className="muted text-xs">to</span>
                <input className="input" type="date" value={detailDateTo} onChange={e => setDetailDateTo(e.target.value)} style={{ height: 32, width: 140 }} />
                <button type="button" className="btn btn-outline btn-xs" onClick={() => { setDetailPage(1); setDetailDates({ from: detailDateFrom, to: detailDateTo }) }}>Apply</button>
              </div>
              {detailLoading && <Skeleton height={120} />}
              {detailError && <div className="alert alert-error">{errorMessage(detailError)}</div>}
              {!detailLoading && detailRows.length === 0 && (
                <div className="muted text-xs" style={{ padding: 20, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>
                  No COD records match these filters.
                </div>
              )}
              {!detailLoading && detailRows.length > 0 && (
                <div style={{ display: 'grid', gap: 8 }}>
                  {detailRows.map(record => (
                    <div key={record.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 13 }}>{record.order_number || record.vendor_order_number || 'Order'}</div>
                          <div className="muted text-xs">{record.customer_name || '—'} · {formatDateTime(record.delivered_at)}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 900, color: record.status === 'collected' ? '#15803d' : '#b45309' }}>{money(record.cod_amount || 0)}</div>
                          <div className="muted text-xs">{record.status === 'collected' ? 'Received' : record.status === 'refunded' ? 'Fully refunded' : 'Pending'}</div>
                        </div>
                      </div>
                      {Number(record.refunded_amount) > 0 && (
                        <div className="muted text-xs mt-1" style={{ color: '#dc2626' }}>
                          {money(record.refunded_amount)} refunded from {money(record.original_cod_amount)} COD
                        </div>
                      )}
                      {record.status === 'collected' && (
                        <div className="muted text-xs mt-1">
                          {record.cod_reconciled_by ? `By ${record.cod_reconciled_by} · ` : ''}{formatDateTime(record.cod_reconciled_at)}
                        </div>
                      )}
                      {record.status === 'pending' && (
                        <button
                          type="button"
                          className="btn btn-outline btn-xs mt-2"
                          disabled={collectingOrder === record.id}
                          onClick={() => recordOrderCash(record)}
                        >
                          <CheckCircle2 size={12} /> {collectingOrder === record.id ? 'Saving…' : 'Record received'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between mt-3">
                <span className="muted text-xs">{detailPagination.total || 0} records</span>
                <div className="flex items-center gap-2">
                  <button type="button" className="btn btn-outline btn-xs" disabled={detailPage <= 1 || detailLoading} onClick={() => setDetailPage(current => current - 1)}>Previous</button>
                  <span className="muted text-xs">{detailPagination.current_page || detailPage} / {detailPagination.last_page || 1}</span>
                  <button type="button" className="btn btn-outline btn-xs" disabled={detailPage >= (detailPagination.last_page || 1) || detailLoading} onClick={() => setDetailPage(current => current + 1)}>Next</button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}

function SummaryCard({ label, amount, display, count, Icon, color, background, suffix }) {
  return (
    <div className="card" style={{ padding: '16px 18px', margin: 0 }}>
      <div className="flex items-center justify-between mb-2">
        <span className="muted text-xs font-bold uppercase">{label}</span>
        <span className="avatar" style={{ width: 34, height: 34, background, color }}><Icon size={17} /></span>
      </div>
      <div style={{ fontSize: 23, fontWeight: 900, color }}>{display ?? money(amount || 0)}</div>
      <div className="muted text-xs mt-1">{count || 0} {suffix || `delivered COD order${count === 1 ? '' : 's'}`}</div>
    </div>
  )
}

function MiniStat({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
      <div className="muted text-xs" style={{ fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 900, color, marginTop: 2 }}>{value}</div>
    </div>
  )
}
