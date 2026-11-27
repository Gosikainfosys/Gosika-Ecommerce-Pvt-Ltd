import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Banknote, CheckCircle2, Download, MapPin, Package, Phone, Search, User,
} from 'lucide-react'
import api from '../../api/client'
import ErrorState from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { money, formatDateTime, errorMessage } from '../../utils/format'
import { exportReportFromRows, companyFromBranding, personLabel } from '../../utils/reportExport'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useBranding } from '../../context/BrandingContext'

const DETAIL_STATUSES = [
  ['pending', 'Pending'],
  ['collected', 'Received'],
  ['refunded', 'Fully refunded'],
  ['all', 'All records'],
]

export default function AdminCodPartnerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const branding = useBranding()

  const [detail, setDetail] = useState(null)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('pending')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [dates, setDates] = useState({ from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [collectingPartner, setCollectingPartner] = useState(false)
  const [collectingOrder, setCollectingOrder] = useState(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const response = await api.get(`/admin/deliveries/cod-partners/${id}`, {
        params: {
          page,
          per_page: 15,
          status,
          search,
          date_from: dates.from || undefined,
          date_to: dates.to || undefined,
        },
      })
      setDetail(response.data)
    } catch (loadError) {
      setError(loadError)
    } finally {
      setLoading(false)
    }
  }, [id, page, status, search, dates])

  useEffect(() => { load() }, [load])

  const recordPartnerCash = async () => {
    setCollectingPartner(true)
    try {
      const response = await api.post(`/admin/deliveries/cod-partners/${id}/collect`)
      toast.success(`Recorded ${money(response.data?.data?.collected_amount || 0)} received from ${detail?.meta?.profile?.name || 'delivery partner'}.`)
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
      await load()
    } catch (collectError) {
      toast.error(errorMessage(collectError))
    } finally {
      setCollectingOrder(null)
    }
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
      rangeLabel: dates.from || dates.to
        ? `${dates.from || 'Start'} to ${dates.to || 'End'}`
        : undefined,
    })
    toast.success('Partner COD history exported.')
  }

  if (loading && !detail) {
    return (
      <div className="flex flex-col gap-4">
        <div className="page-header"><Skeleton width={280} height={28} /></div>
        <div className="card"><Skeleton height={220} /></div>
      </div>
    )
  }

  if (error && !detail) {
    return <ErrorState message={errorMessage(error)} onRetry={load} />
  }

  const profile = detail?.meta?.profile
  const partnerSummary = detail?.meta?.partner_summary || {}
  const pagination = detail?.meta?.pagination || { current_page: 1, last_page: 1, total: 0 }
  const rows = detail?.data || []
  const pendingAmount = Number(partnerSummary.pending_amount || 0)

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="page-header">
        <div className="page-header-left">
          <button
            type="button"
            className="btn btn-ghost btn-xs mb-2"
            onClick={() => navigate('/admin/fulfillment/cod')}
          >
            <ArrowLeft size={14} /> Back to COD Reconciliation
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>
            {profile?.name || 'Delivery Partner'} · COD Profile
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
            Order-level COD collections and refund adjustments for this delivery partner.
          </p>
        </div>
      </div>

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
          <button type="button" className="btn btn-outline btn-sm" onClick={exportDetail} disabled={rows.length === 0}>
            <Download size={14} /> Export history
          </button>
          {pendingAmount > 0 && (
            <button type="button" className="btn btn-primary btn-sm" onClick={recordPartnerCash} disabled={collectingPartner}>
              <Banknote size={14} /> {collectingPartner ? 'Saving…' : `Collect all · ${money(pendingAmount)}`}
            </button>
          )}
        </div>
      </div>

      <div className="card card-pad-none" style={{ margin: 0 }}>
        <div style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Package size={15} style={{ color: 'var(--muted)' }} /> Order History
          </div>
          <div className="flex gap-2 wrap mb-2">
            {DETAIL_STATUSES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`btn btn-xs ${status === value ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => { setPage(1); setStatus(value) }}
              >
                {label}
              </button>
            ))}
          </div>
          <form
            onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()) }}
            style={{ position: 'relative', marginBottom: 8 }}
          >
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input className="input" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search order…" style={{ paddingLeft: 30, height: 34 }} />
          </form>
          <div className="flex items-center gap-2 wrap mb-3">
            <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ height: 32, width: 140 }} />
            <span className="muted text-xs">to</span>
            <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ height: 32, width: 140 }} />
            <button type="button" className="btn btn-outline btn-xs" onClick={() => { setPage(1); setDates({ from: dateFrom, to: dateTo }) }}>Apply</button>
          </div>
          {loading && <Skeleton height={120} />}
          {!loading && error && <div className="alert alert-error">{errorMessage(error)}</div>}
          {!loading && rows.length === 0 && (
            <div className="muted text-xs" style={{ padding: 20, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>
              No COD records match these filters.
            </div>
          )}
          {!loading && rows.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              {rows.map(record => (
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
            <span className="muted text-xs">{pagination.total || 0} records</span>
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-outline btn-xs" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}>Previous</button>
              <span className="muted text-xs">{pagination.current_page || page} / {pagination.last_page || 1}</span>
              <button type="button" className="btn btn-outline btn-xs" disabled={page >= (pagination.last_page || 1) || loading} onClick={() => setPage(current => current + 1)}>Next</button>
            </div>
          </div>
        </div>
      </div>
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
