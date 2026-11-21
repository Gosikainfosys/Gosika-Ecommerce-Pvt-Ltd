import { apiImage, money, formatDateTime } from './format'
import { qrDataUrl, orderTrackUrl } from './qr'

const esc = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const buildDocHtml = (content, title = 'Gosika Packing Slips') => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 32px; font-size: 13px; }
  .wrap { max-width: 760px; margin: 0 auto; }
  .wrap + .wrap { break-before: page; page-break-before: always; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #111; padding-bottom: 14px; margin-bottom: 18px; }
  .wordmark { font-size: 26px; font-weight: 900; letter-spacing: 1px; }
  .wordmark span { color: #e25700; }
  .brand-lockup { display: flex; align-items: center; gap: 8px; }
  .brand-logo { display: block; max-width: 180px; height: 34px; object-fit: contain; }
  .brand-mark { display: block; width: 34px; height: 34px; flex: 0 0 34px; }
  .tagline { font-size: 11px; color: #555; margin-top: 2px; }
  .doc { text-align: right; }
  .doc h1 { margin: 0; font-size: 20px; letter-spacing: 3px; text-transform: uppercase; }
  .doc .docline { font-size: 11.5px; color: #555; margin-top: 4px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 18px; font-size: 12.5px; }
  .meta b { font-weight: 700; }
  .meta div { display: flex; justify-content: space-between; border-bottom: 1px dotted #ccc; padding: 3px 0; }
  .addr-duo { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
  .addr { margin-bottom: 18px; }
  .addr-duo .addr { margin-bottom: 0; }
  .addr h3, .sec h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 6px; color: #555; }
  .addr .box { border: 1px solid #bbb; padding: 10px 12px; line-height: 1.55; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { background: #eee; text-align: left; padding: 7px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  td { padding: 7px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
  .c { text-align: center; }
  .r { text-align: right; }
  .psku { font-size: 11px; color: #666; margin-top: 2px; }
  .group-head { display: flex; gap: 14px; align-items: baseline; margin-top: 16px; font-size: 13px; }
  .group-head span { font-size: 11px; color: #555; }
  .totals { width: 300px; }
  .trow { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
  .trow.total { border-top: 2px solid #111; margin-top: 4px; padding-top: 8px; font-size: 16px; font-weight: 900; }
  .totals-duo { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-top: 18px; }
  .qrcode { text-align: center; }
  .qrcode img { width: 130px; height: 130px; border: 1px solid #ddd; border-radius: 6px; padding: 6px; background: #fff; }
  .qrcode .qcap { font-size: 10.5px; color: #555; margin-top: 5px; max-width: 150px; }
  .foot { margin-top: 34px; padding-top: 10px; border-top: 1px solid #ddd; text-align: center; font-size: 11.5px; color: #555; }
</style>
</head>
<body>${content}</body>
</html>`

export function buildOrderDocumentHtml(docTitle, docLines, metaRows, billTo, addrHtml, groupsHtml, totalsHtml, footer, qrHtml = '') {
  const meta = metaRows
    .map(([label, value]) => `<div><b>${esc(label)}</b><span>${esc(value)}</span></div>`)
    .join('')
  const billToHtml = billTo ? `<div class="addr"><h3>Billed To</h3><div class="box">${billTo}</div></div>` : ''
  const content = `
  <div class="wrap">
    <div class="head">
      <div>
        <div class="wordmark">GOSI<span>KA</span></div>
        <div class="tagline">The Gosika Marketplace Pvt. Ltd.</div>
      </div>
      <div class="doc">
        <h1>${esc(docTitle)}</h1>
        ${docLines ? `<div class="docline">${esc(docLines)}</div>` : ''}
      </div>
    </div>
    <div class="meta">${meta}</div>
    <div class="addr-duo">
      ${billToHtml}
      <div class="addr"><h3>Delivery Address</h3><div class="box">${addrHtml}</div></div>
    </div>
    <div class="sec"><h3>Items</h3>${groupsHtml}</div>
    <div class="totals-duo" style="justify-content:${qrHtml ? 'space-between' : 'flex-end'}">
      <div class="totals">${totalsHtml}</div>
      ${qrHtml}
    </div>
    <div class="foot">${footer}</div>
  </div>`

  return buildDocHtml(content, `${docTitle} - ${String(docLines || '').split('·')[0].trim()}`)
}

export function buildOrderDocumentParts(order) {
  const addr = order.shipping_address || order.order?.shipping_address || {}
  const customerName = addr?.name || addr?.full_name || addr?.recipient_name || 'Customer'
  const customerPhone = addr?.phone || '—'
  const addressLines = [
    customerName,
    addr?.street || addr?.address_line_1,
    addr?.municipality || addr?.city,
    addr?.district,
    addr?.province,
  ].filter(Boolean)

  const addrHtml = addressLines.length > 0
    ? addressLines.map((line) => `<div>${esc(line)}</div>`).join('')
    : '<div>Delivery address on file with customer.</div>'
  const billTo = [
    `<div style="font-weight:700">${esc(customerName)}</div>`,
    customerPhone !== '—' ? `<div>${esc(customerPhone)}</div>` : '',
  ].filter(Boolean).join('')

  const rows = (order.items || []).map((item, index) => `
      <tr>
        <td class="c">${index + 1}</td>
        <td>
          <div class="pname">${esc(item.product_name || item.name)}</div>
          <div class="psku">${item.variant_name ? `Variant: ${esc(item.variant_name)}` : ''}${item.sku ? ` · SKU: ${esc(item.sku)}` : ''}</div>
        </td>
        <td class="c">${item.quantity ?? ''}</td>
        <td class="r">${money(item.unit_price ?? item.price)}</td>
        <td class="r">${money(item.line_total ?? ((item.unit_price ?? 0) * (item.quantity ?? 0)))}</td>
      </tr>`).join('')

  const groupsHtml = `
      <div class="group">
        <div class="group-head">
          <strong>${esc(order.store_name || 'Store')}</strong>
          <span>Order #${esc(order.order_number || order.vendor_order_number)}</span>
          <span>${esc(String(order.status || '').replace(/_/g, ' ')).toUpperCase()}</span>
        </div>
        <table>
          <thead>
            <tr><th class="c" style="width:36px">S.No</th><th>Item</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`

  const totalsHtml = `
      <div class="trow"><span>Subtotal</span><span>${money(order.items_subtotal)}</span></div>
      <div class="trow"><span>Delivery</span><span>${Number(order.delivery_charge) > 0 ? money(order.delivery_charge) : 'Free'}</span></div>
      ${Number(order.tax) > 0 ? `<div class="trow"><span>Tax</span><span>${money(order.tax)}</span></div>` : ''}
      <div class="trow total"><span>Grand Total</span><span>${money(order.grand_total)}</span></div>
      <div class="trow"><span>Commission (${esc(order.commission_rate)}%)</span><span>- ${money(order.commission_amount)}</span></div>
      <div class="trow"><span>You receive after refunds</span><span>${money(order.net_vendor_payable ?? order.vendor_payable)}</span></div>`

  return { customerName, customerPhone, addrHtml, billTo, groupsHtml, totalsHtml }
}

const defaultLogo = `
  <svg class="brand-mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GOSIKA logo">
    <rect width="40" height="40" rx="10" fill="#FF5500" />
    <path d="M14.5 14V11C14.5 7.96243 16.9624 5.5 20 5.5C23.0376 5.5 25.5 7.96243 25.5 11V14" stroke="#FFFFFF" stroke-width="2.8" stroke-linecap="round" />
    <path d="M9.5 14H30.5L28.8 32C28.6 33.7 27.2 35 25.5 35H14.5C12.8 35 11.4 33.7 11.2 32L9.5 14Z" fill="#FFFFFF" />
    <path d="M20 25.8C20 25.8 15.5 22.8 15.5 19.8C15.5 18.2 16.7 17 18.2 17C19.1 17 19.8 17.5 20 18.1C20.2 17.5 20.9 17 21.8 17C23.3 17 24.5 18.2 24.5 19.8C24.5 22.8 20 25.8 20 25.8Z" fill="#FF5500" />
  </svg>`

async function buildPackingSlipContent(order, { brandName, logoUrl }) {
  const today = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
  const { customerName, customerPhone, addrHtml, billTo, groupsHtml } = buildOrderDocumentParts(order)
  const slipTotalsHtml = `
      <div class="trow"><span>Subtotal</span><span>${money(order.items_subtotal)}</span></div>
      <div class="trow"><span>Delivery</span><span>${Number(order.delivery_charge) > 0 ? money(order.delivery_charge) : 'Free'}</span></div>
      ${Number(order.tax) > 0 ? `<div class="trow"><span>Tax</span><span>${money(order.tax)}</span></div>` : ''}
      <div class="trow total"><span>Total Payable</span><span>${money(order.grand_total)}</span></div>`

  const trackUrl = orderTrackUrl(order)
  const qr = trackUrl ? await qrDataUrl(trackUrl, 200) : null
  const qrHtml = qr
    ? `<div class="qrcode"><img src="${qr}" alt="Track order QR" /><div class="qcap">Scan to track this order</div></div>`
    : ''
  const orderNumber = order.order_number || order.vendor_order_number
  const logo = logoUrl
    ? `<img class="brand-logo" src="${esc(apiImage(logoUrl))}" alt="${esc(brandName)} logo">`
    : `${defaultLogo}<div class="wordmark">GOSI<span>KA</span></div>`
  const metaRows = [
    ['Order #', orderNumber],
    ['Order Date', formatDateTime(order.created_at)],
    ['Store', order.store_name || 'Store'],
    ['Customer', customerName],
    ['Phone', customerPhone],
    ['Status', (order.status || 'pending').toUpperCase()],
    ['Payment Method', (order.payment_method || 'COD').toUpperCase()],
  ]
  const meta = metaRows
    .map(([label, value]) => `<div><b>${esc(label)}</b><span>${esc(value)}</span></div>`)
    .join('')
  const footer = `Thank you for shopping with Gosika Marketplace &nbsp;·&nbsp; This is a system-generated packing slip for order ${esc(orderNumber)}. It is not a tax invoice.`

  return `
  <div class="wrap">
    <div class="head">
      <div>
        <div class="brand-lockup">${logo}</div>
        <div class="tagline">The Gosika Marketplace Pvt. Ltd.</div>
      </div>
      <div class="doc">
        <h1>Packing Slip</h1>
        <div class="docline">Prepared for packing · ${today}</div>
      </div>
    </div>
    <div class="meta">${meta}</div>
    <div class="addr-duo">
      <div class="addr"><h3>Billed To</h3><div class="box">${billTo}</div></div>
      <div class="addr"><h3>Delivery Address</h3><div class="box">${addrHtml}</div></div>
    </div>
    <div class="sec"><h3>Items</h3>${groupsHtml}</div>
    <div class="totals-duo" style="justify-content:${qrHtml ? 'space-between' : 'flex-end'}">
      <div class="totals">${slipTotalsHtml}</div>
      ${qrHtml}
    </div>
    <div class="foot">${footer}</div>
  </div>`
}

export async function buildPackingSlipsHtml(orders, branding = {}) {
  const brandName = branding.brandName || 'GOSIKA'
  const logoUrl = branding.logoUrl || ''
  const slips = await Promise.all(orders.map(order => buildPackingSlipContent(order, { brandName, logoUrl })))
  return buildDocHtml(slips.join(''))
}
