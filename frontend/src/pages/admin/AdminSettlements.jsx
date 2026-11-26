import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, Download, RefreshCw, Building2
} from 'lucide-react'
import api from '../../api/client'
import PageHeader from '../../components/admin/PageHeader'
import StatusBadge from '../../components/commerce/StatusBadge'
import { money, formatDate } from '../../utils/format'
import { useToast } from '../../context/ToastContext'
import { useBranding } from '../../context/BrandingContext'
import { useAuth } from '../../context/AuthContext'
import { exportReportFromRows, companyFromBranding, personLabel } from '../../utils/reportExport'

const STATUS_ORDER = {
  processing: 0,
  hold: 1,
  eligible: 2,
  released: 3,
  paid: 4,
}

const FREQUENCY_LABELS = {
  manual: 'Manual On-Demand',
  daily: 'Daily Batch',
  weekly: 'Weekly (Every Sunday)',
  biweekly: 'Biweekly (1st & 15th)',
  monthly: 'Monthly (1st of month)',
}

const toInputDate = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function AdminSettlements() {
  const { user } = useAuth()
  const branding = useBranding()
  const toast = useToast()
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [payoutFrequency, setPayoutFrequency] = useState('')

  const [generateOpen, setGenerateOpen] = useState(false)
  const [generateForm, setGenerateForm] = useState({ vendor_id: '', period_start: '', period_end: '' })
  const [generating, setGenerating] = useState(false)
  const [vendors, setVendors] = useState([])

  useEffect(() => {
    api.get('/admin/vendors', { params: { per_page: 100 } })
      .then(res => setVendors(api.unwrapList(res.data)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    api.get('/admin/settings/commissions')
      .then(res => setPayoutFrequency(res.data?.data?.payout_frequency || ''))
      .catch(() => toast.error('Failed to load the admin payout schedule setting.'))
  }, [toast])

  const loadSummary = async () => {
    setLoading(true)
    try {
      const params = { group_by_vendor: 1 }
      if (search.trim()) params.search = search.trim()
      const res = await api.get('/admin/wallet/settlements', { params })
      const items = api.unwrapList(res.data).sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99))
      setSummary(items)
    } catch (err) {
      toast.error('Failed to load settlement summaries.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSummary()
  }, [search])

  const selectVendorForGenerate = (vendorId) => {
    const end = new Date()
    const start = new Date()
    switch (payoutFrequency) {
      case 'daily':
        break
      case 'weekly':
        start.setDate(end.getDate() - 6)
        break
      case 'biweekly':
        start.setDate(end.getDate() - 13)
        break
      case 'monthly':
        start.setDate(1)
        break
      default:
        setGenerateForm({ vendor_id: vendorId, period_start: '', period_end: '' })
        return
    }
    setGenerateForm({
      vendor_id: vendorId,
      period_start: toInputDate(start),
      period_end: toInputDate(end),
    })
  }

  const handleGenerateSubmit = async (e) => {
    e.preventDefault()
    setGenerating(true)
    try {
      await api.post('/admin/wallet/settlements/generate', generateForm)
      toast.success('New settlement period batch generated successfully!')
      setGenerateOpen(false)
      setGenerateForm({ vendor_id: '', period_start: '', period_end: '' })
      loadSummary()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to generate settlement statement.')
    } finally {
      setGenerating(false)
    }
  }

  const exportCSV = () => {
    exportReportFromRows({
      columns: [
        { label: 'Store / Vendor' },
        { label: 'Stores' },
        { label: 'Statement Period Start' },
        { label: 'Statement Period End' },
        { label: 'Gross Sales', align: 'right' },
        { label: 'Platform Commission', align: 'right' },
        { label: 'Net Earned', align: 'right' },
        { label: 'Awaiting Settlement', align: 'right' },
        { label: 'Wallet Balance', align: 'right' },
        { label: 'Available Balance', align: 'right' },
        { label: 'Pending Balance', align: 'right' },
        { label: 'Earning Orders', align: 'right' },
        { label: 'Settlement Periods', align: 'right' },
        { label: 'Status' },
      ],
      rows: summary.map(s => [
        s.vendor_name || '',
        (s.stores || []).map(store => store.name).join(', '),
        s.period_start || '',
        s.period_end || '',
        s.gross_sales || 0,
        s.commission_total || 0,
        s.earned_total || 0,
        s.unsettled_balance || 0,
        s.net_payable || 0,
        s.available_balance || 0,
        s.pending_balance || 0,
        s.earning_orders_count || 0,
        s.settlements_count || 0,
        s.status || '',
      ]),
      title: 'Vendor Settlement Summaries',
      subtitle: 'Vendor-level settlement history, store listings, delivered-order earnings, and wallet balances.',
      sectionLabel: 'Settlement Ledger',
      fileName: `gosika_settlements_${new Date().toISOString().slice(0, 10)}`,
      preparedBy: personLabel(user),
      company: companyFromBranding(branding),
    })
    toast.success('Settlements exported as branded report.')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Settlements & Vendor Wallets"
        description="One row per vendor with all stores, delivered-order earnings, current wallet balances, and settlement history. Vendor withdrawals are reviewed on the Payouts page."
        exportInfo="Export includes only the settlement rows currently shown after applied filters."
        breadcrumbs={[
          { label: 'Finance', to: '/admin/finance/payments' },
          { label: 'Settlements' }
        ]}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setGenerateOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8 }}
            >
              <Plus size={14} /> Generate Batch
            </button>

            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={exportCSV}
              style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8 }}
            >
              <Download size={14} /> Export CSV
            </button>

            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={loadSummary}
              style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8 }}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
            </button>
          </div>
        }
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          className="input"
          style={{ maxWidth: 360, height: 36, fontSize: 13 }}
          placeholder="Search by store / vendor name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
          {summary.length} vendor{summary.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="card card-pad-none" style={{ borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                  Store / Vendor
                </th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                  Earning Orders / Settlement Periods
                </th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                  Gross Sales / Total Earned
                </th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                  Available Balance
                </th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                  Commission Earned
                </th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                  Status
                </th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  View Details
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading settlement summaries...</td>
                  </tr>
                ))
              ) : summary.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--ink)' }}>No vendor profiles found.</div>
                    <div style={{ maxWidth: 620, margin: '6px auto 0', fontSize: 12 }}>
                      Vendors and their stores appear here even before they have a settlement or earned orders.
                    </div>
                  </td>
                </tr>
              ) : summary.map(s => (
                <tr
                  key={s.vendor_id}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: s.status === 'processing' ? '#fffbeb' : 'transparent',
                  }}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#eff6ff', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Building2 size={16} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, color: 'var(--ink)', fontSize: 13 }}>
                          {s.vendor_name}
                        </div>
                        {(s.stores || []).map(store => (
                          <div key={store.id} style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                            {store.name} · {store.status}
                          </div>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>
                      {s.earning_orders_count ?? 0} earning order(s)
                    </div>
                    <div style={{ marginTop: 3, fontSize: 11, color: 'var(--muted)' }}>
                      {s.settlements_count ?? 0} settlement period(s)
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, fontSize: 13 }}>
                    {money(s.gross_sales || 0)}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, color: '#16a34a', fontSize: 13 }}>
                    {money(s.available_balance || 0)}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--primary)', fontSize: 13 }}>
                    {money(s.commission_total || 0)}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {s.settlements_count > 0
                      ? <StatusBadge status={s.status} />
                      : <span style={{ fontSize: 11, color: 'var(--muted)' }}>Not generated</span>}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                      <Link
                        to={`/admin/finance/settlements/vendors/${s.vendor_id}`}
                        className="btn btn-outline btn-xs"
                        style={{ textDecoration: 'none' }}
                      >
                        View Details
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generate Batch Modal */}
      {generateOpen && (
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
          onClick={e => { if (e.target === e.currentTarget) setGenerateOpen(false) }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 480,
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
                Generate Periodic Settlement Batch
              </h3>
              <button className="btn btn-ghost btn-xs" onClick={() => setGenerateOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleGenerateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="label" style={{ fontSize: 12, fontWeight: 700 }}>Select Vendor *</label>
                <select
                  className="input"
                  style={{ width: '100%', height: 38, fontSize: 13, fontWeight: 600 }}
                  value={generateForm.vendor_id}
                  onChange={e => selectVendorForGenerate(e.target.value)}
                  required
                >
                  <option value="">Choose a merchant...</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.company_name} (PAN: {v.pan_vat || '—'})</option>
                  ))}
                </select>
                {generateForm.vendor_id && (
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
                    {payoutFrequency === 'manual'
                      ? 'Payout schedule is Manual On-Demand. Choose the period dates for this batch.'
                      : payoutFrequency
                        ? <>Period is shared across vendors and follows the admin payout schedule: <strong>{FREQUENCY_LABELS[payoutFrequency] || payoutFrequency}</strong>. Adjust dates above if needed.</>
                        : 'Choose the period dates for this batch; the admin payout schedule could not be loaded.'}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="label" style={{ fontSize: 12, fontWeight: 700 }}>Period Start *</label>
                  <input
                    type="date"
                    className="input"
                    style={{ width: '100%', height: 38, fontSize: 13 }}
                    value={generateForm.period_start}
                    onChange={e => setGenerateForm({ ...generateForm, period_start: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label" style={{ fontSize: 12, fontWeight: 700 }}>Period End *</label>
                  <input
                    type="date"
                    className="input"
                    style={{ width: '100%', height: 38, fontSize: 13 }}
                    value={generateForm.period_end}
                    onChange={e => setGenerateForm({ ...generateForm, period_end: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setGenerateOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={generating}>
                  {generating ? 'Calculating...' : 'Generate Settlement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}