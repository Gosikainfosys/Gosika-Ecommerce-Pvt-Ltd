import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banknote, CheckCircle2, Clock, Download, RefreshCw, Search, User } from 'lucide-react'
import api from '../../api/client'
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

export default function AdminCodReconciliation() {
  const toast = useToast()
  const { user } = useAuth()
  const branding = useBranding()
  const navigate = useNavigate()

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

  useEffect(() => { load() }, [load])

  const applySearch = (event) => {
    event.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  const openProfile = (partner) => {
    navigate(`/admin/fulfillment/cod/${partner.id}`)
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
