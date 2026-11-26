import React, { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import { useBranding } from '../../context/BrandingContext'
import { formatDateTime, money } from '../../utils/format'

const STATUS_STYLES = {
  pending: { label: 'Pending', color: '#b45309', background: '#fffbeb', Icon: Clock3 },
  approved: { label: 'Approved', color: '#1d4ed8', background: '#eff6ff', Icon: CheckCircle2 },
  processing: { label: 'Processing', color: '#1d4ed8', background: '#eff6ff', Icon: RefreshCw },
  paid: { label: 'Paid', color: '#15803d', background: '#f0fdf4', Icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: '#b91c1c', background: '#fef2f2', Icon: XCircle },
  cancelled: { label: 'Cancelled', color: '#475569', background: '#f1f5f9', Icon: XCircle },
}

export default function PayoutTracking() {
  const { payoutId } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const branding = useBranding()
  const [payout, setPayout] = useState(null)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [lastChecked, setLastChecked] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow, noarchive'
    document.head.appendChild(robots)

    const referrer = document.createElement('meta')
    referrer.name = 'referrer'
    referrer.content = 'no-referrer'
    document.head.appendChild(referrer)

    return () => {
      robots.remove()
      referrer.remove()
    }
  }, [])

  useEffect(() => {
    let active = true
    let hasLoaded = false

    const loadTracking = async () => {
      if (!payoutId || !token) {
        if (active) {
          setError('This payout tracking link is incomplete.')
          setLoading(false)
        }
        return
      }

      try {
        const response = await api.get(
          `/public/wallet/payouts/${encodeURIComponent(payoutId)}/tracking`,
          { params: { token }, skipCache: true },
        )
        if (!active) return

        setPayout(response.data?.data || null)
        setError('')
        setRefreshError('')
        setLastChecked(new Date())
        hasLoaded = true
      } catch (requestError) {
        if (!active) return
        const message = requestError.response?.status === 404
          ? 'This payout tracking link is invalid or no longer available.'
          : 'Unable to refresh the payout status. Please try again shortly.'
        if (hasLoaded) setRefreshError(message)
        else setError(message)
      } finally {
        if (active) setLoading(false)
      }
    }

    loadTracking()
    const interval = window.setInterval(loadTracking, 10000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [payoutId, token])

  const status = STATUS_STYLES[payout?.status] || {
    label: payout?.status || 'Unknown',
    color: '#475569',
    background: '#f1f5f9',
    Icon: AlertCircle,
  }
  const StatusIcon = status.Icon
  const brandName = branding.brand_name || branding.site_name || 'GOSIKA'
  const logo = branding.logo_light || branding.logo_dark

  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', padding: '32px 16px' }}>
      <section style={{ width: '100%', maxWidth: 620, margin: '0 auto' }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, overflow: 'hidden', boxShadow: '0 12px 35px rgba(15, 23, 42, .08)' }}>
          <header style={{ padding: '24px 28px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 16 }}>
            {logo ? <img src={logo} alt={`${brandName} logo`} style={{ maxWidth: 110, maxHeight: 54, objectFit: 'contain' }} /> : null}
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{brandName}</div>
              {branding.tagline ? <div style={{ marginTop: 3, fontSize: 12, color: '#64748b' }}>{branding.tagline}</div> : null}
            </div>
          </header>

          <div style={{ padding: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#0f172a' }}>
              <ShieldCheck size={22} color={branding.primary_color || '#ff5500'} />
              <h1 style={{ margin: 0, fontSize: 22 }}>Payout tracking</h1>
            </div>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, margin: '9px 0 22px' }}>
              Current payout status recorded by {brandName}. This page refreshes automatically every 10 seconds.
            </p>

            {loading && !payout ? (
              <div role="status" style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>
                <RefreshCw size={20} className="animate-spin" style={{ margin: '0 auto 10px' }} />
                Loading payout status…
              </div>
            ) : error && !payout ? (
              <div role="alert" style={{ padding: 16, borderRadius: 10, background: '#fef2f2', color: '#b91c1c', fontSize: 14 }}>
                {error}
              </div>
            ) : payout ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 16, borderRadius: 12, background: status.background }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Payout status</div>
                    <div style={{ fontWeight: 800, color: status.color, fontSize: 18 }}>{status.label}</div>
                  </div>
                  <StatusIcon size={25} color={status.color} />
                </div>

                <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 2fr', gap: '0 16px', margin: '18px 0 0' }}>
                  {[
                    ['Payout reference', payout.payout_number],
                    ['Vendor', payout.vendor_name],
                    ['Amount', money(payout.amount)],
                    ['Transfer reference', payout.provider_reference],
                    ['Paid at', formatDateTime(payout.paid_at)],
                    ['Last record update', formatDateTime(payout.updated_at)],
                  ].map(([label, value]) => (
                    <React.Fragment key={label}>
                      <dt style={{ padding: '12px 0', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 13 }}>{label}</dt>
                      <dd style={{ margin: 0, padding: '12px 0', borderBottom: '1px solid #e2e8f0', color: '#0f172a', fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>
                        {value || '—'}
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>

                {refreshError ? (
                  <p role="status" style={{ color: '#b45309', fontSize: 12, margin: '14px 0 0' }}>{refreshError}</p>
                ) : null}
                <p style={{ color: '#64748b', fontSize: 12, margin: '14px 0 0' }}>
                  {lastChecked
                    ? `Last checked ${lastChecked.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                    : 'Checking for updates…'}
                </p>
              </>
            ) : null}

            <div style={{ marginTop: 24, padding: 14, borderRadius: 10, background: '#f8fafc', color: '#475569', fontSize: 12, lineHeight: 1.6 }}>
              This status reflects updates recorded in the {brandName} platform. It does not independently verify settlement with a bank or payment provider.
            </div>
          </div>

          <footer style={{ padding: '16px 28px', borderTop: '1px solid #e2e8f0', color: '#64748b', fontSize: 12, lineHeight: 1.7 }}>
            {[branding.business_address, branding.support_phone, branding.support_email].filter(Boolean).join(' · ')}
          </footer>
        </div>
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <Link to="/" style={{ color: branding.primary_color || '#ff5500', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            Back to {brandName}
          </Link>
        </div>
      </section>
    </main>
  )
}
