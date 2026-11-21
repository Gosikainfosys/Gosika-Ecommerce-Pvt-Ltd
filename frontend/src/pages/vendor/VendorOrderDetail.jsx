import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronRight, Check, X, PackageCheck, MapPin, Phone, Truck, Printer, FileText, Lock, Clock, Sparkles, AlertCircle } from 'lucide-react'
import api from '../../api/client'
import StatusBadge from '../../components/commerce/StatusBadge'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import ErrorState from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { money, formatDateTime, apiImage, errorMessage, getProductImage } from '../../utils/format'
import { buildOrderDocumentHtml, buildOrderDocumentParts, buildPackingSlipsHtml } from '../../utils/packingSlip'
import { useToast } from '../../context/ToastContext'
import { useBranding } from '../../context/BrandingContext'

const esc = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const printWindow = (html, toast) => {
  const win = window.open('', '_blank', 'width=860,height=1000')
  if (!win) {
    toast.error('Popup blocked. Allow popups for this page to print.')
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 300)
}

export default function VendorOrderDetail() {
  const { id } = useParams()
  const toast = useToast()
  const branding = useBranding()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [cancellationCountdown, setCancellationCountdown] = useState(0)
  const [deadlineCountdown, setDeadlineCountdown] = useState(0)
  const [autoCountdown, setAutoCountdown] = useState(0)

  const load = () => {
    setLoading(true)
    setError(null)
    api.get(`/vendor/orders/${id}`).then((r) => setOrder(r.data.data)).catch((e) => setError(e)).finally(() => setLoading(false))
  }

  useEffect(load, [id])

  useEffect(() => {
    if (order?.status === 'pending') {
      setCancellationCountdown(order.cancellation_window_seconds_remaining || 0)
      setDeadlineCountdown(order.confirmation_deadline_seconds_remaining || 0)
      setAutoCountdown(order.auto_confirmation_seconds_remaining || 0)

      const timer = setInterval(() => {
        setCancellationCountdown(prev => Math.max(0, prev - 1))
        setDeadlineCountdown(prev => Math.max(0, prev - 1))
        setAutoCountdown(prev => Math.max(0, prev - 1))
      }, 1000)

      return () => clearInterval(timer)
    }
  }, [order?.status, order?.cancellation_window_seconds_remaining, order?.confirmation_deadline_seconds_remaining, order?.auto_confirmation_seconds_remaining])

  const formatRemaining = (secs) => {
    if (secs <= 0) return '0s'
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s < 10 ? '0' : ''}${s}s`
    return `${s}s`
  }

  const act = async (path, successMsg, body) => {
    setBusy(true)
    try {
      await api.post(`/vendor/orders/${id}/${path}`, body)
      toast.success(successMsg)
      setRejectOpen(false)
      setReason('')
      load()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton height={80} />
        <Skeleton height={200} />
      </div>
    )
  }

  if (error || !order) {
    return <ErrorState message={errorMessage(error, 'Order not found.')} onRetry={load} />
  }

  const addr = order.shipping_address || order.order?.shipping_address || {}

  const printInvoice = () => {
    const today = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
    const { customerName, customerPhone, addrHtml, billTo, groupsHtml, totalsHtml } = buildOrderDocumentParts(order)
    const metaRows = [
      ['Order #', order.order_number || order.vendor_order_number],
      ['Order Date', formatDateTime(order.created_at)],
      ['Customer', customerName],
      ['Phone', customerPhone],
      ['Payment Method', (order.payment_method || 'COD').toUpperCase()],
      ['Payment Status', (order.payment_status || order.status || 'pending').toUpperCase()],
      ['Currency', order.currency || 'NPR'],
    ]
    const html = buildOrderDocumentHtml(
      'Tax Invoice',
      `Invoice Date: ${today} · Paid via ${esc(String(order.payment_method || 'COD')).toUpperCase()}`,
      metaRows,
      billTo,
      addrHtml,
      groupsHtml,
      totalsHtml,
      `Payment status: ${esc((order.payment_status || 'pending').toUpperCase())}. This is a system-generated tax invoice for order ${esc(order.order_number || order.vendor_order_number)} on the Gosika Marketplace.`
    )
    printWindow(html, toast)
  }

  const printSlip = async () => {
    const win = window.open('', '_blank', 'width=860,height=1000')
    if (!win) {
      toast.error('Popup blocked. Allow popups for this page to print.')
      return
    }

    try {
      const html = await buildPackingSlipsHtml([order], {
        brandName: branding.brand_name || 'GOSIKA',
        logoUrl: branding.logo_dark || branding.logo_light || '',
      })
      win.document.write(html)
      win.document.close()
      win.focus()
      setTimeout(() => win.print(), 300)
    } catch (error) {
      win.close()
      toast.error(errorMessage(error, 'Could not generate the packing slip.'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex items-center gap-1 muted text-sm" aria-label="Breadcrumb">
        <Link to="/vendor/orders">Orders</Link> <ChevronRight size={13} />
        <span className="font-semibold" style={{ color: 'var(--ink)' }}>#{order.order_number || order.vendor_order_number}</span>
      </nav>

      <div className="card">
        <div className="flex items-center justify-between wrap gap-2">
          <div>
            <h2 style={{ fontSize: 18, marginBottom: 4 }}>#{order.order_number || order.vendor_order_number}</h2>
            <div className="muted text-sm">Placed {formatDateTime(order.created_at)} · {order.store_name}</div>
          </div>
          <div className="flex items-center gap-2 wrap">
            <StatusBadge status={order.status} />
            <StatusBadge status={order.delivery_status} />
            {(order.return_categories || []).map(category => (
              <span key={category} className="chip chip-sm">{category}</span>
            ))}
            <Button variant="outline" size="sm" icon={Printer} onClick={printInvoice}>Print Invoice</Button>
            <Button variant="outline" size="sm" icon={FileText} onClick={printSlip}>Packing Slip</Button>
            {order.status === 'pending' && (
              <>
                {cancellationCountdown > 0 || !order.can_confirm ? (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={Lock}
                    disabled={true}
                    title={order.confirmation_blocked_reason || 'Customer cancellation window is active.'}
                    style={{ background: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }}
                  >
                    Locked ({formatRemaining(cancellationCountdown)})
                  </Button>
                ) : (
                  <Button variant="success" size="sm" icon={Check} disabled={busy} onClick={() => act('accept', 'Order accepted')}>
                    Accept
                  </Button>
                )}
                <Button variant="danger-outline" size="sm" icon={X} disabled={busy} onClick={() => setRejectOpen(true)}>
                  Reject
                </Button>
              </>
            )}
            {order.status === 'accepted' && (
              <Button variant="primary" size="sm" icon={PackageCheck} disabled={busy} onClick={() => act('ready-for-pickup', 'Marked ready for pickup')}>
                Ready for pickup
              </Button>
            )}
          </div>
        </div>
      </div>

      {order.status === 'pending' && cancellationCountdown > 0 && (
        <div className="card" style={{ background: '#fef3c7', border: '1px solid #fde68a', padding: '14px 18px' }}>
          <div className="flex items-center justify-between wrap gap-2">
            <div className="flex items-center gap-2">
              <Lock size={16} color="#d97706" />
              <span className="font-bold text-sm" style={{ color: '#92400e' }}>
                Customer Cancellation Window Active
              </span>
            </div>
            <div className="flex items-center gap-1 font-mono text-sm font-bold" style={{ color: '#b45309' }}>
              <Clock size={14} />
              <span>Accept unlocks in {formatRemaining(cancellationCountdown)}</span>
            </div>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#78350f' }}>
            The customer has a mandatory cancellation window. You may accept and confirm this order once the timer expires.
            {order.auto_confirmation_enabled && autoCountdown > 0 && (
              <span style={{ display: 'block', marginTop: 4, fontWeight: 600 }}>
                ✨ Platform automatic confirmation will confirm this order in {formatRemaining(autoCountdown)} if not manually processed.
              </span>
            )}
          </p>
        </div>
      )}

      {order.status === 'pending' && cancellationCountdown === 0 && deadlineCountdown > 0 && (
        <div className="card" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '12px 18px' }}>
          <div className="flex items-center justify-between wrap gap-2">
            <div className="flex items-center gap-2">
              <Check size={16} color="#16a34a" />
              <span className="font-bold text-sm" style={{ color: '#166534' }}>
                Order Ready for Confirmation
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#15803d' }}>
              <Clock size={13} />
              <span>Confirmation deadline: {formatRemaining(deadlineCountdown)} remaining</span>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ fontSize: 16 }} className="mb-2">Items</h3>
          <div className="flex flex-col">
            {(order.items || []).map((it) => (
              <div key={it.id} className="flex items-center gap-3" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <span className="thumb" style={{ width: 44, height: 44 }}>
                  <img
                    src={it.image ? apiImage(it.image) : getProductImage(it)}
                    alt=""
                    className="thumb-img"
                  />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{it.product_name}</div>
                  {it.variant_name && <div className="muted text-xs">{it.variant_name}</div>}
                  <div className="muted text-xs">× {it.quantity} · {money(it.unit_price)}</div>
                </div>
                <div className="font-semibold text-sm">{money(it.line_total)}</div>
              </div>
            ))}
          </div>
          <hr className="divider" />
          <div className="flex flex-col gap-1 text-sm" style={{ maxWidth: 360 }}>
            <div className="flex justify-between"><span className="muted">Subtotal</span><span>{money(order.items_subtotal)}</span></div>
            <div className="flex justify-between"><span className="muted">Delivery</span><span>{Number(order.delivery_charge) > 0 ? money(order.delivery_charge) : 'Free'}</span></div>
            {Number(order.tax) > 0 && <div className="flex justify-between"><span className="muted">Tax</span><span>{money(order.tax)}</span></div>}
            <div className="flex justify-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
              <span className="font-bold">Grand total</span>
              <span style={{ color: Number(order.refunded_amount) > 0 ? '#64748b' : 'var(--primary)', textDecoration: Number(order.refunded_amount) > 0 ? 'line-through' : 'none' }}>
                {money(order.grand_total)}
              </span>
            </div>
            {Number(order.refunded_amount) > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="muted">Refunded</span>
                  <span className="text-danger">−{money(order.refunded_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-bold">Net order amount</span>
                  <span className="font-bold text-success">{money(order.net_total)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between mt-1"><span className="muted">Commission ({order.commission_rate}%)</span><span className="text-danger">-{money(order.commission_amount)}</span></div>
            <div className="flex justify-between">
              <span className="muted font-semibold">{Number(order.refunded_amount) > 0 ? 'You receive after refunds' : 'You receive'}</span>
              <span className="font-bold text-success">{money(order.net_vendor_payable ?? order.vendor_payable)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="card">
            <h3 style={{ fontSize: 16 }} className="flex items-center gap-2 mb-2"><MapPin size={16} color="var(--primary)" /> Delivery address</h3>
            <div className="text-sm">
              <div className="font-semibold" style={{ color: 'var(--ink)', fontSize: 14 }}>
                {addr?.name || addr?.full_name || 'Customer'}
              </div>
              <div className="muted" style={{ marginTop: 2 }}>
                {[addr?.street || addr?.address_line_1, addr?.municipality || addr?.city, addr?.district, addr?.province].filter(Boolean).join(', ') || 'Address not specified'}
              </div>
              {addr?.phone && (
                <div className="muted flex items-center gap-1 mt-1.5" style={{ fontSize: 13, color: 'var(--ink)' }}>
                  <Phone size={13} color="var(--primary)" /> {addr.phone}
                </div>
              )}
            </div>
          </div>

          {order.assignments?.length > 0 && (
            <div className="card">
              <h3 style={{ fontSize: 16 }} className="flex items-center gap-2 mb-2"><Truck size={16} color="var(--primary)" /> Delivery</h3>
              {order.assignments.map((a) => (
                <div key={a.id} className="text-sm flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.delivery_partner_name || 'Delivery partner'}</span>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="muted text-xs">Fee: {money(a.delivery_fee)} · COD: {money(a.cod_amount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onConfirm={() => {
          if (!reason.trim()) return toast.error('Please provide a reason')
          act('reject', 'Order rejected', { reason: reason.trim() })
        }}
        danger
        loading={busy}
        title="Reject this order?"
        confirmText="Reject order"
        message="Let us know why you're rejecting this order so we can inform the customer."
      >
        <div className="mt-2">
          <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Out of stock, unable to fulfil…" />
        </div>
      </ConfirmDialog>
    </div>
  )
}
