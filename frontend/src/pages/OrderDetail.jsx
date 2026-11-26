import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, MapPin, Truck, ShieldCheck, Phone, Clock, AlertCircle, HelpCircle,
  KeyRound, Copy, CheckCircle2, RotateCcw, MessageSquare, Star, Eye, EyeOff,
  ExternalLink, PackageOpen, LifeBuoy,
} from 'lucide-react'
import L from 'leaflet'
import api from '../api/client'
import ProductReviewForm from '../components/commerce/ProductReviewForm'
import StatusBadge from '../components/commerce/StatusBadge'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Button from '../components/ui/Button'
import { createOpenStreetMap, createRouteMarker } from '../utils/leafletMap'
import { money, formatDateTime, apiImage, errorMessage, handleImgError, getProductImage } from '../utils/format'
import { DELIVERY_STATUS_LABELS, ORDER_STATUS_FLOW, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_BRAND_LOGOS } from '../utils/constants'
import { useToast } from '../context/ToastContext'
import { AccountPage, AccountSection, AccountSkeleton, AccountError } from './account/AccountUI'

const CANCEL_REASONS = [
  'Ordered by mistake',
  'Selected the wrong product or quantity',
  'Incorrect delivery address',
  'Found a better price elsewhere',
  'Payment issue',
  'Delivery taking too long',
  'Changed my mind',
  'Other',
]

const responseItems = (response) => {
  const raw = response?.data?.data?.data ?? response?.data?.data ?? response?.data
  return Array.isArray(raw) ? raw : []
}

const coordinate = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatCountdown(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s < 10 ? '0' : ''}${s}s`
}

function AddressMap({ address }) {
  const containerRef = useRef(null)
  const lat = coordinate(address?.latitude ?? address?.lat)
  const lng = coordinate(address?.longitude ?? address?.lng)

  useEffect(() => {
    if (!containerRef.current || lat === null || lng === null) return undefined
    const map = createOpenStreetMap(containerRef.current, [lat, lng], 15)
    L.marker([lat, lng], { icon: createRouteMarker('D', '#ff5500') }).addTo(map)
    return () => map.remove()
  }, [lat, lng])

  if (lat === null || lng === null) return null

  const mapUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
  return (
    <div className="account-address-map-wrap">
      <div ref={containerRef} className="account-address-map" role="img" aria-label="Map showing the delivery address" />
      <a href={mapUrl} target="_blank" rel="noreferrer" className="account-map-link">
        Open in OpenStreetMap <ExternalLink size={12} aria-hidden="true" />
      </a>
    </div>
  )
}

function OrderItems({ items = [], deliveryComplete, canRequestReturn, orderId }) {
  return (
    <AccountSection
      icon={PackageOpen}
      title={`Items (${items.length})`}
      subtitle="Products included in this order."
    >
      {items.length === 0 ? (
        <p className="muted text-sm" style={{ margin: 0 }}>No item details are available for this order.</p>
      ) : (
        <div className="account-order-items">
          {items.map((item) => (
            <div key={item.id} className="account-order-item">
              <Link to={`/product/${item.product_id}`} className="thumb" style={{ width: 56, height: 56 }}>
                <img
                  src={item.image ? apiImage(item.image) : getProductImage(item, 0, true)}
                  alt={item.product_name || ''}
                  className="thumb-img"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={handleImgError}
                />
              </Link>
              <div className="account-order-item-info">
                <Link to={`/product/${item.product_id}`} className="font-medium text-sm">{item.product_name}</Link>
                {item.variant_name && <div className="muted text-xs">{item.variant_name}</div>}
                <div className="muted text-xs">Quantity: {item.quantity}</div>
              </div>
              <div className="account-order-item-price">
                <div className="text-sm font-semibold">{money(item.line_total)}</div>
                {deliveryComplete && canRequestReturn && (
                  <Link
                    to={`/account/returns?order_id=${orderId}&item_id=${item.id}`}
                    className="btn btn-outline btn-xs inline-flex items-center gap-1"
                  >
                    <RotateCcw size={11} /> Return item
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AccountSection>
  )
}

function DeliveryOtpCard({ otp, copied, onCopy }) {
  const [visible, setVisible] = useState(false)
  return (
    <AccountSection
      icon={KeyRound}
      title="Delivery Confirmation"
      subtitle="Share this code only when you physically receive your package."
    >
      <div className="account-otp-box">
        <div>
          <div className="account-otp-label">Your 6-digit delivery PIN</div>
          <div className="account-otp-value" aria-live="polite">{visible ? otp : '••••••'}</div>
        </div>
        <div className="account-otp-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm inline-flex items-center gap-1.5"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? 'Hide delivery OTP' : 'Show delivery OTP'}
          >
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
            {visible ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm inline-flex items-center gap-1.5"
            onClick={onCopy}
          >
            <Copy size={14} /> {copied ? 'Copied!' : 'Copy OTP'}
          </button>
        </div>
      </div>
      <div className="account-otp-note flex items-center gap-1.5">
        <ShieldCheck size={14} aria-hidden="true" />
        <span>Only share this code with your delivery rider at handover.</span>
      </div>
    </AccountSection>
  )
}

function OrderStatusTimeline({ status }) {
  const cancelled = status === 'cancelled'
  const stepIdx = ORDER_STATUS_FLOW.indexOf(status)
  const hasMappedStep = stepIdx >= 0

  return (
    <AccountSection
      icon={Truck}
      title="Order Progress"
      subtitle="Valid transitions recorded for this order."
    >
      <div className="timeline">
        {hasMappedStep && ORDER_STATUS_FLOW.map((step, index) => {
          const state = index < stepIdx ? 'done' : index === stepIdx ? 'active' : ''
          return (
            <div key={step} className={`timeline-item ${state}`}>
              <div className="font-medium text-sm" style={{ color: state === 'active' ? 'var(--primary)' : undefined }}>
                {ORDER_STATUS_LABELS[step] || step}
              </div>
              <div className="muted text-xs">{state === 'active' ? 'Current status' : state === 'done' ? 'Completed' : ''}</div>
            </div>
          )
        })}
        {!hasMappedStep && !cancelled && (
          <div className="timeline-item active">
            <div className="font-medium text-sm" style={{ color: 'var(--primary)' }}>
              {ORDER_STATUS_LABELS[status] || status}
            </div>
            <div className="muted text-xs">Current status</div>
          </div>
        )}
        {cancelled && (
          <div className="timeline-item active">
            <div className="font-medium text-sm" style={{ color: 'var(--danger)' }}>Cancelled</div>
            <div className="muted text-xs">This order was cancelled.</div>
          </div>
        )}
      </div>
    </AccountSection>
  )
}

function DeliveryTrackingTimeline({ tracking, error, onRetry }) {
  return (
    <AccountSection
      icon={Truck}
      title="Delivery Tracking"
      subtitle="Newest delivery updates first."
    >
      {error ? (
        <div className="flex items-center justify-between wrap gap-2">
          <p className="muted text-sm" style={{ margin: 0 }}>Tracking updates could not be loaded.</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>Try again</button>
        </div>
      ) : tracking.length > 0 ? (
        <div className="timeline">
          {tracking.map((event, index) => (
            <div key={event.id || `${event.status}-${event.tracked_at}`} className={`timeline-item ${index === 0 ? 'active' : 'done'}`}>
              <div className="font-medium text-sm">
                {event.title || DELIVERY_STATUS_LABELS[event.status] || event.status}
              </div>
              {(event.description || event.note) && <div className="muted text-xs">{event.description || event.note}</div>}
              {event.location_zone && (
                <div className="muted text-xs flex items-center gap-1 mt-1">
                  <MapPin size={12} /> Delivery zone: {event.location_zone}
                </div>
              )}
              <div className="muted text-xs mt-1">{formatDateTime(event.tracked_at || event.created_at)}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted text-sm" style={{ margin: 0 }}>Tracking updates will appear once your order is assigned for delivery.</p>
      )}
    </AccountSection>
  )
}

function OrderSummary({ order }) {
  return (
    <AccountSection icon={ShieldCheck} title="Order Summary" subtitle="Payment and charge breakdown.">
      <div className="account-summary-rows">
        <div className="flex justify-between"><span className="muted">Subtotal</span><span>{money(order.subtotal)}</span></div>
        {Number(order.discount) > 0 && (
          <div className="flex justify-between"><span className="muted">Discount</span><span className="text-success">-{money(order.discount)}</span></div>
        )}
        <div className="flex justify-between">
          <span className="muted">Delivery fee</span>
          <span>{Number(order.delivery_charge) > 0 ? money(order.delivery_charge) : 'Free'}</span>
        </div>
        {Number(order.tax) > 0 && <div className="flex justify-between"><span className="muted">Tax</span><span>{money(order.tax)}</span></div>}
        <div className="account-summary-total flex justify-between">
          <span className="font-bold">Total</span><span className="price-current">{money(order.grand_total)}</span>
        </div>
        {Number(order.refunded_amount) > 0 && (
          <>
            <div className="flex justify-between"><span className="muted">Refunded</span><span className="text-success">{money(order.refunded_amount)}</span></div>
            <div className="flex justify-between font-bold"><span>Net paid</span><span>{money(order.net_total)}</span></div>
          </>
        )}
        <div className="flex justify-between">
          <span className="muted">Payment method</span>
          <span className="font-medium flex items-center gap-1">
            {order.payment_method === 'esewa' && <img src={PAYMENT_BRAND_LOGOS.esewa} alt="eSewa" style={{ height: 14, width: 'auto' }} />}
            {PAYMENT_METHOD_LABELS[order.payment_method] || order.payment_method}
          </span>
        </div>
      </div>
    </AccountSection>
  )
}

function DeliveryAddress({ address }) {
  const lines = [address?.street, address?.municipality, address?.district, address?.province]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)

  return (
    <AccountSection icon={MapPin} title="Delivery Address" subtitle="Where this order was delivered.">
      <div className="account-address-block text-sm">
        {address?.name ? <div className="font-semibold">{address.name}</div> : <div className="muted">Recipient not available</div>}
        {lines.length > 0 ? <div className="muted">{lines.join(', ')}</div> : <div className="muted">Address details not available</div>}
        {address?.phone && (
          <div className="muted flex items-center gap-1 mt-1"><Phone size={12} aria-hidden="true" /> {address.phone}</div>
        )}
      </div>
      <AddressMap address={address} />
    </AccountSection>
  )
}

function SupportActions({ order, deliveryComplete }) {
  return (
    <AccountSection icon={LifeBuoy} title="Support & Actions" subtitle="Helpful next steps for this order.">
      <div className="account-support-actions">
        <Link to="/account/support" className="btn btn-outline btn-sm inline-flex items-center gap-1.5">
          <HelpCircle size={14} /> Contact support
        </Link>
        {deliveryComplete && order.can_request_return && (
          <Link to={`/account/returns?order_id=${order.id}`} className="btn btn-outline btn-sm inline-flex items-center gap-1.5">
            <RotateCcw size={14} /> Request return / refund
          </Link>
        )}
        {deliveryComplete && (
          <Link to={`${window.location.pathname}#order-reviews`} className="btn btn-outline btn-sm inline-flex items-center gap-1.5">
            <MessageSquare size={14} /> Review items
          </Link>
        )}
      </div>
    </AccountSection>
  )
}

function ReviewsSection({ order, pendingReviewItems, orderReviews, reviewsLoading, reviewsError, loadOrderReviews, sectionRef }) {
  return (
    <section id="order-reviews" ref={sectionRef} className="account-review-anchor">
      <AccountSection
        icon={MessageSquare}
        title="Reviews for this order"
        subtitle="Share feedback on items you have received."
        action={<Link to="/account/reviews" className="text-primary text-sm" style={{ fontWeight: 700 }}>All reviews</Link>}
      >
        {reviewsLoading ? (
          <p className="muted text-sm" style={{ margin: 0 }}>Loading your review options…</p>
        ) : reviewsError ? (
          <div className="flex items-center justify-between wrap gap-2">
            <p className="muted text-sm" style={{ margin: 0 }}>Could not load review options for this order.</p>
            <button type="button" className="btn btn-outline btn-sm" onClick={loadOrderReviews}>Try again</button>
          </div>
        ) : (
          <div className="account-review-list">
            {(order.items || []).map((item) => {
              const submittedReview = orderReviews.find((review) => review.order_item_id === item.id)
              const pendingItem = pendingReviewItems.find((pending) => pending.id === item.id)
              return (
                <article key={item.id} className="account-review-item">
                  <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                    <img
                      src={item.image ? apiImage(item.image) : getProductImage(item, 0, true)}
                      alt={item.product_name || 'Product'}
                      onError={handleImgError}
                      style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border)' }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="font-semibold text-sm">{item.product_name || 'Purchased product'}</div>
                      <div className="muted text-xs">Quantity: {item.quantity}</div>
                    </div>
                  </div>
                  {submittedReview ? (
                    <div className="flex flex-col gap-2 mt-2">
                      <div className="flex items-center gap-2 wrap">
                        <span className="rating-stars" aria-label={`Rated ${submittedReview.rating} out of 5`}>
                          {[1, 2, 3, 4, 5].map((rating) => (
                            <Star key={rating} size={15} fill={rating <= submittedReview.rating ? '#f59e0b' : 'none'} color={rating <= submittedReview.rating ? '#f59e0b' : '#cbd5e1'} />
                          ))}
                        </span>
                        <StatusBadge status={submittedReview.status} />
                      </div>
                      {submittedReview.title && <div className="font-semibold text-sm">{submittedReview.title}</div>}
                      {submittedReview.body && <p className="text-sm" style={{ margin: 0 }}>{submittedReview.body}</p>}
                    </div>
                  ) : pendingItem && item.product_id ? (
                    <div className="mt-2">
                      <ProductReviewForm
                        productId={item.product_id}
                        orderItemId={item.id}
                        onSubmitted={loadOrderReviews}
                      />
                    </div>
                  ) : (
                    <p className="muted text-xs mt-2" style={{ marginBottom: 0 }}>A review is not available for this item.</p>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </AccountSection>
    </section>
  )
}

export default function OrderDetail({ basePath = '/account/orders' }) {
  const { id } = useParams()
  const toast = useToast()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tracking, setTracking] = useState([])
  const [trackingError, setTrackingError] = useState(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [selectedReason, setSelectedReason] = useState(CANCEL_REASONS[0])
  const [explanation, setExplanation] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [otpCopied, setOtpCopied] = useState(false)
  const [pendingReviewItems, setPendingReviewItems] = useState([])
  const [orderReviews, setOrderReviews] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [reviewsError, setReviewsError] = useState(null)
  const [paying, setPaying] = useState(false)
  const reviewsSectionRef = useRef(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    setTrackingError(null)
    api
      .get(`/orders/${id}`)
      .then(async (res) => {
        setOrder(res.data.data)
        try {
          const trackingResponse = await api.get(`/orders/${id}/tracking`)
          setTracking(trackingResponse.data.data || [])
          setTrackingError(null)
        } catch (trackingLoadError) {
          setTracking([])
          setTrackingError(trackingLoadError)
        }
      })
      .catch((loadError) => setError(loadError))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  const loadOrderReviews = useCallback(async () => {
    if (!order?.id || !['delivered', 'completed'].includes(order.status)) return
    setReviewsLoading(true)
    setReviewsError(null)
    try {
      const [pendingResponse, reviewsResponse] = await Promise.all([
        api.get('/customer/reviews/pending', { params: { per_page: 50, order_id: order.id } }),
        api.get('/customer/reviews', { params: { per_page: 50, order_id: order.id } }),
      ])
      setPendingReviewItems(responseItems(pendingResponse))
      setOrderReviews(responseItems(reviewsResponse))
    } catch (reviewError) {
      setReviewsError(reviewError)
    } finally {
      setReviewsLoading(false)
    }
  }, [order?.id, order?.status])

  useEffect(() => {
    if (order && ['delivered', 'completed'].includes(order.status)) loadOrderReviews()
  }, [order, loadOrderReviews])

  useEffect(() => {
    if (window.location.hash === '#order-reviews' && order && !reviewsLoading) {
      requestAnimationFrame(() => reviewsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [order, reviewsLoading])

  useEffect(() => {
    if (order?.cancellation_seconds_remaining > 0) {
      setCountdown(order.cancellation_seconds_remaining)
      const timer = setInterval(() => {
        setCountdown((previous) => {
          if (previous <= 1) {
            clearInterval(timer)
            return 0
          }
          return previous - 1
        })
      }, 1000)
      return () => clearInterval(timer)
    }
    setCountdown(0)
    return undefined
  }, [order?.cancellation_seconds_remaining, order?.id])

  const copyOtp = async () => {
    if (!order?.delivery_otp) return
    try {
      await navigator.clipboard.writeText(order.delivery_otp)
      setOtpCopied(true)
      toast.success('Delivery OTP copied to clipboard!')
      setTimeout(() => setOtpCopied(false), 2000)
    } catch {
      toast.error('Could not copy the OTP. Please select it manually.')
    }
  }

  const cancelOrder = async () => {
    if (selectedReason === 'Other' && !explanation.trim()) {
      toast.error('Please provide an explanation when selecting "Other".')
      return
    }
    setCancelling(true)
    try {
      await api.post(`/orders/${id}/cancel`, {
        reason: selectedReason,
        explanation: explanation.trim() || undefined,
      })
      toast.success('Order cancelled successfully')
      setCancelOpen(false)
      setSelectedReason(CANCEL_REASONS[0])
      setExplanation('')
      load()
    } catch (cancelError) {
      toast.error(errorMessage(cancelError))
    } finally {
      setCancelling(false)
    }
  }

  const initiatePayment = async () => {
    if (order.status === 'cancelled') {
      toast.error('This order has been cancelled and cannot be paid.')
      return
    }
    setPaying(true)
    try {
      if (order.payment_method === 'khalti') {
        const response = await api.post('/payments/initiate', { order_id: order.id, method: 'khalti' })
        const payment = response.data.data
        if (payment?.payment_url) {
          window.open(payment.payment_url, '_blank', 'noopener')
          toast.info('Please complete payment in the opened tab.')
        } else {
          toast.error('Payment link is not available right now.')
        }
      } else if (order.payment_method === 'esewa') {
        const response = await api.post('/payments/initiate', {
          order_id: order.id,
          method: 'esewa',
          success_url: `${window.location.origin}/payments/esewa/callback`,
          failure_url: `${window.location.origin}/payments/esewa/callback?status=failure`,
        })
        const payment = response.data.data
        if (payment?.payment_form?.action && payment?.payment_form?.fields) {
          const form = document.createElement('form')
          form.method = 'POST'
          form.action = payment.payment_form.action
          form.style.display = 'none'
          Object.entries(payment.payment_form.fields).forEach(([key, value]) => {
            const input = document.createElement('input')
            input.type = 'hidden'
            input.name = key
            input.value = String(value)
            form.appendChild(input)
          })
          document.body.appendChild(form)
          toast.info('Redirecting to eSewa to complete payment…')
          form.submit()
        } else {
          toast.error('Payment form is not available right now.')
        }
      }
    } catch (paymentError) {
      toast.error('Failed to initiate payment: ' + errorMessage(paymentError))
    } finally {
      setPaying(false)
    }
  }

  if (loading) {
    return (
      <AccountPage title="Order Details" subtitle="Loading your order…">
        <AccountSkeleton rows={2} />
      </AccountPage>
    )
  }

  if (error || !order) {
    return (
      <AccountPage title="Order Details" subtitle="We couldn’t load this order.">
        <AccountError message={errorMessage(error, 'Order not found.')} onRetry={load} />
      </AccountPage>
    )
  }

  const deliveryComplete = ['delivered', 'completed'].includes(order.status)
  const showOtp = Boolean(order.delivery_otp && !deliveryComplete && order.status !== 'cancelled')

  const actions = (
    <div className="account-order-page-actions">
      <Link to={basePath} className="btn btn-outline btn-sm inline-flex items-center gap-1.5">
        <ArrowLeft size={14} /> Back to orders
      </Link>
      {order.status !== 'cancelled' && order.payment_status === 'pending' && ['khalti', 'esewa'].includes(order.payment_method) && (
        <Button variant="primary" size="sm" onClick={initiatePayment} disabled={paying}>
          {paying ? 'Processing…' : 'Pay Now'}
        </Button>
      )}
      {order.can_cancel && countdown > 0 && (
        <Button variant="danger-outline" size="sm" onClick={() => setCancelOpen(true)}>Cancel order</Button>
      )}
    </div>
  )

  return (
    <AccountPage
      title={`Order ${order.order_number}`}
      subtitle={`Placed on ${formatDateTime(order.placed_at)}`}
      actions={actions}
    >
      <div className="card account-order-status-strip">
        <div className="account-order-status-item">
          <span className="muted">Order status</span>
          <StatusBadge status={order.status} />
        </div>
        <div className="account-order-status-item">
          <span className="muted">Payment status</span>
          <StatusBadge status={order.payment_status} />
        </div>
        {order.can_cancel && countdown > 0 && (
          <div className="account-order-countdown">
            <Clock size={13} aria-hidden="true" /> Cancel within {formatCountdown(countdown)}
          </div>
        )}
      </div>

      {order.cancellation_blocked_reason && order.status !== 'cancelled' && (
        <div className="alert alert-info account-order-alert">
          <AlertCircle size={16} aria-hidden="true" />
          <div className="flex-1">
            <span className="text-sm font-medium">{order.cancellation_blocked_reason}</span>
          </div>
          <Link to="/account/support" className="btn btn-outline btn-xs inline-flex items-center gap-1">
            <HelpCircle size={13} /> Contact Support
          </Link>
        </div>
      )}

      {deliveryComplete && (
        <div className="alert account-order-delivered" role="status">
          <CheckCircle2 size={18} />
          <div className="flex-1 text-sm">
            <strong>Order delivered successfully.</strong>
            {order.status === 'completed'
              ? ' The return and refund period has expired, and this order is complete.'
              : order.can_request_return
                ? ` You can request a return, exchange, or replacement until ${formatDateTime(order.return_window_expires_at)}.`
                : ' The return and refund period has expired; this order will be marked complete shortly.'}
          </div>
          {order.can_request_return && (
            <Link to={`/account/returns?order_id=${order.id}`} className="btn btn-sm btn-primary">
              Return / Exchange / Refund
            </Link>
          )}
        </div>
      )}

      <div className="account-order-grid">
        <div className="account-order-main-column">
          <OrderItems
            items={order.items || []}
            deliveryComplete={deliveryComplete}
            canRequestReturn={order.can_request_return}
            orderId={order.id}
          />
          {showOtp && <DeliveryOtpCard otp={order.delivery_otp} copied={otpCopied} onCopy={copyOtp} />}
          <OrderStatusTimeline status={order.status} />
          <DeliveryTrackingTimeline tracking={tracking} error={trackingError} onRetry={load} />
          {deliveryComplete && (
            <ReviewsSection
              order={order}
              pendingReviewItems={pendingReviewItems}
              orderReviews={orderReviews}
              reviewsLoading={reviewsLoading}
              reviewsError={reviewsError}
              loadOrderReviews={loadOrderReviews}
              sectionRef={reviewsSectionRef}
            />
          )}
        </div>

        <aside className="account-order-side-column">
          <OrderSummary order={order} />
          <DeliveryAddress address={order.shipping_address || {}} />
          <SupportActions order={order} deliveryComplete={deliveryComplete} />
          <div className="alert alert-info account-order-protection">
            <ShieldCheck size={18} />
            <span>Every order on Gosika is covered by the Gosika Buyer Protection guarantee.</span>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={cancelOrder}
        danger
        loading={cancelling}
        title="Cancel this order?"
        message="Please select the reason for cancellation. Once cancelled, reserved stock will be released."
        confirmText="Yes, cancel order"
      >
        <div className="flex flex-col gap-3" style={{ marginTop: 12, textAlign: 'left' }}>
          <div>
            <label className="label" style={{ fontSize: 12, fontWeight: 700 }}>Reason for cancellation *</label>
            <select
              className="select select-sm w-full"
              value={selectedReason}
              onChange={(event) => setSelectedReason(event.target.value)}
              disabled={cancelling}
              style={{ width: '100%', borderRadius: 8 }}
            >
              {CANCEL_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
            </select>
          </div>
          <div>
            <label className="label" style={{ fontSize: 12, fontWeight: selectedReason === 'Other' ? 700 : 600 }}>
              {selectedReason === 'Other' ? 'Explanation (Required) *' : 'Additional Note (Optional)'}
            </label>
            <textarea
              className="textarea w-full"
              rows={selectedReason === 'Other' ? 3 : 2}
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              disabled={cancelling}
              placeholder={selectedReason === 'Other' ? 'Please describe why you wish to cancel this order...' : 'Optional details or feedback...'}
              style={{ width: '100%', marginTop: 4, borderRadius: 8 }}
              required={selectedReason === 'Other'}
            />
          </div>
        </div>
      </ConfirmDialog>
    </AccountPage>
  )
}
