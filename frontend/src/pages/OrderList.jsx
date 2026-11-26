import React, { useCallback, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MessageSquare, PackageOpen } from 'lucide-react'
import api from '../api/client'
import { useList } from '../hooks/useApi'
import StatusBadge from '../components/commerce/StatusBadge'
import Pagination from '../components/ui/Pagination'
import FilterBar from '../components/admin/FilterBar'
import { AccountPage, AccountEmpty, AccountError, AccountSkeleton } from './account/AccountUI'
import { money, formatDateTime, apiImage, getProductImage } from '../utils/format'
import { PAYMENT_METHOD_LABELS, PAYMENT_BRAND_LOGOS } from '../utils/constants'
import { useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'processing', label: 'Processing' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const PAGE_TITLE = 'My Orders'
const PAGE_SUBTITLE = 'Manage and track your purchases.'

export default function OrderList({ basePath = '/account/orders' }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { addItem } = useCart()
  const toast = useToast()
  const [reorderingId, setReorderingId] = React.useState(null)
  const status = searchParams.get('status') || ''
  const search = searchParams.get('search') || ''
  const appliedDateFrom = searchParams.get('date_from') || ''
  const appliedDateTo = searchParams.get('date_to') || ''
  const [dateFrom, setDateFrom] = React.useState(appliedDateFrom)
  const [dateTo, setDateTo] = React.useState(appliedDateTo)

  useEffect(() => {
    setDateFrom(appliedDateFrom)
    setDateTo(appliedDateTo)
  }, [appliedDateFrom, appliedDateTo])

  const fetcher = useCallback(
    async (page) => {
      const res = await api.get('/orders', {
        params: {
          page,
          per_page: 10,
          ...(status ? { status } : {}),
          ...(search ? { search } : {}),
          ...(appliedDateFrom ? { date_from: appliedDateFrom } : {}),
          ...(appliedDateTo ? { date_to: appliedDateTo } : {}),
        },
      })
      const payload = res.data
      const raw = payload?.data?.data ?? payload?.data ?? payload
      const pag = payload?.meta?.pagination ?? payload?.data?.meta?.pagination ?? payload?.meta ?? {}
      return {
        data: {
          data: Array.isArray(raw) ? raw : [],
          meta: {
            total: pag.total ?? pag.current ?? 0,
            current_page: pag.current_page ?? page,
            last_page: pag.last_page ?? pag.lastPage ?? 1,
            per_page: pag.per_page ?? 10,
          },
        },
      }
    },
    [status, search, appliedDateFrom, appliedDateTo],
  )

  const { items, meta, page, setPage, loading, error, reload } = useList(fetcher, {
    pageSize: 10,
    deps: [status, search, appliedDateFrom, appliedDateTo],
  })

  const updateQuery = (updates) => {
    const next = Object.fromEntries(searchParams.entries())
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next[key] = value
      else delete next[key]
    })
    setSearchParams(next, { replace: true })
    setPage(1)
  }

  const changeStatus = (value) => {
    updateQuery({ status: value === 'all' ? '' : value })
  }

  const resetFilters = () => {
    setDateFrom('')
    setDateTo('')
    setSearchParams({}, { replace: true })
    setPage(1)
  }

  const reorder = async (event, order) => {
    event.preventDefault()
    event.stopPropagation()
    setReorderingId(order.id)

    let added = 0
    let unavailable = false
    try {
      for (const item of order.items || []) {
        if (!item.product_id) {
          unavailable = true
          continue
        }

        try {
          await addItem({
            productId: item.product_id,
            variantId: item.variant_id || null,
            quantity: item.quantity,
          })
          added += 1
        } catch {
          unavailable = true
        }
      }

      if (added > 0) {
        toast.success(unavailable ? 'Available items were added to your cart.' : 'Order items added to your cart.')
        window.location.assign('/cart')
      } else {
        toast.error('The products in this order are no longer available.')
      }
    } finally {
      setReorderingId(null)
    }
  }

  const filters = (
    <FilterBar
      search={search}
      onSearchChange={value => updateQuery({ search: value.trim() })}
      searchPlaceholder="Search order number or product..."
      debounceMs={350}
      statusFilter={status || 'all'}
      onStatusChange={changeStatus}
      statusOptions={STATUS_TABS.filter(tab => tab.value)}
      segmented
      fromDate={dateFrom}
      toDate={dateTo}
      onFromDateChange={setDateFrom}
      onToDateChange={setDateTo}
      onApplyFilters={() => updateQuery({ date_from: dateFrom, date_to: dateTo })}
      onReset={resetFilters}
    />
  )

  const pageActions = (
    <Link to="/account/orders/active" className="btn btn-outline btn-sm">
      Track active orders
    </Link>
  )

  if (loading) {
    return (
      <AccountPage title={PAGE_TITLE} subtitle={PAGE_SUBTITLE} actions={pageActions}>
        <AccountSkeleton rows={3} />
      </AccountPage>
    )
  }

  if (error) {
    return (
      <AccountPage title={PAGE_TITLE} subtitle={PAGE_SUBTITLE} actions={pageActions}>
        <AccountError onRetry={reload} />
      </AccountPage>
    )
  }

  if (!items.length) {
    return (
      <AccountPage title={PAGE_TITLE} subtitle={PAGE_SUBTITLE} actions={pageActions}>
        {filters}
        <AccountEmpty
          icon={PackageOpen}
          title={status ? 'No orders with this status' : 'No orders yet'}
          message="When you place an order, it will appear here with live tracking."
          action={<Link to="/shop" className="btn btn-primary">Start shopping</Link>}
        />
      </AccountPage>
    )
  }

  return (
    <AccountPage title={PAGE_TITLE} subtitle={PAGE_SUBTITLE} actions={pageActions}>
      {filters}
      <div className="account-order-list">
        {items.map((o) => (
          <div key={o.id} className="card card-hover account-order-card">
            <Link to={`${basePath}/${o.id}`} style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
              <div className="flex items-center justify-between wrap gap-2">
                <div>
                  <div className="flex items-center gap-2 wrap">
                    <span className="font-bold">{o.order_number}</span>
                    <StatusBadge status={o.status} />
                    {o.payment_status && <StatusBadge status={o.payment_status} />}
                  </div>
                  <div className="muted text-sm mt-1">{formatDateTime(o.placed_at)} · {o.items?.length} item(s)</div>
                </div>
                <div className="text-right">
                  <div className="price-current" style={{ fontSize: 17 }}>{money(o.grand_total)}</div>
                  <div className="muted text-xs flex items-center justify-end gap-1">
                    {o.payment_method === 'esewa' && <img src={PAYMENT_BRAND_LOGOS.esewa} alt="eSewa" style={{ height: 12, width: 'auto' }} />}
                    {PAYMENT_METHOD_LABELS[o.payment_method] || o.payment_method}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-2 account-order-thumbs">
                {o.items?.slice(0, 4).map((it) => {
                  const fallback = getProductImage(it, 0, true)
                  const src = it.image ? apiImage(it.image) : fallback
                  return (
                    <span key={it.id} className="thumb" style={{ width: 44, height: 44, borderRadius: 6, overflow: 'hidden', display: 'inline-block', background: 'var(--bg)' }}>
                      <img
                        src={src}
                        alt={it.product_name || ''}
                        className="thumb-img"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { e.target.onerror = null; e.target.src = fallback }}
                      />
                    </span>
                  )
                })}
              </div>
            </Link>
            <div className="flex items-center gap-2 mt-3" style={{ flexWrap: 'wrap' }}>
              {['delivered', 'completed'].includes(o.status) && (
                <Link to={`${basePath}/${o.id}#order-reviews`} className="btn btn-outline btn-sm inline-flex items-center gap-1.5">
                  <MessageSquare size={14} /> Review items
                </Link>
              )}
              {o.payment_status === 'pending' && ['khalti', 'esewa'].includes(o.payment_method) && !['cancelled', 'refunded', 'delivered', 'completed'].includes(o.status) && (
                <Link to={`${basePath}/${o.id}`} className="btn btn-primary btn-sm">Pay Now</Link>
              )}
              {o.status === 'cancelled' && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={reorderingId === o.id}
                  onClick={(event) => reorder(event, o)}
                >
                  {reorderingId === o.id ? 'Adding to cart…' : 'Order Again'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <Pagination page={page} lastPage={meta.last_page} total={meta.total} onChange={setPage} />
    </AccountPage>
  )
}
