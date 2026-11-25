import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { RotateCcw, RefreshCw, MapPin, CheckCircle, ChevronRight } from 'lucide-react'
import api from '../../api/client'
import { useApi } from '../../hooks/useApi'
import { useToast } from '../../context/ToastContext'
import { money, formatDateTime, errorMessage } from '../../utils/format'
import DeliveryAssignmentCard from '../../components/delivery/DeliveryAssignmentCard'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'

const RETURN_STATUSES = ['failed', 'returned_to_vendor']

export default function DeliveryReturns() {
  const toast = useToast()
  const assignments = useApi(() => api.get('/delivery-partner/assignments', { params: { per_page: 100 } }))
  const customerReturns = useApi(() => api.get('/delivery-partner/returns', { params: { per_page: 100 } }))
  const [busyId, setBusyId] = useState(null)
  const [confirmReturn, setConfirmReturn] = useState(null)
  const [confirmPickup, setConfirmPickup] = useState(null)

  const items = useMemo(
    () => (assignments.data ?? []).filter((assignment) => RETURN_STATUSES.includes(assignment.status)),
    [assignments.data],
  )

  const pickups = customerReturns.data ?? []

  const handleReturn = async () => {
    if (!confirmReturn) return
    setBusyId(confirmReturn.id)
    try {
      await api.post(`/delivery-partner/assignments/${confirmReturn.id}/return`)
      toast.success('Parcel marked as returned to vendor.')
      setConfirmReturn(null)
      assignments.reload({ silent: true })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const handleConfirmPickup = async () => {
    if (!confirmPickup) return
    const targetId = confirmPickup.id
    const cashRefundDue = Number(confirmPickup.cod_refund_due || 0)
    setBusyId(targetId)
    try {
      const res = await api.post(
        `/delivery-partner/returns/${targetId}/collect`,
        cashRefundDue > 0 ? { cash_refund_amount: cashRefundDue.toFixed(2) } : {},
      )
      const updated = res?.data?.data
      const collectedTime = updated?.pickup_collected_at || new Date().toISOString()

      if (customerReturns.setData) {
        customerReturns.setData(prev =>
          (prev || []).map(p =>
            p.id === targetId
              ? {
                  ...p,
                  pickup_collected_at: collectedTime,
                  cash_refund_amount: updated?.cash_refund_amount ?? p.cash_refund_amount,
                  cash_refund_handed_at: updated?.cash_refund_handed_at ?? p.cash_refund_handed_at,
                  cod_refund_due: updated?.cod_refund_due ?? p.cod_refund_due,
                  status: p.status === 'approved' || p.status === 'pickup_arranged' ? 'collected' : p.status,
                }
              : p
          )
        )
      }

      toast.success(cashRefundDue > 0
        ? `COD refund cash handoff of ${money(cashRefundDue)} confirmed.`
        : 'Customer return pickup confirmed.')
      setConfirmPickup(null)
      customerReturns.reload({ silent: true })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const renderActions = (assignment) => (
    <>
      {assignment.status === 'failed' && (
        <button
          type="button"
          className="btn btn-primary btn-xs flex items-center gap-1"
          onClick={() => setConfirmReturn(assignment)}
          disabled={busyId === assignment.id}
        >
          <RotateCcw size={12} /> {busyId === assignment.id ? 'Returning…' : 'Return to Vendor'}
        </button>
      )}
      <Link to={`/delivery/deliveries/${assignment.id}`} className="btn btn-outline btn-xs flex items-center gap-1">
        View <ChevronRight size={12} />
      </Link>
    </>
  )

  if (assignments.loading || customerReturns.loading) {
    return (
      <div className="w-full flex flex-col gap-4 pb-8">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <Skeleton width={220} height={28} />
        </div>
        <div className="card" style={{ padding: 16, margin: 0 }}>
          <Skeleton height={90} />
        </div>
      </div>
    )
  }

  if (assignments.error || customerReturns.error) {
    return (
      <ErrorState
        message={errorMessage(assignments.error || customerReturns.error)}
        onRetry={() => {
          assignments.reload()
          customerReturns.reload()
        }}
      />
    )
  }

  const total = items.length + pickups.length

  return (
    <div className="w-full flex flex-col gap-4 pb-8">
      <div className="page-header" style={{ marginBottom: 8 }}>
        <div className="page-header-left">
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>Exchanges & Returns</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
            {total} item{total === 1 ? '' : 's'}: failed parcels and approved customer return or exchange pickups assigned to you.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline btn-sm flex items-center gap-1.5"
          onClick={() => {
            assignments.reload({ silent: true })
            customerReturns.reload({ silent: true })
          }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {pickups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>Customer returns & exchanges</h2>
          {pickups.map((pickup) => (
            <div key={pickup.id} className="card" style={{ padding: 16, margin: 0 }}>
              <div className="flex items-center justify-between wrap gap-2 mb-2">
                <div className="flex items-center gap-2 wrap">
                  <span className="font-mono font-bold text-xs" style={{ background: 'var(--primary-50)', color: 'var(--primary)', padding: '3px 8px', borderRadius: 4 }}>
                    {pickup.return_number}
                  </span>
                  <span className="chip chip-sm">{(pickup.type || 'return').replace(/_/g, ' ')}</span>
                  <span className="chip chip-sm">{pickup.status.replace(/_/g, ' ')}</span>
                </div>
                <span className="muted text-xs">Order #{pickup.order_number || pickup.vendor_order_number}</span>
              </div>
              <div className="font-bold text-sm text-ink">
                {pickup.product_name || 'Returned item'} · Qty {pickup.quantity}
              </div>
              {pickup.reason && <div className="muted text-xs mt-1">{pickup.reason}</div>}
              <div className="grid mt-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, fontSize: 12 }}>
                <div style={{ background: 'var(--bg)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
                  <div className="muted font-bold text-xs flex items-center gap-1 mb-1"><MapPin size={12} /> Customer pickup</div>
                  <div className="font-bold text-ink">{pickup.recipient_name || '—'}</div>
                  <div className="muted text-xs mt-0.5">{pickup.pickup_address || '—'}</div>
                  {pickup.recipient_phone && <a className="text-xs" href={`tel:${pickup.recipient_phone}`}>{pickup.recipient_phone}</a>}
                </div>
                <div style={{ background: 'var(--bg)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
                  <div className="muted font-bold text-xs flex items-center gap-1 mb-1"><MapPin size={12} /> Return to vendor</div>
                  <div className="muted text-xs">{pickup.dropoff_address || '—'}</div>
                </div>
              </div>
              {(() => {
                const cashRefundDue = Number(pickup.cod_refund_due || 0)
                const needsCashRefund = pickup.is_cod && cashRefundDue > 0
                const isCollected = Boolean(
                  pickup.pickup_collected_at ||
                  ['collected', 'inspected', 'completed', 'refunded'].includes(pickup.status)
                )

                return (
                  <div className="flex items-center justify-between wrap gap-2 mt-3 pt-2" style={{ borderTop: '1px solid #f1f5f9' }}>
                    <span className="muted text-xs flex items-center gap-1">
                      {isCollected ? (
                        <>
                          <CheckCircle size={14} style={{ color: 'var(--success, #16a34a)' }} />
                          <span style={{ color: 'var(--success, #16a34a)', fontWeight: 600 }}>
                            {needsCashRefund
                              ? `COD cash refund due: ${money(cashRefundDue)}`
                              : pickup.cash_refund_handed_at
                                ? `COD cash refund ${money(pickup.cash_refund_amount)} handed over ${formatDateTime(pickup.cash_refund_handed_at)}`
                                : pickup.pickup_collected_at
                                  ? `Pickup confirmed ${formatDateTime(pickup.pickup_collected_at)}`
                                  : `Pickup completed (${String(pickup.status || '').replace(/_/g, ' ')})`}
                          </span>
                        </>
                      ) : (
                        `Approved ${formatDateTime(pickup.updated_at || pickup.created_at)}`
                      )}
                    </span>
                    {(!isCollected || needsCashRefund) && (
                      <button
                        type="button"
                        className="btn btn-primary btn-xs flex items-center gap-1"
                        onClick={() => setConfirmPickup(pickup)}
                        disabled={busyId === pickup.id}
                      >
                        <CheckCircle size={12} /> {busyId === pickup.id
                          ? 'Confirming…'
                          : needsCashRefund
                            ? `Confirm Cash Refund · ${money(cashRefundDue)}`
                            : 'Confirm Pickup'}
                      </button>
                    )}
                  </div>
                )
              })()}
            </div>
          ))}
        </section>
      )}

      {items.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>Failed delivery parcels</h2>
          {items.map((assignment) => (
            <DeliveryAssignmentCard
              key={assignment.id}
              assignment={assignment}
              actions={renderActions(assignment)}
              date={formatDateTime(assignment.failed_at || assignment.updated_at || assignment.created_at)}
            />
          ))}
        </section>
      )}

      {total === 0 && (
        <EmptyState
          icon={RotateCcw}
          title="No returns or exchanges right now"
          message="Approved customer refunds and exchanges, and failed delivery parcels, will show up here."
        />
      )}

      <ConfirmDialog
        open={!!confirmReturn}
        onClose={() => setConfirmReturn(null)}
        onConfirm={handleReturn}
        loading={busyId === confirmReturn?.id}
        title="Return parcel to vendor?"
        confirmText="Confirm Return"
        message="Confirming returns the parcel to the vendor. Vendor stock will be restored automatically."
      >
        {confirmReturn && (
          <div className="card" style={{ background: 'var(--bg)', padding: 12, margin: 0 }}>
            <div className="font-bold text-sm text-ink">Order #{confirmReturn.order_number || confirmReturn.vendor_order_number}</div>
            <div className="muted text-xs mt-0.5">{confirmReturn.recipient_name} · {money(confirmReturn.delivery_fee)}</div>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!confirmPickup}
        onClose={() => setConfirmPickup(null)}
        onConfirm={handleConfirmPickup}
        loading={busyId === confirmPickup?.id}
        title={Number(confirmPickup?.cod_refund_due || 0) > 0 ? 'Confirm COD cash refund handoff?' : 'Confirm customer return pickup?'}
        confirmText={Number(confirmPickup?.cod_refund_due || 0) > 0 ? 'Confirm Cash Handed Over' : 'Confirm Pickup'}
        message={Number(confirmPickup?.cod_refund_due || 0) > 0
          ? 'Hand this exact approved amount to the customer in cash, then confirm. The refund will be completed and recorded only after this confirmation.'
          : 'Confirm only after you have collected the approved item from the customer. This records the pickup for the original delivery.'}
      >
        {confirmPickup && (
          <div className="card" style={{ background: 'var(--bg)', padding: 12, margin: 0 }}>
            <div className="font-bold text-sm text-ink">{confirmPickup.return_number} · {confirmPickup.product_name}</div>
            <div className="muted text-xs mt-0.5">{confirmPickup.pickup_address}</div>
            {Number(confirmPickup.cod_refund_due || 0) > 0 && (
              <div className="font-bold text-sm mt-2" style={{ color: 'var(--success, #16a34a)' }}>
                Cash to hand to customer: {money(confirmPickup.cod_refund_due)}
              </div>
            )}
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}
