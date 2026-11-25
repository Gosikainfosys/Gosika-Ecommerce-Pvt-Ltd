import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, RotateCcw, Check, X, Zap, RefreshCw,
  ShoppingBag, Store, Truck, User, AlertCircle,
  CreditCard, MapPin, ChevronRight, Package
} from 'lucide-react'
import api from '../../api/client'
import PageHeader from '../../components/admin/PageHeader'
import ConfirmDialog from '../../components/admin/ConfirmDialog'
import { Skeleton } from '../../components/ui/Skeleton'
import ErrorState from '../../components/admin/ErrorState'
import { money, formatDateTime, timeAgo, apiImage, getProductImage, handleImgError } from '../../utils/format'
import { useToast } from '../../context/ToastContext'

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const getStatusLabel = s => ({
  refund_pending: 'Refund Processing',
  under_review: 'Under Review',
  return_refund: 'Return & Refund',
})[s] || String(s || '—').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())

const getReturnType = item =>
  ({ return_refund: 'Return & Refund', exchange: 'Exchange', replacement: 'Replacement' })[item?.request_type]
  || (item?.request_type ? item.request_type.replace(/_/g, ' ') : 'Return')

const statusColor = s => ({
  refunded: { bg: '#dcfce7', color: '#15803d', border: '#86efac' },
  approved: { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
  rejected: { bg: '#fee2e2', color: '#dc2626', border: '#fca5a5' },
  cancelled: { bg: '#f1f5f9', color: '#64748b', border: '#cbd5e1' },
  completed: { bg: '#dcfce7', color: '#15803d', border: '#86efac' },
  refund_pending: { bg: '#fef3c7', color: '#d97706', border: '#fcd34d' },
  collected: { bg: '#ede9fe', color: '#7c3aed', border: '#c4b5fd' },
  inspected: { bg: '#f0fdf4', color: '#16a34a', border: '#86efac' },
})[s] || { bg: '#f1f5f9', color: '#64748b', border: '#cbd5e1' }

const refundable = item => {
  const qty = Math.max(1, Number(item?.order_item?.quantity || 1))
  const retQty = Math.max(1, Number(item?.quantity || 1))
  return (Number(item?.order_item?.line_total || 0) / qty) * retQty
}

const alreadyRefunded = refunds =>
  (refunds || [])
    .filter(r => r.status === 'refunded')
    .reduce((s, r) => s + Number(r.amount || 0), 0)

const reservedRefunds = refunds =>
  (refunds || [])
    .filter(r => ['requested', 'approved', 'processing', 'refunded'].includes(r.status))
    .reduce((s, r) => s + Number(r.amount || 0), 0)

/* ─── sub-components ──────────────────────────────────────────────────────── */
function InfoCard({ icon: Icon, title, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Icon size={14} style={{ color: 'var(--muted)' }} />
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function StatusChip({ status }) {
  const c = statusColor(status)
  return (
    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: c.bg, color: c.color, border: `1px solid ${c.border}`, textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {getStatusLabel(status)}
    </span>
  )
}

/* ─── Refund Panel ────────────────────────────────────────────────────────── */
function RefundPanel({ returnItem, onRefunded, onApprove, onReject }) {
  const toast = useToast()
  const isEsewa = returnItem?.order?.payment_method === 'esewa'
  const maxAmt = refundable(returnItem)
  const refundedAmt = alreadyRefunded(returnItem?.refunds)
  const remaining = Math.max(0, maxAmt - reservedRefunds(returnItem?.refunds))
  const refunds = returnItem?.refunds || []

  /* create-refund form */
  const [type, setType] = useState('full')
  const [partialAmt, setPartialAmt] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)

  /* refund status drafts (manual fallback) */
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [processingEsewaId, setProcessingEsewaId] = useState(null)

  const effectiveAmt = type === 'full' ? remaining : Number(partialAmt || 0)
  const invalid = effectiveAmt <= 0 || effectiveAmt > remaining + 0.001

  const canRefund = (!returnItem?.request_type || returnItem?.request_type === 'return_refund')
    && ['collected', 'inspected', 'approved'].includes(returnItem?.status)
    && remaining > 0.001

  const createRefund = async () => {
    if (invalid) return
    setCreating(true)
    try {
      await api.post(`/admin/orders/returns/${returnItem.uuid || returnItem.id}/refund`, {
        method: returnItem?.order?.payment_method || 'esewa',
        amount: effectiveAmt,
        refund_type: type,
        notes: notes || null,
      })
      toast.success(`${type === 'full' ? 'Full' : 'Partial'} refund of ${money(effectiveAmt)} created.`)
      setPartialAmt('')
      setNotes('')
      onRefunded()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create refund.')
    } finally {
      setCreating(false)
    }
  }

  const saveStatus = async (refund) => {
    const id = refund.uuid || refund.id
    const draft = drafts[id] || { status: refund.status, provider_refund_id: refund.provider_refund_id || '' }
    setSavingId(id)
    try {
      await api.patch(`/admin/orders/returns/${returnItem.uuid || returnItem.id}/refunds/${id}/status`, {
        status: draft.status,
        provider_refund_id: draft.provider_refund_id.trim() || undefined,
      })
      toast.success('Refund status updated.')
      onRefunded()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update refund status.')
    } finally {
      setSavingId(null)
    }
  }

  const processEsewa = async (refund) => {
    const id = refund.uuid || refund.id
    setProcessingEsewaId(id)
    try {
      await api.post(`/admin/orders/returns/${returnItem.uuid || returnItem.id}/refunds/${id}/esewa-process`)
      toast.success('Refund verified and synced via eSewa.')
      onRefunded()
    } catch (err) {
      const msg = err.response?.data?.message || 'eSewa processing failed.'
      toast.error(msg)
    } finally {
      setProcessingEsewaId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Summary banner ── */}
      <div style={{ background: '#f8fafc', borderRadius: 12, padding: '14px 18px', display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center', border: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Requested</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)' }}>{money(maxAmt)}</div>
        </div>
        {refundedAmt > 0 && (
          <div>
            <div style={{ fontSize: 11, color: '#15803d', fontWeight: 700, textTransform: 'uppercase' }}>Refunded</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#15803d' }}>−{money(refundedAmt)}</div>
          </div>
        )}
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: remaining < 0.01 ? '#15803d' : '#dc2626', fontWeight: 700, textTransform: 'uppercase' }}>
            {remaining < 0.01 ? 'Fully Refunded' : 'Remaining'}
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: remaining < 0.01 ? '#15803d' : '#dc2626' }}>
            {money(remaining)}
          </div>
        </div>
      </div>

      {/* ── Create refund section ── */}
      {canRefund && (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RotateCcw size={15} /> Create Refund
          </div>

          {/* Type toggle */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              { value: 'full', label: 'Full Refund', sub: money(remaining), icon: '↩', active: '#16a34a', light: '#f0fdf4' },
              { value: 'partial', label: 'Partial Refund', sub: 'Enter amount', icon: '↪', active: '#d97706', light: '#fffbeb' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { setType(opt.value); if (opt.value === 'full') setPartialAmt('') }}
                style={{
                  padding: '12px 14px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                  border: `2px solid ${type === opt.value ? opt.active : 'var(--border)'}`,
                  background: type === opt.value ? opt.light : '#f8fafc',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 16, marginBottom: 2 }}>{opt.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{opt.label}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: type === opt.value ? opt.active : 'var(--muted)', marginTop: 1 }}>{opt.sub}</div>
              </button>
            ))}
          </div>

          {/* Full amount display */}
          {type === 'full' && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>Full amount to refund</span>
              <span style={{ fontSize: 20, fontWeight: 900, color: '#15803d' }}>{money(remaining)}</span>
            </div>
          )}

          {/* Partial input */}
          {type === 'partial' && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Partial Amount</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: 'var(--muted)', fontSize: 13, pointerEvents: 'none' }}>NPR</span>
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  max={remaining.toFixed(2)}
                  step="0.01"
                  autoFocus
                  value={partialAmt}
                  onChange={e => setPartialAmt(e.target.value)}
                  placeholder="0.00"
                  style={{ paddingLeft: 46, height: 44, fontSize: 16, fontWeight: 700, borderRadius: 8, borderColor: invalid && partialAmt !== '' ? '#dc2626' : undefined }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ fontSize: 11, color: invalid && partialAmt !== '' ? '#dc2626' : 'var(--muted)' }}>
                  {invalid && partialAmt !== '' ? `Must be 0.01 – ${money(remaining)}` : `Up to ${money(remaining)}`}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[25, 50, 75, 100].map(pct => (
                    <button key={pct} type="button" className="btn btn-ghost btn-xs"
                      style={{ fontSize: 10, padding: '2px 7px', fontWeight: 700 }}
                      onClick={() => setPartialAmt((remaining * pct / 100).toFixed(2))}>
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Notes (optional)</label>
            <textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Administrative note for this refund..."
              style={{ fontSize: 13, borderRadius: 8, resize: 'vertical' }} />
          </div>

          {/* Info callout */}
          <div style={{ fontSize: 12, color: 'var(--muted)', background: '#f8fafc', padding: '8px 12px', borderRadius: 8, lineHeight: 1.6, borderLeft: `3px solid ${isEsewa ? '#60bb46' : 'var(--border)'}`, marginBottom: 14 }}>
            {isEsewa
              ? <>Creates a <strong>{type === 'full' ? 'Full' : 'Partial'}</strong> refund record of <strong>{money(effectiveAmt)}</strong>. Use <strong style={{ color: '#16a34a' }}>⚡ Process via eSewa</strong> below on the created record to trigger the payout instantly.</>
              : <>Creates a <strong>{type === 'full' ? 'Full' : 'Partial'}</strong> refund of <strong>{money(effectiveAmt)}</strong> via <strong>{(returnItem?.order?.payment_method || 'gateway').toUpperCase()}</strong>. Finalize it in the refund records below.</>
            }
          </div>

          <button
            type="button"
            className="btn"
            disabled={creating || invalid}
            onClick={createRefund}
            style={{ width: '100%', fontWeight: 800, fontSize: 14, background: type === 'full' ? '#16a34a' : '#d97706', color: '#fff', border: 'none', opacity: invalid ? 0.5 : 1, borderRadius: 10, padding: '10px 0' }}
          >
            {creating ? 'Creating…' : type === 'full' ? `↩ Create Full Refund · ${money(remaining)}` : `↪ Create Partial Refund · ${money(effectiveAmt)}`}
          </button>
        </div>
      )}

      {/* ── Existing refund records ── */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertCircle size={15} /> Refund Records
        </div>

        {refunds.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No refund records yet.</div>
        )}

        {refunds.map(refund => {
          const rid = refund.uuid || refund.id
          const draft = drafts[rid] || { status: refund.status, provider_refund_id: refund.provider_refund_id || '' }
          const refundAmt = Number(refund.amount || 0)
          // Trust the stored refund_type first. When absent (older records), fall back to
          // comparing the refund amount against the total refundable for this return (maxAmt).
          const isPartial = refund.refund_type
            ? refund.refund_type === 'partial'
            : maxAmt > 0 && refundAmt < maxAmt - 0.01
          const done = refund.status === 'refunded'

          return (
            <div key={rid} style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--ink)' }}>{refund.refund_number || 'Refund'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {formatDateTime(refund.created_at)} · via {(refund.payment?.method || returnItem?.order?.payment_method || '—').toUpperCase()}
                  </div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20,
                  background: isPartial ? '#fef3c7' : '#dcfce7',
                  color: isPartial ? '#d97706' : '#15803d',
                  border: `1px solid ${isPartial ? '#fcd34d' : '#86efac'}`,
                  textTransform: 'uppercase',
                }}>
                  {isPartial ? 'Partial' : 'Full'}
                </span>
                <StatusChip status={refund.status} />
                <span style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)' }}>{money(refundAmt)}</span>
              </div>

              {refund.provider_refund_id && (
                <div style={{ fontSize: 11, color: '#15803d', marginBottom: 8 }}>
                  Ref: <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{refund.provider_refund_id}</span>
                </div>
              )}

              {/* eSewa process and status verification */}
              {!done && isEsewa && (
                <div style={{ minWidth: 0, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: '#15803d', marginBottom: 8 }}>
                    Click below to send this {isPartial ? 'partial' : 'full'} refund of{' '}
                    <strong>{money(refundAmt)}</strong> directly to the customer via eSewa.
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={processingEsewaId === rid}
                    onClick={() => processEsewa(refund)}
                    style={{
                      width: '100%',
                      background: '#16a34a',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: 13,
                      borderRadius: 8,
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      boxSizing: 'border-box',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    <Zap size={14} style={{ flexShrink: 0 }} />
                    {processingEsewaId === rid
                      ? 'Processing…'
                      : `Process ${isPartial ? 'Partial' : 'Full'} Refund via eSewa · ${money(refundAmt)}`}
                  </button>
                </div>
              )}

              {/* Manual status update */}
              {!done && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer', userSelect: 'none', fontWeight: 600 }}>
                    {isEsewa ? '▶ Manual override (if eSewa API unavailable)' : 'Update refund status manually'}
                  </summary>
                  <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                    {isEsewa && (
                      <a
                        href="https://merchant.esewa.com.np/"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}
                      >
                        Open eSewa Merchant Portal ↗
                      </a>
                    )}
                    <select className="input"
                      value={draft.status}
                      onChange={e => setDrafts(d => ({ ...d, [rid]: { ...draft, status: e.target.value } }))}>
                      {[['requested','Requested'],['approved','Approved'],['processing','Processing'],['refunded','Refunded / Completed'],['failed','Failed'],['cancelled','Cancelled']]
                        .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <input className="input" placeholder="Gateway ref ID (optional)"
                      value={draft.provider_refund_id}
                      onChange={e => setDrafts(d => ({ ...d, [rid]: { ...draft, provider_refund_id: e.target.value } }))} />
                    <button type="button" className="btn btn-outline btn-sm"
                      disabled={savingId === rid}
                      onClick={() => saveStatus(refund)}>
                      {savingId === rid ? 'Saving…' : 'Save status'}
                    </button>
                  </div>
                </details>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Main Page ───────────────────────────────────────────────────────────── */
export default function AdminReturnDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState({ open: false, action: null, loading: false })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(`/admin/orders/returns/${id}`)
      setItem(res.data?.data || res.data)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load return request.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const handleAction = async (notes) => {
    const { action } = confirmDialog
    setConfirmDialog(d => ({ ...d, loading: true }))
    try {
      if (action === 'approve') {
        await api.post(`/admin/orders/returns/${item.uuid || item.id}/approve`, { notes })
        toast.success('Return approved.')
      } else if (action === 'reject') {
        await api.post(`/admin/orders/returns/${item.uuid || item.id}/reject`, { notes })
        toast.success('Return rejected.')
      }
      setConfirmDialog({ open: false, action: null, loading: false })
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Operation failed.')
      setConfirmDialog(d => ({ ...d, loading: false }))
    }
  }

  const detailOrder = item?.order
  const assignment = (item?.vendor_order?.assignments || item?.order?.vendorOrders?.[0]?.assignments || [])
    .find(a => a.delivered_at) || (item?.vendor_order?.assignments || item?.order?.vendorOrders?.[0]?.assignments || [])[0]
  const deliveryPartner = assignment?.delivery_partner || assignment?.deliveryPartner
  const deliveryName = deliveryPartner?.name
    || [deliveryPartner?.user?.first_name, deliveryPartner?.user?.last_name].filter(Boolean).join(' ')
    || 'Not assigned'

  const isPending = item && ['requested', 'under_review'].includes(item.status)
  const statusC = item ? statusColor(item.status) : {}

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton style={{ height: 36, width: 240, marginBottom: 24 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 16 }}>
          {[1,2,3,4].map(i => <Skeleton key={i} style={{ height: 100, borderRadius: 12 }} />)}
        </div>
      </div>
    )
  }

  if (error) {
    return <ErrorState message={error} onRetry={load} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        title={`Return #${item.return_number || item.id}`}
        description={`${getReturnType(item)} · Order ${detailOrder?.order_number || item.order_id}`}
        breadcrumbs={[
          { label: 'Orders', to: '/admin/orders' },
          { label: 'Returns & Exchanges', to: '/admin/orders/returns' },
          { label: `#${item.return_number || item.id}` },
        ]}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-outline btn-sm"
              onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={14} /> Refresh
            </button>
            {isPending && (
              <>
                <button type="button" className="btn btn-sm"
                  style={{ background: '#16a34a', color: '#fff', border: 'none', fontWeight: 700 }}
                  onClick={() => setConfirmDialog({ open: true, action: 'approve', loading: false })}>
                  <Check size={14} /> Approve
                </button>
                <button type="button" className="btn btn-outline btn-sm"
                  style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                  onClick={() => setConfirmDialog({ open: true, action: 'reject', loading: false })}>
                  <X size={14} /> Reject
                </button>
              </>
            )}
          </div>
        }
      />

      {/* Status bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 16px', background: statusC.bg, border: `1px solid ${statusC.border}`, borderRadius: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: statusC.color }}>{getStatusLabel(item.status)}</span>
        <ChevronRight size={14} style={{ color: statusC.color }} />
        <span style={{ fontSize: 13, color: statusC.color }}>{getReturnType(item)}</span>
        {item.review_notes && (
          <span style={{ fontSize: 12, color: statusC.color, marginLeft: 'auto' }}>Note: {item.review_notes}</span>
        )}
        <span style={{ fontSize: 11, color: statusC.color, marginLeft: 'auto' }}>{timeAgo(item.created_at)}</span>
      </div>

      {/* Top 4-card grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 16 }}>
        <InfoCard icon={User} title="Customer">
          <div style={{ fontWeight: 700, fontSize: 14 }}>{item.user?.first_name} {item.user?.last_name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{item.user?.email}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.user?.phone || '—'}</div>
        </InfoCard>

        <InfoCard icon={ShoppingBag} title="Order">
          <Link to={`/admin/orders/${detailOrder?.uuid || detailOrder?.id || item.order_id}`}
            style={{ fontWeight: 700, fontSize: 14, color: 'var(--primary)', textDecoration: 'none' }}>
            #{detailOrder?.order_number || item.order_id}
          </Link>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            Payment: {getStatusLabel(detailOrder?.payment_status)} · {(detailOrder?.payment_method || '—').toUpperCase()}
          </div>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--ink)', marginTop: 4 }}>{money(detailOrder?.grand_total || 0)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            Subtotal {money(detailOrder?.subtotal || 0)} · Delivery {money(detailOrder?.delivery_charge || 0)} · Tax {money(detailOrder?.tax || 0)}
          </div>
        </InfoCard>

        <InfoCard icon={Truck} title="Delivery">
          <div style={{ fontWeight: 700, fontSize: 14 }}>{deliveryName}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {assignment?.delivered_at ? `Delivered ${formatDateTime(assignment.delivered_at)}` : `Status: ${getStatusLabel(assignment?.status)}`}
          </div>
          {deliveryPartner?.phone && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{deliveryPartner.phone}</div>}
          {assignment?.dropoff_address && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>To: {assignment.dropoff_address}</div>}
        </InfoCard>

        <InfoCard icon={Store} title="Store">
          <div style={{ fontWeight: 700, fontSize: 14 }}>{item.store?.name || item.vendor_order?.store?.name || '—'}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Vendor order: {item.vendor_order?.vendor_order_number || '—'}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Delivery: {getStatusLabel(item.vendor_order?.delivery_status || assignment?.status)}</div>
        </InfoCard>
      </div>

      {/* Main two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 20, alignItems: 'start' }}>

        {/* LEFT column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Order items */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShoppingBag size={15} style={{ color: 'var(--muted)' }} />
              <span style={{ fontWeight: 800, fontSize: 14 }}>Order Items</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', minWidth: 500 }}>
                <thead>
                  <tr><th>Product</th><th>SKU / Variant</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr>
                </thead>
                <tbody>
                  {(detailOrder?.items || []).map(oi => (
                    <tr key={oi.uuid || oi.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <img src={oi.image ? apiImage(oi.image) : getProductImage(null)} alt={oi.product_name}
                            onError={handleImgError} style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                          <span style={{ fontWeight: 600 }}>{oi.product_name}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 12 }}>{[oi.sku, oi.variant_name].filter(Boolean).join(' · ') || '—'}</td>
                      <td>{oi.quantity}</td>
                      <td>{money(oi.unit_price || 0)}</td>
                      <td style={{ fontWeight: 700 }}>{money(oi.line_total || 0)}</td>
                    </tr>
                  ))}
                  {!(detailOrder?.items || []).length && <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>No order items.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Return request detail */}
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <RotateCcw size={15} style={{ color: 'var(--muted)' }} /> Return Request
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <span className="chip chip-sm" style={{ background: '#fff7ed', color: '#9a3412', border: '1px solid #fdba74', fontWeight: 800 }}>
                Reason: {String(item.reason_type || '—').replace(/_/g, ' ')}
              </span>
              <span className="chip chip-sm" style={{ background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd', fontWeight: 800 }}>
                Qty returned: {item.quantity || 1}
              </span>
              <span className="chip chip-sm" style={{ background: '#f8fafc', fontWeight: 700 }}>
                {getReturnType(item)}
              </span>
            </div>

            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#9a3412', textTransform: 'uppercase', letterSpacing: 0.5 }}>Customer explanation</div>
              <div style={{ fontSize: 13, marginTop: 4, whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>{item.reason || 'No explanation provided.'}</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
              <div><strong>Preferred resolution:</strong> {item.preferred_resolution || '—'}</div>
              <div><strong>Return method:</strong> {item.return_method === 'pickup' ? 'Courier pickup' : item.return_method === 'drop_off' ? 'Self drop-off' : '—'}</div>
              <div><strong>Pickup collected:</strong> {item.pickup_collected_at ? formatDateTime(item.pickup_collected_at) : 'Not collected'}</div>
              {item.pickup_instructions && <div><strong>Pickup notes:</strong> {item.pickup_instructions}</div>}
            </div>

            {/* Customer media */}
            {(item.media || []).length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Customer photos / videos</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {item.media.map(m => (
                    <a key={m.id} href={apiImage(m.url || m.path)} target="_blank" rel="noopener noreferrer"
                      style={{ width: 80, height: 80, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', display: 'block', flexShrink: 0 }}>
                      {m.type === 'video'
                        ? <video src={apiImage(m.url || m.path)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <img src={apiImage(m.url || m.path)} alt={m.original_name} onError={handleImgError}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Shipping & Payments */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <MapPin size={14} style={{ color: 'var(--muted)' }} /> Shipping Address
              </div>
              {detailOrder?.shipping_address ? (
                <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 600 }}>{detailOrder.shipping_address.full_name || detailOrder.shipping_address.label}</div>
                  <div style={{ color: 'var(--muted)' }}>
                    {[detailOrder.shipping_address.address_line_1, detailOrder.shipping_address.address_line_2,
                      detailOrder.shipping_address.municipality?.name, detailOrder.shipping_address.district?.name,
                      detailOrder.shipping_address.province?.name, detailOrder.shipping_address.postal_code]
                      .filter(Boolean).join(', ')}
                  </div>
                  <div style={{ color: 'var(--muted)' }}>{detailOrder.shipping_address.phone || '—'}</div>
                </div>
              ) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>Address unavailable.</div>}
            </div>

            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CreditCard size={14} style={{ color: 'var(--muted)' }} /> Payments
              </div>
              {(detailOrder?.payments || []).length
                ? detailOrder.payments.map(p => (
                    <div key={p.uuid || p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--muted)' }}>{p.payment_number || p.method} · <StatusChip status={p.status} /></span>
                      <strong>{money(p.amount || 0)}</strong>
                    </div>
                  ))
                : <div style={{ fontSize: 13, color: 'var(--muted)' }}>No payment records.</div>}
            </div>
          </div>
        </div>

        {/* RIGHT column — Refund panel */}
        <div>
          {(!item.request_type || item.request_type === 'return_refund') ? (
            <RefundPanel
              returnItem={item}
              onRefunded={load}
              onApprove={() => setConfirmDialog({ open: true, action: 'approve', loading: false })}
              onReject={() => setConfirmDialog({ open: true, action: 'reject', loading: false })}
            />
          ) : (
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8, color: 'var(--ink)' }}>Refund</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                This return type ({getReturnType(item)}) does not involve a monetary refund.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Approve / Reject dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.open}
        onClose={() => setConfirmDialog({ open: false, action: null, loading: false })}
        onConfirm={handleAction}
        loading={confirmDialog.loading}
        title={confirmDialog.action === 'approve' ? `Approve Return #${item.return_number || item.id}?` : `Reject Return #${item.return_number || item.id}?`}
        message={confirmDialog.action === 'approve' ? 'Approving authorises the item return and refund process.' : 'Rejecting requires a reason for the customer.'}
        variant={confirmDialog.action === 'approve' ? 'success' : 'danger'}
        confirmText={confirmDialog.action === 'approve' ? 'Approve Return' : 'Reject Return'}
        requireReason
        reasonLabel="Decision notes"
        reasonPlaceholder={confirmDialog.action === 'approve' ? 'Notes explaining this approval…' : 'Notes explaining why this is rejected…'}
      />
    </div>
  )
}
