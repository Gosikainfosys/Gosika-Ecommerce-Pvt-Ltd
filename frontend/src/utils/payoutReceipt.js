import { formatDateTime, money } from './format'

const escapeHtml = (value) => String(value ?? '—').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]))

export function printPayoutReceipt(payout, vendorName = '') {
  const printWindow = window.open('', '_blank', 'width=800,height=700')
  if (!printWindow) return false

  printWindow.opener = null
  const record = (payout.records || []).slice(-1)[0] || {}
  const account = payout.bank_account
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

  printWindow.document.write(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Payout receipt ${escapeHtml(payout.payout_number)}</title>
        <style>
          body { font: 14px Arial, sans-serif; color: #172033; margin: 40px; }
          h1 { font-size: 22px; margin: 0 0 6px; }
          p { color: #64748b; margin: 0 0 24px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 11px 12px; border-bottom: 1px solid #dbe2ea; text-align: left; vertical-align: top; }
          th { width: 32%; color: #475569; }
          td { white-space: pre-wrap; overflow-wrap: anywhere; }
          .disclaimer { margin-top: 24px; font-size: 11px; }
        </style>
      </head>
      <body>
        <h1>GOSIKA Payout Receipt</h1>
        <p>Generated payout record</p>
        <table>${rows}</table>
        <p class="disclaimer">This receipt summarizes the payout record. It is not a bank-issued transfer confirmation.</p>
      </body>
    </html>`)
  printWindow.document.close()
  printWindow.focus()
  window.setTimeout(() => printWindow.print(), 250)
  return true
}
