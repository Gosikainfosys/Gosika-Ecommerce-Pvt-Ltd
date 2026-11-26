import { formatDateTime, money } from './format'
import { qrDataUrl } from './qr'

const escapeHtml = (value) => String(value ?? '—').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]))

function safeImageSource(value) {
  const source = String(value || '').trim()
  return /^(https?:\/\/|\/(?!\/))/i.test(source) ? source : ''
}

export async function printPayoutReceipt(payout, vendorName = '', branding = {}) {
  const printWindow = window.open('', '_blank', 'width=800,height=700')
  if (!printWindow) return false

  printWindow.opener = null
  const payoutId = payout.id || payout.uuid
  const trackingUrl = payoutId && payout.tracking_token
    ? `${window.location.origin}/payout-tracking/${encodeURIComponent(payoutId)}?token=${encodeURIComponent(payout.tracking_token)}`
    : ''
  let qr = ''
  try {
    qr = trackingUrl ? await qrDataUrl(trackingUrl, 180) : ''
  } catch (error) {
    printWindow.close()
    throw error
  }

  const record = (payout.records || []).slice(-1)[0] || {}
  const account = payout.bank_account
  const companyName = branding.brand_name || branding.site_name || 'GOSIKA'
  const companyInfo = [
    branding.business_address || branding.site_address,
    branding.support_phone,
    branding.support_email,
  ].filter(Boolean)
  const logo = safeImageSource(branding.logo_light || branding.logo_dark)
  const accountNumber = account?.account_number
    ? `**** ${String(account.account_number).slice(-4)}`
    : '—'
  const details = [
    ['Vendor', vendorName || payout.vendor_name || payout.vendor?.company_name],
    ['Payout reference', payout.payout_number],
    ['Funding source', String(payout.funding_source || '—').replace(/_/g, ' ')],
    ['Amount', money(payout.amount)],
    ['Status', payout.status],
    ['Paid at', formatDateTime(payout.paid_at || payout.requested_at)],
    ['Bank', account?.bank_name],
    ['Account name', account?.account_name],
    ['Account number', accountNumber],
    ['Transfer reference', record.provider_reference],
    ['Transfer notes', record.notes],
    ['Attachments', (record.proofs || []).map((proof) => proof.name).join(', ')],
  ]
  const rows = details.map(([label, value]) => (
    `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value || '—')}</td></tr>`
  )).join('')
  const qrHtml = qr
    ? `<div class="tracking"><img src="${qr}" alt="Scan to track payout" /><strong>Scan to track this payout</strong><span>Live Gosika status page</span></div>`
    : ''
  const companyInfoHtml = companyInfo.map((value) => `<span>${escapeHtml(value)}</span>`).join('<span class="separator">·</span>')

  printWindow.document.write(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Payout receipt ${escapeHtml(payout.payout_number)}</title>
        <style>
          * { box-sizing: border-box; }
          body { font: 13px Arial, sans-serif; color: #172033; margin: 0 auto; padding: 34px; max-width: 820px; }
          .company { display: flex; align-items: center; gap: 16px; padding-bottom: 18px; border-bottom: 3px solid #ff5500; }
          .logo { max-width: 105px; max-height: 58px; object-fit: contain; }
          .company h1 { font-size: 20px; margin: 0 0 5px; }
          .company p { color: #64748b; margin: 0; font-size: 11px; line-height: 1.6; }
          .separator { margin: 0 6px; }
          .heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin: 24px 0 16px; }
          .heading h2 { font-size: 18px; margin: 0 0 5px; }
          .heading p { color: #64748b; margin: 0; font-size: 11px; }
          .amount { color: #c2410c; font-size: 20px; font-weight: 700; white-space: nowrap; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 9px 10px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
          th { width: 32%; color: #475569; font-size: 12px; }
          td { white-space: pre-wrap; overflow-wrap: anywhere; }
          .bottom { display: flex; justify-content: space-between; align-items: center; gap: 22px; margin-top: 20px; }
          .tracking { display: flex; align-items: center; flex-direction: column; min-width: 150px; gap: 5px; text-align: center; font-size: 10px; }
          .tracking img { width: 118px; height: 118px; }
          .tracking span { color: #64748b; }
          .disclaimer { margin-top: 18px; color: #64748b; font-size: 10px; line-height: 1.5; }
          @page { size: A4; margin: 15mm; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <header class="company">
          ${logo ? `<img class="logo" src="${escapeHtml(logo)}" alt="${escapeHtml(companyName)} logo" />` : ''}
          <div>
            <h1>${escapeHtml(companyName)}</h1>
            <p>${companyInfoHtml || escapeHtml(branding.tagline || 'Official payout record')}</p>
          </div>
        </header>
        <section class="heading">
          <div>
            <h2>Payout Receipt</h2>
            <p>System-generated payout record · ${escapeHtml(formatDateTime(new Date()))}</p>
          </div>
          <div class="amount">${escapeHtml(money(payout.amount))}</div>
        </section>
        <table>${rows}</table>
        <div class="bottom">
          <div class="disclaimer">Status tracking shows updates recorded by ${escapeHtml(companyName)}. It does not independently verify settlement with a bank or payment provider.</div>
          ${qrHtml}
        </div>
      </body>
    </html>`)
  printWindow.document.close()
  printWindow.focus()
  window.setTimeout(() => printWindow.print(), 250)
  return true
}
