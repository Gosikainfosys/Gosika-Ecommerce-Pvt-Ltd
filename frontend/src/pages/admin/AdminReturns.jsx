import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  RotateCcw, Check, X, Eye, RefreshCw,
  ShoppingBag, Store, User, AlertCircle, Truck, Zap
} from 'lucide-react'
import api from '../../api/client'
import PageHeader from '../../components/admin/PageHeader'
import DataTable from '../../components/admin/DataTable'
import FilterBar from '../../components/admin/FilterBar'
import ConfirmDialog from '../../components/admin/ConfirmDialog'
import { money, formatDateTime, timeAgo, apiImage, getProductImage, handleImgError } from '../../utils/format'
import { useToast } from '../../context/ToastContext'

const maxRefundAmount = item => {
  const purchasedQuantity = Math.max(1, Number(item?.order_item?.quantity || 1))
  const returnedQuantity = Math.max(1, Number(item?.quantity || 1))
  return (Number(item?.order_item?.line_total || 0) / purchasedQuantity) * returnedQuantity
}

const getReturnType = item => {
  return ({
    return_refund: 'Return & Refund',
    exchange: 'Exchange',
    replacement: 'Replacement',
  })[item?.request_type] || (item?.request_type ? item.request_type.replace(/_/g, ' ') : 'Return')
}

const getStatusLabel = status => ({
  refund_pending: 'Refund Processing',
  under_review: 'Under Review',
})[status] || String(status || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())

const getRefundAmounts = item => {
  const requested = Math.max(0, Number(item?.order_item ? maxRefundAmount(item) : item?.refund_amount || 0))
  const refunded = (item?.refunds || [])
    .filter(refund => refund.status === 'refunded')
    .reduce((sum, refund) => sum + Number(refund.amount || 0), 0)
  return {
    requested,
    refunded,
    remaining: Math.max(0, requested - refunded),
  }
}

const getDeliveryAssignment = item => {
  const assignments = item?.vendor_order?.assignments || []
  return assignments.find(assignment => assignment.delivered_at) || assignments[0] || null
}

export default function AdminReturns() {
  const toast = useToast()
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [appliedDates, setAppliedDates] = useState({ from: '', to: '' })
  const [detailItem, setDetailItem] = useState(null)
  const [refundStatusDrafts, setRefundStatusDrafts] = useState({})
  const [savingRefundId, setSavingRefundId] = useState(null)
  const [processingEsewaRefundId, setProcessingEsewaRefundId] = useState(null)

  const [dialogState, setDialogState] = useState({
    isOpen: false,
    action: null, // 'approve' | 'reject' | 'process_refund'
    returnItem: null,
    loading: false
  })

  const [refundDraft, setRefundDraft] = useState({ method: 'esewa', type: 'full', amount: '', notes: '' })

  const loadReturns = async () => {
    setLoading(true)
    try {
      const params = { page, per_page: 15 }
      if (statusFilter && statusFilter !== 'all') {
        params.status = statusFilter
      }
      if (search.trim()) params.search = search.trim()
      if (appliedDates.from) params.date_from = appliedDates.from
      if (appliedDates.to) params.date_to = appliedDates.to

      const res = await api.get('/admin/orders/returns', { params })
      const data = api.unwrapList(res.data)
      setReturns(data)
      if (res.data?.meta?.pagination) {
        setPagination(res.data.meta.pagination)
      } else {
        setPagination({
          current_page: page,
          last_page: 1,
          total: data.length,
          per_page: 15
        })
      }
    } catch (err) {
      toast.error('Failed to load return requests.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReturns()
  }, [page, statusFilter, search, appliedDates])

  const handleAction = (action, item) => {
    setDialogState({
      isOpen: true,
      action,
      returnItem: item,
      loading: false
    })
  }

  const handleConfirmAction = async (notes) => {
    const { action, returnItem } = dialogState
    if (!returnItem) return

    setDialogState(prev => ({ ...prev, loading: true }))
    const targetId = returnItem.uuid || returnItem.id

    try {
      if (action === 'approve') {
        await api.post(`/admin/orders/returns/${targetId}/approve`, { notes })
        toast.success(`Return #${returnItem.return_number || returnItem.id} approved.`)
      } else if (action === 'reject') {
        await api.post(`/admin/orders/returns/${targetId}/reject`, { notes })
        toast.success(`Return #${returnItem.return_number || returnItem.id} rejected.`)
      }

      setDialogState({ isOpen: false, action: null, returnItem: null, loading: false })
      loadReturns()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Operation failed.')
      setDialogState(prev => ({ ...prev, loading: false }))
    }
  }

  const saveRefundStatus = async refund => {
    const refundId = refund.uuid || refund.id
    const draft = refundStatusDrafts[refundId] || {
      status: refund.status,
      provider_refund_id: refund.provider_refund_id || '',
    }

    setSavingRefundId(refundId)
    try {
      const response = await api.patch(`/admin/orders/returns/${detailItem.uuid || detailItem.id}/refunds/${refundId}/status`, {
        status: draft.status,
        provider_refund_id: draft.provider_refund_id.trim() || undefined,
      })
      const updatedRefund = response.data?.data || { ...refund, ...draft }
      const matchesRefund = current => (current.uuid || current.id) === refundId
      setDetailItem(current => current ? {
        ...current,
        refunds: (current.refunds || []).map(existing => matchesRefund(existing) ? { ...existing, ...updatedRefund } : existing),
      } : current)
      setReturns(current => current.map(item => ({
        ...item,
        refunds: (item.refunds || []).map(existing => matchesRefund(existing) ? { ...existing, ...updatedRefund } : existing),
      })))
      setRefundStatusDrafts(current => ({ ...current, [refundId]: {
        status: updatedRefund.status,
        provider_refund_id: updatedRefund.provider_refund_id || '',
      } }))
      toast.success(`Refund #${updatedRefund.refund_number || refund.refund_number || refundId} updated.`)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update refund status.')
    } finally {
      setSavingRefundId(null)
    }
  }

  const processEsewaRefund = async (refund, overrideAmount = null) => {
    if (!detailItem) return
    const refundId = refund.uuid || refund.id
    const returnId = detailItem.uuid || detailItem.id
    setProcessingEsewaRefundId(refundId)
    try {
      const body = overrideAmount != null ? { amount: overrideAmount } : {}
      const response = await api.post(`/admin/orders/returns/${returnId}/refunds/${refundId}/esewa-process`, body)
      const updatedRefund = response.data?.data || { ...refund, status: 'refunded' }
      const matchesRefund = current => (current.uuid || current.id) === refundId
      setDetailItem(current => current ? {
        ...current,
        refunds: (current.refunds || []).map(existing => matchesRefund(existing) ? { ...existing, ...updatedRefund } : existing),
      } : current)
      setReturns(current => current.map(item => ({
        ...item,
        refunds: (item.refunds || []).map(existing => matchesRefund(existing) ? { ...existing, ...updatedRefund } : existing),
      })))
      toast.success(response.data?.message || `Refund #${refund.refund_number || refundId} processed via eSewa.`)
    } catch (err) {
      toast.error(err.response?.data?.message || 'eSewa refund failed. Check the eSewa merchant dashboard.')
    } finally {
      setProcessingEsewaRefundId(null)
    }
  }

  const openRefundDialog = (item) => {
    const max = maxRefundAmount(item)
    setRefundDraft({
      method: item.order?.payment_method || 'esewa',
      type: 'full',
      amount: max > 0 ? max.toFixed(2) : '',
      notes: ''
    })
    setDialogState({ isOpen: true, action: 'process_refund', returnItem: item, loading: false })
  }

  const submitRefund = async () => {
    const { returnItem } = dialogState
    if (!returnItem) return

    const maxAmt = maxRefundAmount(returnItem)
    const effectiveAmount = refundDraft.type === 'full' ? maxAmt : Number(refundDraft.amount || 0)

    if (effectiveAmount <= 0 || effectiveAmount > maxAmt) return

    setDialogState(prev => ({ ...prev, loading: true }))
    try {
      await api.post(`/admin/orders/returns/${returnItem.uuid || returnItem.id}/refund`, {
        method: refundDraft.method,
        amount: effectiveAmount,
        notes: refundDraft.notes || null
      })
      toast.success(
        refundDraft.type === 'full'
          ? `Full refund of ${money(effectiveAmount)} created.`
          : `Partial refund of ${money(effectiveAmount)} created.`
      )
      setDialogState({ isOpen: false, action: null, returnItem: null, loading: false })
      loadReturns()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Refund creation failed.')
      setDialogState(prev => ({ ...prev, loading: false }))
    }
  }

  const columns = [
    {
      header: 'Return #',
      render: item => (
        <span style={{ fontWeight: 800, color: 'var(--ink)', fontSize: 13 }}>
          #{item.return_number || item.id}
        </span>
      )
    },
    {
      header: 'Order Ref',
      render: item => (
        <Link
          to={`/admin/orders/${item.order?.uuid || item.order?.id || item.order_id}`}
          style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}
        >
          #{item.order?.order_number || item.order_id}
        </Link>
      )
    },
    {
      header: 'Customer',
      accessor: item => item.user?.name || item.user?.email || 'Customer',
      render: item => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 13 }}>
            {item.user?.name || `${item.user?.first_name || ''} ${item.user?.last_name || ''}`.trim() || 'Customer'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {item.user?.email || ''}
          </div>
        </div>
      )
    },
    {
      header: 'Product / Store',
      render: item => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img
            src={item.order_item?.image || item.orderItem?.image || item.order_item?.product?.primary_image?.file_path || item.orderItem?.product?.primary_image?.file_path
              ? apiImage(item.order_item?.image || item.orderItem?.image || item.order_item?.product?.primary_image?.file_path || item.orderItem?.product?.primary_image?.file_path)
              : getProductImage(null)}
            alt={item.order_item?.product_name || item.orderItem?.product_name || 'Product'}
            onError={handleImgError}
            style={{ width: 42, height: 42, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--ink)' }}>
              {item.order_item?.product_name || item.orderItem?.product_name || 'Product'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              Store: {item.store?.name || '—'} · Qty: {item.quantity || 1}
            </div>
          </div>
        </div>
      )
    },
    {
      header: 'Reason',
      render: item => (
        <div style={{ maxWidth: 220 }}>
          <span className="chip chip-sm" style={{ background: '#f8fafc', fontWeight: 600, fontSize: 11, marginBottom: 2 }}>
            {item.reason_type ? item.reason_type.replace('_', ' ').toUpperCase() : 'RETURN'}
          </span>
          {item.reason && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.3 }} className="truncate">
              {item.reason}
            </div>
          )}
        </div>
      )
    },
    {
      header: 'Amount to Return',
      align: 'right',
      render: item => {
        if (item.request_type && item.request_type !== 'return_refund') {
          return <span className="muted text-xs">No refund requested</span>
        }
        const amounts = getRefundAmounts(item)
        return (
          <div style={{ minWidth: 130 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Requested {money(amounts.requested)}</div>
            {amounts.refunded > 0 && (
              <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 700 }}>−{money(amounts.refunded)} refunded</div>
            )}
            <div style={{ fontWeight: 800, color: amounts.refunded > 0 ? '#15803d' : '#dc2626', fontSize: 13 }}>
              Remaining {money(amounts.remaining)}
            </div>
          </div>
        )
      }
    },
    {
      header: 'Status',
      render: item => {
        const type = getReturnType(item)
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5 }}>
            <span className="chip chip-sm">{getStatusLabel(item.status)}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Requested: {type}</span>
            {item.pickup_collected_at && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#15803d' }}>
                Pickup collected {formatDateTime(item.pickup_collected_at)}
              </span>
            )}
          </div>
        )
      }
    },
    {
      header: 'Requested',
      render: item => (
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {timeAgo(item.created_at)}
        </span>
      )
    },
    {
      header: 'Actions',
      align: 'right',
      render: item => {
        const isPending = item.status === 'requested' || item.status === 'under_review'
        const canRefund = (!item.request_type || item.request_type === 'return_refund')
          && ['collected', 'inspected'].includes(item.status)
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-outline btn-xs"
              onClick={() => setDetailItem(item)}
              title="View full order and delivery details"
            >
              <Eye size={13} /> Details
            </button>
            {isPending ? (
              <>
                <button
                  type="button"
                  className="btn btn-xs"
                  style={{ background: '#16a34a', color: '#fff', border: 'none' }}
                  onClick={() => handleAction('approve', item)}
                  title="Approve return"
                >
                  <Check size={13} /> Approve
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-xs"
                  style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                  onClick={() => handleAction('reject', item)}
                  title="Reject Return"
                >
                  <X size={13} /> Reject
                </button>
              </>
            ) : canRefund ? (
              <button
                type="button"
                className="btn btn-xs"
                style={{ background: '#ff5500', color: '#fff', border: 'none' }}
                onClick={() => openRefundDialog(item)}
                title="Create a refund against the linked payment"
              >
                <RotateCcw size={13} /> Process Refund
              </button>
            ) : item.status === 'refund_pending' ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>Refund Processing</span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{getStatusLabel(item.status)}</span>
            )}
          </div>
        )
      }
    }
  ]

  const detailOrder = detailItem?.order
  const detailAssignment = getDeliveryAssignment(detailItem)
  const deliveryUser = detailAssignment?.delivery_partner
  const deliveryUserName = deliveryUser?.name
    || deliveryUser?.user?.name
    || [deliveryUser?.user?.first_name, deliveryUser?.user?.last_name].filter(Boolean).join(' ')
    || 'Not assigned'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Returns & Exchanges"
        description="Review the customer-requested return type, record your decision notes, and manage refunds here."
        breadcrumbs={[
          { label: 'Orders', to: '/admin/orders' },
          { label: 'Returns & Exchanges' }
        ]}
        actions={
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={loadReturns}
            style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8 }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        }
      />

      <FilterBar
        search={search}
        onSearchChange={(value) => { setPage(1); setSearch(value) }}
        debounceMs={300}
        searchPlaceholder="Search return, order, customer, or store..."
        statusFilter={statusFilter}
        onStatusChange={(value) => { setPage(1); setStatusFilter(value) }}
        fromDate={fromDate}
        toDate={toDate}
        onFromDateChange={setFromDate}
        onToDateChange={setToDate}
        onApplyFilters={() => {
          setPage(1)
          setAppliedDates({ from: fromDate, to: toDate })
        }}
        statusOptions={[
          { value: 'requested', label: 'Requested' },
          { value: 'under_review', label: 'Under Review' },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'collected', label: 'Collected' },
          { value: 'inspected', label: 'Inspected' },
          { value: 'refund_pending', label: 'Refund Pending' },
          { value: 'refunded', label: 'Refunded' },
          { value: 'completed', label: 'Completed' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
        onReset={() => {
          setSearch('')
          setStatusFilter('all')
          setFromDate('')
          setToDate('')
          setAppliedDates({ from: '', to: '' })
          setPage(1)
        }}
      />

      <DataTable
        columns={columns}
        data={returns}
        loading={loading}
        pagination={pagination}
        onPageChange={setPage}
        emptyTitle="No return requests"
        emptyDescription="There are no customer return or exchange requests matching your filter."
      />

      {detailItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Return and order details"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 998,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 16,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(3px)',
          }}
          onClick={event => { if (event.target === event.currentTarget) setDetailItem(null) }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 900, maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: 'var(--ink)' }}>
                  Return #{detailItem.return_number || detailItem.id}
                </h2>
                <div className="muted text-sm mt-1">
                  Order {detailOrder?.order_number || detailItem.order_id} · {getReturnType(detailItem)} · {getStatusLabel(detailItem.status)}
                </div>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setDetailItem(null)} aria-label="Close details">
                <X size={15} />
              </button>
            </div>

            <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
              <div className="card" style={{ padding: 14, margin: 0 }}>
                <div className="muted text-xs font-bold flex items-center gap-1"><User size={13} /> CUSTOMER</div>
                <div className="font-bold text-sm mt-1">{detailItem.user?.name || `${detailItem.user?.first_name || ''} ${detailItem.user?.last_name || ''}`.trim() || 'Customer'}</div>
                <div className="muted text-xs">{detailItem.user?.email || '—'}</div>
                <div className="muted text-xs">{detailItem.user?.phone || detailItem.user?.phone_number || ''}</div>
              </div>
              <div className="card" style={{ padding: 14, margin: 0 }}>
                <div className="muted text-xs font-bold flex items-center gap-1"><ShoppingBag size={13} /> ORDER</div>
                <div className="font-bold text-sm mt-1">{getStatusLabel(detailOrder?.status)}</div>
                <div className="muted text-xs">Payment: {getStatusLabel(detailOrder?.payment_status)} · {detailOrder?.payment_method || '—'}</div>
                <div className="font-bold text-sm mt-1">Total {money(detailOrder?.grand_total || 0)}</div>
                <div className="muted text-xs">
                  Subtotal {money(detailOrder?.subtotal || 0)} · Discount {money(detailOrder?.discount || 0)}
                </div>
                <div className="muted text-xs">
                  Delivery {money(detailOrder?.delivery_charge || 0)} · Tax {money(detailOrder?.tax || 0)}
                </div>
              </div>
              <div className="card" style={{ padding: 14, margin: 0 }}>
                <div className="muted text-xs font-bold flex items-center gap-1"><Truck size={13} /> DELIVERY</div>
                <div className="font-bold text-sm mt-1">{deliveryUserName}</div>
                <div className="muted text-xs">
                  {detailAssignment?.delivered_at
                    ? `Delivered ${formatDateTime(detailAssignment.delivered_at)}`
                    : `Status: ${getStatusLabel(detailAssignment?.status)}`}
                </div>
                {detailAssignment?.delivery_partner?.phone && (
                  <div className="muted text-xs">{detailAssignment.delivery_partner.phone}</div>
                )}
                {detailAssignment?.dropoff_address && (
                  <div className="muted text-xs mt-1">Delivered to: {detailAssignment.dropoff_address}</div>
                )}
              </div>
              <div className="card" style={{ padding: 14, margin: 0 }}>
                <div className="muted text-xs font-bold flex items-center gap-1"><Store size={13} /> STORE</div>
                <div className="font-bold text-sm mt-1">{detailItem.store?.name || detailItem.vendor_order?.store?.name || '—'}</div>
                <div className="muted text-xs">Vendor order: {detailItem.vendor_order?.vendor_order_number || '—'}</div>
                <div className="muted text-xs">Delivery status: {getStatusLabel(detailItem.vendor_order?.delivery_status || detailAssignment?.status)}</div>
              </div>
            </div>

            <section className="mb-4">
              <h3 className="font-bold text-sm mb-2 flex items-center gap-1"><ShoppingBag size={14} /> Order items</h3>
              <div className="overflow-x-auto" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                <table className="table" style={{ width: '100%', minWidth: 540 }}>
                  <thead>
                    <tr>
                      <th>Product</th><th>SKU / Variant</th><th>Qty</th><th>Unit price</th><th>Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailOrder?.items || []).map(orderItem => (
                      <tr key={orderItem.uuid || orderItem.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <img
                              src={orderItem.image || orderItem.product?.primary_image?.file_path
                                ? apiImage(orderItem.image || orderItem.product?.primary_image?.file_path)
                                : getProductImage(null)}
                              alt={orderItem.product_name || 'Product'}
                              onError={handleImgError}
                              style={{ width: 42, height: 42, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                            />
                            <span>{orderItem.product_name || 'Product'}</span>
                          </div>
                        </td>
                        <td>{[orderItem.sku, orderItem.variant_name].filter(Boolean).join(' · ') || '—'}</td>
                        <td>{orderItem.quantity}</td>
                        <td>{money(orderItem.unit_price || 0)}</td>
                        <td>{money(orderItem.line_total || 0)}</td>
                      </tr>
                    ))}
                    {!(detailOrder?.items || []).length && (
                      <tr><td colSpan={5} className="muted">Order items are unavailable.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
              <div className="card" style={{ padding: 14, margin: 0 }}>
                <h3 className="font-bold text-sm mb-2">Shipping address</h3>
                {detailOrder?.shipping_address ? (
                  <>
                    <div className="text-sm">{detailOrder.shipping_address.full_name || detailOrder.shipping_address.label}</div>
                    <div className="muted text-sm">
                      {[detailOrder.shipping_address.address_line_1, detailOrder.shipping_address.address_line_2, detailOrder.shipping_address.municipality?.name, detailOrder.shipping_address.district?.name, detailOrder.shipping_address.province?.name, detailOrder.shipping_address.postal_code]
                        .filter(Boolean).join(', ')}
                    </div>
                    <div className="muted text-sm">{detailOrder.shipping_address.phone || '—'}</div>
                  </>
                ) : <div className="muted text-sm">Shipping address unavailable.</div>}
                <h3 className="font-bold text-sm mt-3 mb-2">Payments</h3>
                {(detailOrder?.payments || []).length ? detailOrder.payments.map(payment => (
                  <div key={payment.uuid || payment.id} className="flex items-center justify-between gap-2 text-xs py-1">
                    <span>{payment.payment_number || payment.method} · {getStatusLabel(payment.status)}</span>
                    <strong>{money(payment.amount || 0)}</strong>
                  </div>
                )) : <div className="muted text-xs">No payment record.</div>}
              </div>
              <div className="card" style={{ padding: 14, margin: 0 }}>
                <h3 className="font-bold text-sm mb-2 flex items-center gap-1"><RotateCcw size={14} /> Return request</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  <span className="chip chip-sm" style={{ color: '#9a3412', background: '#ffedd5', border: '1px solid #fdba74', fontWeight: 800 }}>
                    Reason: {String(detailItem.reason_type || '—').replace(/_/g, ' ')}
                  </span>
                  <span className="chip chip-sm" style={{ color: '#1d4ed8', background: '#dbeafe', border: '1px solid #93c5fd', fontWeight: 800 }}>
                    Quantity: {detailItem.quantity || 1}
                  </span>
                </div>
                <div style={{ padding: 10, borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa' }}>
                  <div className="text-xs font-bold" style={{ color: '#9a3412' }}>CUSTOMER EXPLANATION</div>
                  <div className="text-sm mt-1" style={{ whiteSpace: 'pre-wrap' }}>{detailItem.reason || 'No additional explanation provided.'}</div>
                </div>
                <div className="text-sm mt-2"><strong>Customer requested:</strong> {getReturnType(detailItem)}</div>
                {(!detailItem.request_type || detailItem.request_type === 'return_refund') && (
                  <div className="mt-2 p-2 rounded text-sm" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
                    <strong>Amount to return:</strong> {money(getRefundAmounts(detailItem).remaining)}
                    <div className="text-xs mt-1" style={{ color: '#9a3412' }}>
                      Requested {money(getRefundAmounts(detailItem).requested)}
                      {getRefundAmounts(detailItem).refunded > 0 && ` · ${money(getRefundAmounts(detailItem).refunded)} already refunded`}
                    </div>
                  </div>
                )}
                <div className="text-sm mt-1"><strong>Preferred resolution:</strong> {detailItem.preferred_resolution || '—'}</div>
                <div className="text-sm mt-1"><strong>Return method:</strong> {detailItem.return_method === 'pickup' ? 'Courier pickup' : detailItem.return_method === 'drop_off' ? 'Self drop-off' : '—'}</div>
                <div className="text-sm mt-1"><strong>Pickup:</strong> {detailItem.pickup_collected_at ? `Collected ${formatDateTime(detailItem.pickup_collected_at)}` : 'Not collected'}</div>
                {detailItem.pickup_instructions && <div className="text-sm mt-1"><strong>Pickup notes:</strong> {detailItem.pickup_instructions}</div>}
                {detailItem.review_notes && (
                  <div className="mt-2 p-2 rounded text-sm" style={{ background: '#f1f5f9', border: '1px solid var(--border)' }}>
                    <strong>Review notes:</strong> {detailItem.review_notes}
                  </div>
                )}
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="text-xs font-bold uppercase mb-2">Customer photos / videos</div>
                  {(detailItem.media || []).length ? (
                    <div className="flex flex-wrap gap-2">
                      {detailItem.media.map(media => (
                        <a
                          key={media.id}
                          href={apiImage(media.url || media.path)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={media.original_name || 'Return evidence'}
                          style={{ width: 88, height: 88, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          {media.type === 'video' ? (
                            <video src={apiImage(media.url || media.path)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <img
                              src={apiImage(media.url || media.path)}
                              alt={media.original_name || 'Return evidence'}
                              onError={handleImgError}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          )}
                        </a>
                      ))}
                    </div>
                  ) : <div className="muted text-sm">No photos or videos were attached.</div>}
                </div>
              </div>
              <div className="card" style={{ padding: 14, margin: 0 }}>
                <h3 className="font-bold text-sm mb-2 flex items-center gap-1"><AlertCircle size={14} /> Refunds</h3>
                {(detailItem.refunds || []).length ? detailItem.refunds.map(refund => (
                  <div key={refund.uuid || refund.id} className="py-2" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span>{refund.refund_number || 'Refund'} · {getStatusLabel(refund.status)}</span>
                      <strong>{money(refund.amount || 0)}</strong>
                    </div>
                    {refund.status !== 'refunded' && (
                      <div className="grid gap-2 mt-2">
                        {/* eSewa direct refund — full or partial based on refund amount vs payment amount */}
                        {detailOrder?.payment_method === 'esewa' && (() => {
                          const refundAmt = Number(refund.amount || 0)
                          const paymentAmt = Number(detailOrder?.payments?.[0]?.amount || 0)
                          const isPartialRefund = paymentAmt > 0 && refundAmt < paymentAmt - 0.001
                          const isProcessing = processingEsewaRefundId === (refund.uuid || refund.id)
                          return (
                            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{
                                  fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 20,
                                  background: isPartialRefund ? '#fef3c7' : '#dcfce7',
                                  color: isPartialRefund ? '#d97706' : '#15803d',
                                  border: `1px solid ${isPartialRefund ? '#fcd34d' : '#86efac'}`,
                                  textTransform: 'uppercase', letterSpacing: 0.5
                                }}>
                                  {isPartialRefund ? 'Partial' : 'Full'} Refund
                                </span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{money(refundAmt)}</span>
                                {isPartialRefund && paymentAmt > 0 && (
                                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>of {money(paymentAmt)} paid</span>
                                )}
                              </div>
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={isProcessing}
                                onClick={() => processEsewaRefund(refund)}
                                style={{ background: '#16a34a', color: '#fff', border: 'none', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
                                title="Trigger the refund directly via the eSewa API"
                              >
                                <Zap size={13} />
                                {isProcessing ? 'Processing via eSewa…' : `Process ${isPartialRefund ? 'Partial ' : 'Full '}Refund via eSewa`}
                              </button>
                            </div>
                          )
                        })()}
                        <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginBottom: 4 }}>
                          {detailOrder?.payment_method === 'esewa'
                            ? 'Or manually update the status below after confirming in the eSewa merchant dashboard:'
                            : 'Update status manually:'}
                        </div>
                        <select
                          className="input"
                          aria-label={`Refund status for ${refund.refund_number || refund.id}`}
                          value={(refundStatusDrafts[refund.uuid || refund.id] || {}).status || refund.status}
                          onChange={event => {
                            const id = refund.uuid || refund.id
                            setRefundStatusDrafts(current => ({
                              ...current,
                              [id]: {
                                status: event.target.value,
                                provider_refund_id: current[id]?.provider_refund_id ?? refund.provider_refund_id ?? '',
                              },
                            }))
                          }}
                        >
                          {[
                            ['requested', 'Requested'],
                            ['approved', 'Approved'],
                            ['processing', 'Processing'],
                            ['refunded', 'Refunded / Completed'],
                            ['failed', 'Failed'],
                            ['cancelled', 'Cancelled'],
                          ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <input
                          className="input"
                          aria-label={`Gateway refund reference for ${refund.refund_number || refund.id}`}
                          placeholder="Gateway refund reference (optional)"
                          value={(refundStatusDrafts[refund.uuid || refund.id] || {}).provider_refund_id ?? refund.provider_refund_id ?? ''}
                          onChange={event => {
                            const id = refund.uuid || refund.id
                            setRefundStatusDrafts(current => ({
                              ...current,
                              [id]: {
                                status: current[id]?.status || refund.status,
                                provider_refund_id: event.target.value,
                              },
                            }))
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-outline btn-xs"
                          disabled={savingRefundId === (refund.uuid || refund.id)}
                          onClick={() => saveRefundStatus(refund)}
                        >
                          {savingRefundId === (refund.uuid || refund.id) ? 'Saving...' : 'Save refund status'}
                        </button>
                      </div>
                    )}
                    {refund.status === 'refunded' && refund.provider_refund_id && (
                      <div style={{ fontSize: 11, color: '#15803d', marginTop: 4 }}>
                        eSewa ref: <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{refund.provider_refund_id}</span>
                      </div>
                    )}
                  </div>
                )) : <div className="muted text-sm">No refund processing has been started.</div>}
                <div className="muted text-xs mt-2">
                  Order total {money(detailOrder?.grand_total || 0)} · {detailOrder?.currency || 'NPR'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Process Refund Dialog */}
      {dialogState.isOpen && dialogState.action === 'process_refund' && dialogState.returnItem && (() => {
        const maxAmt = maxRefundAmount(dialogState.returnItem)
        const isEsewa = refundDraft.method === 'esewa'
        const isFull = refundDraft.type === 'full'
        const effectiveAmount = isFull ? maxAmt : Number(refundDraft.amount || 0)
        const amountInvalid = effectiveAmount <= 0 || effectiveAmount > maxAmt
        return (
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
            onClick={e => { if (e.target === e.currentTarget) setDialogState({ isOpen: false, action: null, returnItem: null, loading: false }) }}
          >
            <div
              className="card"
              style={{ width: '100%', maxWidth: 500, background: '#fff', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
                    Process Refund — Return #{dialogState.returnItem.return_number || dialogState.returnItem.id}
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                    Order #{dialogState.returnItem.order?.order_number || dialogState.returnItem.order_id}
                    {' · '}{dialogState.returnItem.order_item?.product_name || 'Product'}
                    {' · '}Max refundable: <strong>{money(maxAmt)}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => setDialogState({ isOpen: false, action: null, returnItem: null, loading: false })}
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Refund type toggle */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>Refund Type</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { value: 'full', label: 'Full Refund', desc: money(maxAmt), icon: '↩' },
                    { value: 'partial', label: 'Partial Refund', desc: 'Enter amount', icon: '↪' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRefundDraft(d => ({
                        ...d,
                        type: opt.value,
                        amount: opt.value === 'full' ? maxAmt.toFixed(2) : '',
                      }))}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 10,
                        border: `2px solid ${refundDraft.type === opt.value ? (opt.value === 'full' ? '#16a34a' : '#d97706') : 'var(--border)'}`,
                        background: refundDraft.type === opt.value
                          ? (opt.value === 'full' ? '#f0fdf4' : '#fffbeb')
                          : '#f8fafc',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: 15, marginBottom: 2 }}>{opt.icon}</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: refundDraft.type === opt.value ? (opt.value === 'full' ? '#16a34a' : '#d97706') : 'var(--muted)', fontWeight: 600 }}>
                        {opt.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Partial amount input — only shown when partial selected */}
              {!isFull && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    Partial Refund Amount
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{
                      position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                      fontWeight: 700, color: 'var(--muted)', fontSize: 13, pointerEvents: 'none'
                    }}>NPR</span>
                    <input
                      className="input"
                      type="number"
                      min="0.01"
                      max={maxAmt.toFixed(2)}
                      step="0.01"
                      autoFocus
                      value={refundDraft.amount}
                      onChange={e => setRefundDraft(d => ({ ...d, amount: e.target.value }))}
                      style={{ paddingLeft: 46, height: 42, fontSize: 15, borderRadius: 8, fontWeight: 700,
                        borderColor: amountInvalid && refundDraft.amount !== '' ? '#dc2626' : undefined }}
                      placeholder="0.00"
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                    <span style={{ fontSize: 11, color: amountInvalid && refundDraft.amount !== '' ? '#dc2626' : 'var(--muted)' }}>
                      {amountInvalid && refundDraft.amount !== ''
                        ? `Must be between 0.01 and ${money(maxAmt)}`
                        : `Up to ${money(maxAmt)}`}
                    </span>
                    {/* Quick-fill shortcuts */}
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[25, 50, 75, 100].map(pct => (
                        <button
                          key={pct}
                          type="button"
                          className="btn btn-ghost btn-xs"
                          style={{ fontSize: 10, padding: '2px 6px', fontWeight: 700 }}
                          onClick={() => setRefundDraft(d => ({ ...d, amount: (maxAmt * pct / 100).toFixed(2) }))}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Full refund amount display */}
              {isFull && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>Full amount to refund</span>
                  <span style={{ fontSize: 18, fontWeight: 900, color: '#15803d' }}>{money(maxAmt)}</span>
                </div>
              )}

              {/* Payment method */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Payment Gateway</label>
                <select
                  className="input"
                  value={refundDraft.method}
                  onChange={e => setRefundDraft(d => ({ ...d, method: e.target.value }))}
                  style={{ height: 38, fontSize: 13, borderRadius: 8, fontWeight: 600 }}
                >
                  <option value="esewa">eSewa</option>
                  <option value="khalti">Khalti</option>
                  <option value="fonepay">Fonepay</option>
                  <option value="cod">Cash on Delivery</option>
                </select>
              </div>

              {/* Notes */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Notes (optional)</label>
                <textarea
                  className="input"
                  rows={2}
                  value={refundDraft.notes}
                  onChange={e => setRefundDraft(d => ({ ...d, notes: e.target.value }))}
                  placeholder="Administrative note for this refund..."
                  style={{ fontSize: 13, borderRadius: 8 }}
                />
              </div>

              {/* Info callout */}
              <div style={{ fontSize: 12, color: 'var(--muted)', background: '#f8fafc', padding: '8px 12px', borderRadius: 8, lineHeight: 1.6, borderLeft: `3px solid ${isEsewa ? '#60bb46' : 'var(--border)'}` }}>
                {isEsewa ? (
                  <>
                    Creates a <strong>{isFull ? 'Full' : 'Partial'}</strong> refund record of <strong>{money(effectiveAmount)}</strong>.
                    Open the return details and click <strong style={{ color: '#60bb46' }}>⚡ Process via eSewa</strong> to trigger
                    the {isFull ? 'full ' : ''}payout directly — no merchant dashboard visit needed.
                  </>
                ) : (
                  <>
                    Creates a <strong>{isFull ? 'Full' : 'Partial'}</strong> refund of <strong>{money(effectiveAmount)}</strong> via{' '}
                    <strong>{refundDraft.method.toUpperCase()}</strong>. Track and finalize it in the <strong>Refunds</strong> section.
                  </>
                )}
              </div>

              {/* Footer buttons */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setDialogState({ isOpen: false, action: null, returnItem: null, loading: false })}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={dialogState.loading || amountInvalid}
                  onClick={submitRefund}
                  style={{
                    background: isFull ? '#16a34a' : '#d97706',
                    color: '#fff', border: 'none', fontWeight: 700,
                    opacity: amountInvalid ? 0.5 : 1
                  }}
                >
                  {dialogState.loading
                    ? 'Creating…'
                    : isFull
                      ? `Create Full Refund · ${money(maxAmt)}`
                      : `Create Partial Refund · ${money(effectiveAmount)}`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.isOpen && (dialogState.action === 'approve' || dialogState.action === 'reject')}
        onClose={() => setDialogState({ isOpen: false, action: null, returnItem: null, loading: false })}
        onConfirm={handleConfirmAction}
        loading={dialogState.loading}
        title={
          dialogState.action === 'approve'
            ? `Approve Return #${dialogState.returnItem?.return_number || dialogState.returnItem?.id}?`
            : `Reject Return #${dialogState.returnItem?.return_number || dialogState.returnItem?.id}?`
        }
        message={
          dialogState.action === 'approve'
            ? `Approving will authorize the item return of ${money(dialogState.returnItem?.refund_amount || 0)}.`
            : 'Rejecting this return request requires an explanatory reason for the buyer.'
        }
        variant={dialogState.action === 'approve' ? 'success' : 'danger'}
        confirmText={dialogState.action === 'approve' ? 'Approve Return' : 'Reject Return'}
        requireReason
        reasonLabel="Decision notes"
        reasonPlaceholder={dialogState.action === 'approve'
          ? 'Add notes explaining this approval...'
          : 'Add notes explaining why this request is rejected...'}
      />
    </div>
  )
}
