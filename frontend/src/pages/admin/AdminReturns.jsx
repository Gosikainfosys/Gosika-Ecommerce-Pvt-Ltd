import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { RotateCcw, Check, X, Eye, RefreshCw, ExternalLink } from 'lucide-react'
import api from '../../api/client'
import PageHeader from '../../components/admin/PageHeader'
import DataTable from '../../components/admin/DataTable'
import FilterBar from '../../components/admin/FilterBar'
import ConfirmDialog from '../../components/admin/ConfirmDialog'
import { money, formatDateTime, timeAgo, apiImage, getProductImage, handleImgError } from '../../utils/format'
import { useToast } from '../../context/ToastContext'

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const getReturnType = item =>
  ({ return_refund: 'Return & Refund', exchange: 'Exchange', replacement: 'Replacement' })[item?.request_type]
  || (item?.request_type ? item.request_type.replace(/_/g, ' ') : 'Return')

const getStatusLabel = s => ({
  refund_pending: 'Refund Processing',
  under_review: 'Under Review',
})[s] || String(s || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())

const statusColor = s => ({
  refunded:      { bg: '#dcfce7', color: '#15803d' },
  approved:      { bg: '#dbeafe', color: '#1d4ed8' },
  rejected:      { bg: '#fee2e2', color: '#dc2626' },
  completed:     { bg: '#dcfce7', color: '#15803d' },
  refund_pending:{ bg: '#fef3c7', color: '#d97706' },
  collected:     { bg: '#ede9fe', color: '#7c3aed' },
  inspected:     { bg: '#f0fdf4', color: '#16a34a' },
  cancelled:     { bg: '#f1f5f9', color: '#64748b' },
})[s] || { bg: '#f1f5f9', color: '#64748b' }

const refundAmounts = item => {
  const qty = Math.max(1, Number(item?.order_item?.quantity || 1))
  const retQty = Math.max(1, Number(item?.quantity || 1))
  const requested = (Number(item?.order_item?.line_total || 0) / qty) * retQty
  const refunded = (item?.refunds || []).filter(r => r.status === 'refunded').reduce((s, r) => s + Number(r.amount || 0), 0)
  return { requested, refunded, remaining: Math.max(0, requested - refunded) }
}

/* ─── Component ───────────────────────────────────────────────────────────── */
export default function AdminReturns() {
  const toast = useToast()
  const navigate = useNavigate()
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [appliedDates, setAppliedDates] = useState({ from: '', to: '' })

  const [dialog, setDialog] = useState({ open: false, action: null, item: null, loading: false })

  const load = async () => {
    setLoading(true)
    try {
      const params = { page, per_page: 20 }
      if (statusFilter && statusFilter !== 'all') params.status = statusFilter
      if (search.trim()) params.search = search.trim()
      if (appliedDates.from) params.date_from = appliedDates.from
      if (appliedDates.to) params.date_to = appliedDates.to
      const res = await api.get('/admin/orders/returns', { params })
      const data = api.unwrapList(res.data)
      setReturns(data)
      setPagination(res.data?.meta?.pagination || { current_page: page, last_page: 1, total: data.length, per_page: 20 })
    } catch {
      toast.error('Failed to load return requests.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page, statusFilter, search, appliedDates])

  const handleAction = async (notes) => {
    const { action, item } = dialog
    if (!item) return
    setDialog(d => ({ ...d, loading: true }))
    const targetId = item.uuid || item.id
    try {
      if (action === 'approve') await api.post(`/admin/orders/returns/${targetId}/approve`, { notes })
      else await api.post(`/admin/orders/returns/${targetId}/reject`, { notes })
      toast.success(`Return ${item.return_number || item.id} ${action === 'approve' ? 'approved' : 'rejected'}.`)
      setDialog({ open: false, action: null, item: null, loading: false })
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Operation failed.')
      setDialog(d => ({ ...d, loading: false }))
    }
  }

  const columns = [
    {
      header: 'Return',
      render: item => (
        <Link to={`/admin/orders/returns/${item.uuid || item.id}`}
          style={{ fontWeight: 800, color: 'var(--primary)', fontSize: 13, textDecoration: 'none' }}>
          {item.return_number || item.id}
        </Link>
      )
    },
    {
      header: 'Order Ref',
      render: item => (
        <Link to={`/admin/orders/${item.order?.uuid || item.order?.id || item.order_id}`}
          style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
          {item.order?.order_number || item.order_id}
        </Link>
      )
    },
    {
      header: 'Customer',
      render: item => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 13 }}>
            {item.user?.first_name || item.user?.name || ''} {item.user?.last_name || ''}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.user?.email || ''}</div>
        </div>
      )
    },
    {
      header: 'Product / Store',
      render: item => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img
            src={item.order_item?.image ? apiImage(item.order_item.image) : getProductImage(null)}
            alt={item.order_item?.product_name || 'Product'}
            onError={handleImgError}
            style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--ink)' }}>
              {item.order_item?.product_name || item.orderItem?.product_name || 'Product'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {item.store?.name || '—'} · Qty: {item.quantity || 1}
            </div>
          </div>
        </div>
      )
    },
    {
      header: 'Reason',
      render: item => (
        <div>
          <span className="chip chip-sm" style={{ background: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa', fontSize: 10, fontWeight: 800 }}>
            {(item.reason_type || 'return').replace(/_/g, ' ').toUpperCase()}
          </span>
          {item.reason && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }} className="truncate">{item.reason}</div>}
        </div>
      )
    },
    {
      header: 'Refund',
      align: 'right',
      render: item => {
        if (item.request_type && item.request_type !== 'return_refund') {
          return <span style={{ fontSize: 11, color: 'var(--muted)' }}>No refund</span>
        }
        const a = refundAmounts(item)
        return (
          <div style={{ textAlign: 'right', minWidth: 110 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Requested {money(a.requested)}</div>
            {a.refunded > 0 && <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>−{money(a.refunded)}</div>}
            <div style={{ fontWeight: 800, color: a.remaining < 0.01 ? '#16a34a' : '#dc2626', fontSize: 13 }}>
              {a.remaining < 0.01 ? '✓ Settled' : `Remaining ${money(a.remaining)}`}
            </div>
          </div>
        )
      }
    },
    {
      header: 'Status',
      render: item => {
        const c = statusColor(item.status)
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: c.bg, color: c.color, display: 'inline-block' }}>
              {getStatusLabel(item.status)}
            </span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{getReturnType(item)}</span>
          </div>
        )
      }
    },
    {
      header: 'Requested',
      render: item => <span style={{ fontSize: 12, color: 'var(--muted)' }}>{timeAgo(item.created_at)}</span>
    },
    {
      header: 'Actions',
      align: 'right',
      render: item => {
        const isPending = ['requested', 'under_review'].includes(item.status)
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline btn-xs"
              onClick={() => navigate(`/admin/orders/returns/${item.uuid || item.id}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Eye size={12} /> Details
            </button>
            {isPending && (
              <>
                <button type="button" className="btn btn-xs"
                  style={{ background: '#16a34a', color: '#fff', border: 'none' }}
                  onClick={() => setDialog({ open: true, action: 'approve', item, loading: false })}>
                  <Check size={12} /> Approve
                </button>
                <button type="button" className="btn btn-outline btn-xs"
                  style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                  onClick={() => setDialog({ open: true, action: 'reject', item, loading: false })}>
                  <X size={12} /> Reject
                </button>
              </>
            )}
          </div>
        )
      }
    }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Returns & Exchanges"
        description="Review return requests, approve or reject them, and manage refunds on the detail page."
        breadcrumbs={[{ label: 'Orders', to: '/admin/orders' }, { label: 'Returns & Exchanges' }]}
        actions={
          <button type="button" className="btn btn-outline btn-sm" onClick={load}
            style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8 }}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
        }
      />

      <FilterBar
        search={search}
        onSearchChange={v => { setPage(1); setSearch(v) }}
        debounceMs={300}
        searchPlaceholder="Search return, order, customer, store…"
        statusFilter={statusFilter}
        onStatusChange={v => { setPage(1); setStatusFilter(v) }}
        fromDate={fromDate}
        toDate={toDate}
        onFromDateChange={setFromDate}
        onToDateChange={setToDate}
        onApplyFilters={() => { setPage(1); setAppliedDates({ from: fromDate, to: toDate }) }}
        statusOptions={[
          { value: 'requested',      label: 'Requested' },
          { value: 'under_review',   label: 'Under Review' },
          { value: 'approved',       label: 'Approved' },
          { value: 'rejected',       label: 'Rejected' },
          { value: 'collected',      label: 'Collected' },
          { value: 'inspected',      label: 'Inspected' },
          { value: 'refund_pending', label: 'Refund Pending' },
          { value: 'refunded',       label: 'Refunded' },
          { value: 'completed',      label: 'Completed' },
          { value: 'cancelled',      label: 'Cancelled' },
        ]}
        onReset={() => { setSearch(''); setStatusFilter('all'); setFromDate(''); setToDate(''); setAppliedDates({ from:'', to:'' }); setPage(1) }}
      />

      <DataTable
        columns={columns}
        data={returns}
        loading={loading}
        pagination={pagination}
        onPageChange={setPage}
        emptyTitle="No return requests"
        emptyDescription="No customer return or exchange requests match your filter."
      />

      <ConfirmDialog
        isOpen={dialog.open}
        onClose={() => setDialog({ open: false, action: null, item: null, loading: false })}
        onConfirm={handleAction}
        loading={dialog.loading}
        title={dialog.action === 'approve'
          ? `Approve Return ${dialog.item?.return_number || dialog.item?.id}?`
          : `Reject Return ${dialog.item?.return_number || dialog.item?.id}?`}
        message={dialog.action === 'approve'
          ? `Approving authorises the item return of ${money(dialog.item?.refund_amount || 0)}.`
          : 'Rejecting requires an explanatory reason for the buyer.'}
        variant={dialog.action === 'approve' ? 'success' : 'danger'}
        confirmText={dialog.action === 'approve' ? 'Approve Return' : 'Reject Return'}
        requireReason
        reasonLabel="Decision notes"
        reasonPlaceholder={dialog.action === 'approve'
          ? 'Notes explaining this approval…'
          : 'Notes explaining why this request is rejected…'}
      />
    </div>
  )
}
