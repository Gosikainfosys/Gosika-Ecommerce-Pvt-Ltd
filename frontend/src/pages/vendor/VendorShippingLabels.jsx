import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Printer, X } from 'lucide-react'
import api from '../../api/client'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import FilterBar from '../../components/admin/FilterBar'
import Pagination from '../../components/ui/Pagination'
import StatusBadge from '../../components/commerce/StatusBadge'
import { Skeleton } from '../../components/ui/Skeleton'
import { useList } from '../../hooks/useApi'
import { useToast } from '../../context/ToastContext'
import { useBranding } from '../../context/BrandingContext'
import { apiImage, errorMessage, formatDateTime, getProductImage, handleImgError, money } from '../../utils/format'
import { buildPackingSlipsHtml } from '../../utils/packingSlip'

const ORDER_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'payment_pending', label: 'Payment Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'processing', label: 'Processing' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready_for_pickup', label: 'Ready for Pickup' },
  { value: 'picked_up', label: 'Picked Up' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'returned', label: 'Returned' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'failed', label: 'Failed' },
]

export default function VendorShippingLabels() {
  const toast = useToast()
  const branding = useBranding()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [appliedDateRange, setAppliedDateRange] = useState({ from: '', to: '' })
  const [selectedOrders, setSelectedOrders] = useState(() => new Map())
  const [printing, setPrinting] = useState(false)
  const selectAllRef = useRef(null)

  const fetcher = useCallback((page, pageSize) => api.get('/vendor/orders', {
    params: {
      page,
      per_page: pageSize,
      search: search || undefined,
      status: status || undefined,
      date_from: appliedDateRange.from || undefined,
      date_to: appliedDateRange.to || undefined,
    },
  }), [search, status, appliedDateRange])
  const { items: orders, meta, page, setPage, loading, error, reload } = useList(fetcher, {
    deps: [search, status, appliedDateRange],
    pageSize: 12,
  })

  const selectedOnPage = orders.filter(order => selectedOrders.has(order.id)).length
  const allOnPageSelected = orders.length > 0 && selectedOnPage === orders.length

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedOnPage > 0 && !allOnPageSelected
    }
  }, [selectedOnPage, allOnPageSelected])

  const toggleOrder = (order) => {
    setSelectedOrders(previous => {
      const next = new Map(previous)
      if (next.has(order.id)) {
        next.delete(order.id)
      } else {
        next.set(order.id, order)
      }
      return next
    })
  }

  const togglePageSelection = () => {
    setSelectedOrders(previous => {
      const next = new Map(previous)
      if (allOnPageSelected) {
        orders.forEach(order => next.delete(order.id))
      } else {
        orders.forEach(order => next.set(order.id, order))
      }
      return next
    })
  }

  const printSlips = async (ordersToPrint) => {
    const printWindow = window.open('', '_blank', 'width=860,height=1000')
    if (!printWindow) {
      toast.error('Popup blocked. Allow popups for this page to print.')
      return
    }

    setPrinting(true)
    try {
      const html = await buildPackingSlipsHtml(ordersToPrint, {
        brandName: branding.brand_name || 'GOSIKA',
        logoUrl: branding.logo_dark || branding.logo_light || '',
      })
      printWindow.document.write(html)
      printWindow.document.close()
      printWindow.focus()
      setTimeout(() => printWindow.print(), 300)
    } catch (printError) {
      printWindow.close()
      toast.error(errorMessage(printError, 'Could not generate the packing slips.'))
    } finally {
      setPrinting(false)
    }
  }

  const resetFilters = () => {
    setPage(1)
    setSearch('')
    setStatus('')
    setDateFrom('')
    setDateTo('')
    setAppliedDateRange({ from: '', to: '' })
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton height={80} />
        <Skeleton height={64} />
        <Skeleton height={300} />
      </div>
    )
  }

  if (error) {
    return <ErrorState message={errorMessage(error)} onRetry={reload} />
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <div className="page-header">
        <div className="page-header-left">
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Packing Slips</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            Search and filter orders, then print the original full-size packing slip for one or multiple orders.
          </p>
        </div>
      </div>

      <FilterBar
        search={search}
        onSearchChange={value => {
          setPage(1)
          setSearch(value.trim())
        }}
        searchPlaceholder="Search order number, store, or item…"
        debounceMs={350}
        statusFilter={status || 'all'}
        onStatusChange={value => {
          setPage(1)
          setStatus(value === 'all' ? '' : value)
        }}
        statusOptions={ORDER_STATUSES}
        fromDate={dateFrom}
        toDate={dateTo}
        onFromDateChange={setDateFrom}
        onToDateChange={setDateTo}
        onApplyFilters={() => {
          setPage(1)
          setAppliedDateRange({ from: dateFrom, to: dateTo })
        }}
        onReset={resetFilters}
        hasActiveFilters={Boolean(search || status || dateFrom || dateTo)}
      />

      <div className="card flex items-center justify-between wrap gap-2" style={{ padding: '12px 16px', marginBottom: 12 }}>
        <div className="flex items-center gap-2">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allOnPageSelected}
            onChange={togglePageSelection}
            aria-label="Select all orders on this page"
            disabled={!orders.length || printing}
          />
          <span className="text-sm font-semibold">Select this page</span>
          <span className="muted text-xs">
            {selectedOrders.size} selected
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedOrders.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              icon={X}
              disabled={printing}
              onClick={() => setSelectedOrders(new Map())}
            >
              Clear selection
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={Printer}
            disabled={!selectedOrders.size || printing}
            onClick={() => printSlips(Array.from(selectedOrders.values()))}
          >
            {printing ? 'Preparing…' : `Print selected (${selectedOrders.size})`}
          </Button>
        </div>
      </div>

      {orders.length ? (
        <div className="flex flex-col gap-3">
          {orders.map(order => {
            const address = order.shipping_address || order.order?.shipping_address || {}
            const orderNumber = order.order_number || order.vendor_order_number || order.id
            const selected = selectedOrders.has(order.id)

            return (
              <div
                key={order.id}
                className="card flex items-center justify-between gap-3 wrap"
                style={{ padding: '14px 18px', borderColor: selected ? 'var(--primary)' : undefined }}
              >
                <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleOrder(order)}
                    aria-label={`Select packing slip for order ${orderNumber}`}
                    disabled={printing}
                  />
                  <img
                    src={order.items?.[0]?.image ? apiImage(order.items[0].image) : getProductImage(null)}
                    alt={order.items?.[0]?.product_name || 'Product'}
                    onError={handleImgError}
                    style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="flex items-center gap-2 wrap">
                      <span className="font-mono font-bold text-sm" style={{ color: 'var(--primary)' }}>
                        #{orderNumber}
                      </span>
                      <StatusBadge status={order.status} />
                    </div>
                    <div className="muted text-xs mt-0.5">
                      {address.name || address.full_name || order.customer_name || 'Customer'}
                      {' · '}{order.items?.length || 0} item(s)
                      {' · '}{money(order.grand_total)}
                    </div>
                    <div className="muted text-xs mt-0.5">
                      {order.store_name || 'Store'} · {formatDateTime(order.created_at)}
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  icon={Printer}
                  disabled={printing}
                  onClick={() => printSlips([order])}
                >
                  Print Slip
                </Button>
              </div>
            )
          })}
        </div>
      ) : (
        <EmptyState
          icon={FileText}
          title={search || status ? 'No matching packing slips' : 'No orders to print'}
          message={search || status
            ? 'Try another search or clear the selected filters.'
            : 'When orders are placed, their packing slips will appear here.'}
        />
      )}

      <Pagination
        page={page}
        lastPage={meta.last_page}
        total={meta.total}
        perPage={meta.per_page}
        onChange={setPage}
      />
    </div>
  )
}
