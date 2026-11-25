import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Banknote,
  BarChart3,
  Coins,
  Download,
  Percent,
  PiggyBank,
  Printer,
  RotateCcw,
  TrendingUp,
  Wallet as WalletIcon,
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import api from '../../api/client'
import FluidDoughnutChart from '../../components/admin/charts/fx/FluidDoughnutChart'
import FluidLineChart from '../../components/admin/charts/fx/FluidLineChart'
import StatusBadge from '../../components/commerce/StatusBadge'
import FilterBar from '../../components/admin/FilterBar'
import ExportScopeNote from '../../components/admin/ExportScopeNote'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import Pagination from '../../components/ui/Pagination'
import Select from '../../components/ui/Select'
import Spinner from '../../components/ui/Spinner'
import { Skeleton } from '../../components/ui/Skeleton'
import { useAuth } from '../../context/AuthContext'
import { useBranding } from '../../context/BrandingContext'
import { useToast } from '../../context/ToastContext'
import { errorMessage, formatDateTime, money } from '../../utils/format'
import { companyFromBranding, exportReportFromRows, personLabel } from '../../utils/reportExport'

const DEFAULT_MIN_PAYOUT = 1000
const PAGE_SIZE = 25
const EARNING_RANGES = [
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
  { value: 'year', label: '12 Months' },
]
const STATUS_OPTIONS = [
  'pending',
  'processing',
  'eligible',
  'hold',
  'held',
  'approved',
  'paid',
  'completed',
  'rejected',
  'cancelled',
  'refunded',
  'failed',
  'delivered',
  'shipped',
  'confirmed',
]
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded']

async function fetchAllPages(path) {
  const rows = []
  let page = 1
  let lastPage = 1

  do {
    const response = await api.get(path, { params: { page, per_page: 100 } })
    rows.push(...api.unwrapList(response.data))
    lastPage = Number(response.data?.meta?.pagination?.last_page || 1)
    page += 1
  } while (page <= lastPage)

  return rows
}

function escapeHtml(value) {
  return String(value ?? '—').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

function writePrintDocument(title, content) {
  const printWindow = window.open('', '_blank', 'width=900,height=800')
  if (!printWindow) return false

  printWindow.document.open()
  printWindow.document.write(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(title)}</title>
        <style>
          body{font:14px Arial,sans-serif;color:#172033;margin:32px}
          h1{font-size:22px;margin:0 0 6px}
          .muted{color:#64748b;font-size:12px}
          .header{display:flex;justify-content:space-between;border-bottom:2px solid #e2e8f0;padding-bottom:16px;margin-bottom:20px}
          .meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px;margin:18px 0}
          .meta div{border-bottom:1px solid #e2e8f0;padding:8px 0}
          .label{display:block;color:#64748b;font-size:11px;text-transform:uppercase;margin-bottom:4px}
          table{width:100%;border-collapse:collapse;margin:18px 0}
          th,td{padding:9px 8px;border-bottom:1px solid #e2e8f0;text-align:left}
          th{background:#f8fafc;font-size:12px}
          .right{text-align:right}
          .total{font-weight:bold;font-size:16px}
          @media print{body{margin:12mm}}
        </style>
      </head>
      <body>${content}</body>
    </html>`)
  printWindow.document.close()
  printWindow.focus()
  window.setTimeout(() => printWindow.print(), 250)
  return true
}

function signedAmount(row) {
  const sign = row.direction === 'credit' ? '+' : row.direction === 'debit' ? '−' : ''
  return `${sign}${money(row.amount)}`
}

function rowDate(row) {
  return String(row.createdAt || '').slice(0, 10)
}

export default function VendorFinance() {
  const toast = useToast()
  const location = useLocation()
  const activePage = location.pathname.endsWith('/analytics') ? 'analytics' : 'wallet'
  const { user } = useAuth()
  const branding = useBranding()
  const [wallet, setWallet] = useState(null)
  const walletRef = useRef(null)
  const [rows, setRows] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [earningRange, setEarningRange] = useState('30d')
  const [analyticsSummary, setAnalyticsSummary] = useState(null)
  const [revenueTrend, setRevenueTrend] = useState([])
  const [commissionRate, setCommissionRate] = useState(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [analyticsError, setAnalyticsError] = useState(null)
  const [analyticsRetry, setAnalyticsRetry] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [appliedDates, setAppliedDates] = useState({ from: '', to: '' })
  const [walletTab, setWalletTab] = useState('activity')
  const [page, setPage] = useState(1)
  const [payoutOpen, setPayoutOpen] = useState(false)
  const [payoutAmount, setPayoutAmount] = useState('')
  const [bankAccountId, setBankAccountId] = useState('')
  const [requesting, setRequesting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const walletResponse = await api.post('/vendor/wallet/release-matured')
      const [
        transactionRows,
        orders,
        payoutResponse,
        settlements,
        bankResponse,
      ] = await Promise.all([
        fetchAllPages('/vendor/wallet/transactions'),
        fetchAllPages('/vendor/orders'),
        api.get('/vendor/wallet/payouts'),
        fetchAllPages('/vendor/wallet/settlements'),
        api.get('/vendor/bank-accounts'),
      ])

      const payoutRequests = api.unwrapList(payoutResponse.data)
      const nextWallet = walletResponse.data?.data ?? walletResponse.data
      const transactionsByReference = new Map()
      transactionRows.forEach((transaction) => {
        const key = `${String(transaction.reference_type || '').toLowerCase()}:${transaction.reference_id}`
        const group = transactionsByReference.get(key) || []
        group.push(transaction)
        transactionsByReference.set(key, group)
      })

      const consumedTransactions = new Set()
      const relatedTransactions = (type, referenceId) => (
        transactionsByReference.get(`${type}:${referenceId}`) || []
      )
      const nextRows = []

      orders.forEach((order) => {
        const linked = relatedTransactions('vendor_order', order.ledger_reference_id)
        const earnings = linked.find((transaction) => transaction.transaction_type === 'credit_earnings')
        if (earnings) consumedTransactions.add(earnings.id)
        const paymentReceived = ['paid', 'partially_refunded'].includes(String(order.payment_status || '').toLowerCase())
        const delivered = ['delivered', 'completed'].includes(String(order.status || '').toLowerCase())
          && String(order.delivery_status || '').toLowerCase() === 'delivered'

        nextRows.push({
          id: `order:${order.id}`,
          category: 'orders',
          categoryLabel: 'Order',
          reference: order.order_number || order.vendor_order_number || order.id,
          description: `${order.store_name || 'Vendor order'} · ${order.items?.length || 0} item(s)`,
          customer: order.customer_name || order.shipping_address?.name || 'Customer',
          status: order.status || 'pending',
          paymentStatus: order.payment_status || '',
          paymentMethod: order.payment_method || '',
          createdAt: earnings?.created_at || order.created_at,
          orderCreatedAt: order.created_at,
          amount: Number(earnings?.amount ?? order.net_vendor_payable ?? order.vendor_payable ?? 0),
          grossAmount: Number(order.net_total ?? order.grand_total ?? 0),
          commissionAmount: Number(order.commission_amount || 0),
          direction: earnings ? 'credit' : 'neutral',
          balanceAfter: earnings?.balance_after ?? null,
          walletStatus: earnings
            ? 'Credited to wallet'
            : !paymentReceived
              ? 'Awaiting payment'
              : !delivered
                ? 'Awaiting delivery'
                : 'Awaiting wallet release',
          order,
        })
      })

      payoutRequests.forEach((payout) => {
        const linked = relatedTransactions('payout_request', payout.ledger_reference_id)
        const withdrawal = linked.filter((transaction) => transaction.transaction_type === 'debit_withdrawal')
        withdrawal.forEach((transaction) => consumedTransactions.add(transaction.id))
        const sortedWithdrawals = [...withdrawal].sort((a, b) => (
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ))
        const lastTransaction = sortedWithdrawals[sortedWithdrawals.length - 1]
        const status = String(payout.status || '').toLowerCase()

        nextRows.push({
          id: `payout:${payout.id}`,
          category: 'payouts',
          categoryLabel: 'Payout request',
          reference: payout.payout_number || payout.id,
          description: `${payout.funding_source === 'available_balance' ? 'Available balance' : 'Settlement'} withdrawal`,
          customer: payout.bank_account?.bank_name || 'Bank payout',
          status,
          paymentStatus: '',
          paymentMethod: payout.bank_account?.account_number
            ? `••••${String(payout.bank_account.account_number).slice(-4)}`
            : '',
          createdAt: payout.requested_at || payout.created_at,
          amount: Number(payout.amount || 0),
          direction: 'debit',
          balanceAfter: lastTransaction?.balance_after ?? null,
          payout,
        })
      })

      settlements.forEach((settlement) => {
        const linked = relatedTransactions('settlement', settlement.ledger_reference_id)
        const settlementCredit = linked.find((transaction) => transaction.transaction_type === 'credit_settlement')
        if (settlementCredit) consumedTransactions.add(settlementCredit.id)

        nextRows.push({
          id: `settlement:${settlement.id}`,
          category: 'settlements',
          categoryLabel: 'Settlement',
          reference: settlement.settlement_number || settlement.id,
          description: `${settlement.period_start || 'Period'} – ${settlement.period_end || ''}`,
          customer: '',
          status: settlement.status || 'processing',
          paymentStatus: '',
          paymentMethod: '',
          createdAt: settlementCredit?.created_at || settlement.generated_at || settlement.created_at,
          amount: Number(settlementCredit?.amount ?? settlement.net_payable ?? 0),
          direction: settlementCredit ? 'credit' : 'neutral',
          balanceAfter: settlementCredit?.balance_after ?? null,
          settlement,
        })
      })

      transactionRows.forEach((transaction) => {
        if (consumedTransactions.has(transaction.id)) return

        const isCredit = String(transaction.transaction_type || '').startsWith('credit_')
        const transactionType = String(transaction.transaction_type || '').toLowerCase()
        nextRows.push({
          id: `transaction:${transaction.id}`,
          category: transactionType.includes('refund') ? 'refunds' : 'transactions',
          categoryLabel: transactionType.includes('refund') ? 'Refund' : 'Wallet transaction',
          reference: transaction.reference_id
            ? `${transaction.reference_type || 'reference'} ${transaction.reference_id}`
            : transaction.transaction_type?.replace(/_/g, ' '),
          description: transaction.description || transaction.transaction_type?.replace(/_/g, ' '),
          customer: '',
          status: transaction.status || 'completed',
          paymentStatus: '',
          paymentMethod: '',
          createdAt: transaction.created_at,
          amount: Number(transaction.amount || 0),
          direction: isCredit ? 'credit' : 'debit',
          balanceAfter: transaction.balance_after,
          transaction,
        })
      })

      nextRows.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      setWallet(nextWallet)
      walletRef.current = nextWallet
      setRows(nextRows)
      setBankAccounts(api.unwrapList(bankResponse.data))
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refreshWallet = useCallback(async () => {
    try {
      const response = await api.post('/vendor/wallet/release-matured')
      const nextWallet = response.data?.data ?? response.data
      const previousWallet = walletRef.current
      const balanceChanged = previousWallet && ['balance', 'available_balance', 'pending_balance']
        .some((key) => Number(previousWallet[key]) !== Number(nextWallet[key]))
      const metadataChanged = !previousWallet || [
        'return_window_days',
        'settlement_cycle_days',
        'earnings_maturity_days',
      ].some((key) => previousWallet[key] !== nextWallet[key])

      walletRef.current = nextWallet
      if (balanceChanged || metadataChanged) setWallet(nextWallet)
      if (balanceChanged) await load()
    } catch (refreshError) {
      toast.error(errorMessage(refreshError))
    }
  }, [load, toast])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshWallet()
    }, 60_000)

    return () => window.clearInterval(intervalId)
  }, [refreshWallet])

  useEffect(() => {
    if (activePage !== 'analytics') return undefined

    let active = true
    setAnalyticsLoading(true)
    setAnalyticsError(null)

    Promise.all([
      api.get('/vendor/analytics/summary', { params: { range: earningRange } }),
      api.get('/vendor/analytics/revenue-trend', { params: { range: earningRange } }),
      api.get('/vendor/me'),
    ]).then(([summaryResponse, trendResponse, vendorResponse]) => {
      if (!active) return
      const summary = summaryResponse.data?.data ?? summaryResponse.data
      const trend = trendResponse.data?.data ?? trendResponse.data
      const vendor = vendorResponse.data?.data ?? vendorResponse.data
      setAnalyticsSummary(summary)
      setRevenueTrend(Array.isArray(trend) ? trend : [])
      setCommissionRate(vendor?.commission_rate ?? null)
    }).catch((analyticsLoadError) => {
      if (active) setAnalyticsError(errorMessage(analyticsLoadError))
    }).finally(() => {
      if (active) setAnalyticsLoading(false)
    })

    return () => { active = false }
  }, [activePage, earningRange, analyticsRetry])

  const availableBalance = Number(wallet?.available_balance || 0)
  const minimumPayout = Number(wallet?.minimum_payout_amount || DEFAULT_MIN_PAYOUT)
  const payoutsEnabled = wallet?.vendor_payouts_enabled !== false
  const payoutRequestWindowOpen = wallet?.payout_request_window_open !== false
  const payoutRequestWindowLabel = wallet?.payout_request_window_label || 'the next scheduled payout day'
  const payoutFrequency = wallet?.payout_frequency || 'weekly'
  const payoutFrequencyLabel = {
    manual: 'Manual on-demand',
    daily: 'Daily',
    weekly: 'Weekly (Sunday)',
    biweekly: 'Biweekly (1st and 15th)',
    monthly: 'Monthly (1st)',
  }[payoutFrequency] || payoutFrequency
  const pendingOrderEarnings = useMemo(
    () => rows
      .filter((row) => row.category === 'orders'
        && row.direction !== 'credit'
        && ['paid', 'partially_refunded'].includes(String(row.paymentStatus).toLowerCase())
        && ['delivered', 'completed'].includes(String(row.status).toLowerCase())
        && String(row.order?.delivery_status).toLowerCase() === 'delivered')
      .reduce((sum, row) => sum + Math.max(0, row.amount), 0),
    [rows],
  )
  const displayedPendingBalance = Number(wallet?.pending_balance || 0) + pendingOrderEarnings
  const displayedTotalBalance = Number(wallet?.balance || 0) + pendingOrderEarnings
  const totalWithdrawn = useMemo(
    () => rows
      .filter((row) => row.category === 'payouts' && row.status === 'paid')
      .reduce((sum, row) => sum + row.amount, 0),
    [rows],
  )

  const walletTabRows = useMemo(
    () => rows.filter((row) => (walletTab === 'settlements'
      ? row.category === 'settlements'
      : row.category !== 'settlements')),
    [rows, walletTab],
  )

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return walletTabRows.filter((row) => {
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false
      if (statusFilter !== 'all' && String(row.status).toLowerCase() !== statusFilter) return false
      if (paymentFilter !== 'all' && String(row.paymentStatus).toLowerCase() !== paymentFilter) return false
      const date = rowDate(row)
      if (appliedDates.from && date && date < appliedDates.from) return false
      if (appliedDates.to && date && date > appliedDates.to) return false
      if (normalizedSearch) {
        const searchText = [
          row.reference,
          row.description,
          row.customer,
          row.paymentMethod,
          row.categoryLabel,
          row.order?.store_name,
        ].join(' ').toLowerCase()
        if (!searchText.includes(normalizedSearch)) return false
      }
      return true
    })
  }, [walletTabRows, search, categoryFilter, statusFilter, paymentFilter, appliedDates])

  const statusOptions = useMemo(() => (
    [...new Set([...STATUS_OPTIONS, ...walletTabRows.map((row) => String(row.status || '').toLowerCase()).filter(Boolean)])]
      .sort()
      .map((value) => ({
        value,
        label: value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' '),
      }))
  ), [walletTabRows])

  const paymentBreakdown = useMemo(() => {
    const start = new Date()
    if (earningRange === 'year') {
      start.setMonth(0, 1)
      start.setHours(0, 0, 0, 0)
    } else {
      const days = earningRange === '7d' ? 7 : earningRange === '90d' ? 90 : 30
      start.setDate(start.getDate() - days + 1)
      start.setHours(0, 0, 0, 0)
    }

    const counts = new Map()
    rows.forEach((row) => {
      if (row.category !== 'orders' || !row.paymentStatus) return
      const placedAt = new Date(row.orderCreatedAt || row.createdAt)
      if (Number.isNaN(placedAt.getTime()) || placedAt < start) return
      const status = String(row.paymentStatus).toLowerCase()
      counts.set(status, (counts.get(status) || 0) + 1)
    })

    const colors = {
      paid: '#16a34a',
      pending: '#f59e0b',
      failed: '#dc2626',
      cancelled: '#64748b',
      refunded: '#7c3aed',
      partially_refunded: '#0284c7',
    }
    const segments = [...counts.entries()].map(([status, value]) => ({
      label: status.replace(/_/g, ' '),
      value,
      color: colors[status] || '#94a3b8',
    }))

    return {
      segments,
      total: segments.reduce((sum, segment) => sum + segment.value, 0),
    }
  }, [rows, earningRange])

  const lastPage = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const resetFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setCategoryFilter('all')
    setPaymentFilter('all')
    setFromDate('')
    setToDate('')
    setAppliedDates({ from: '', to: '' })
    setPage(1)
  }

  const requestPayout = async (event) => {
    event.preventDefault()
    const amount = Number(payoutAmount)
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter a valid payout amount')
    if (amount < minimumPayout) return toast.error(`Minimum payout is ${money(minimumPayout)}`)
    if (amount > availableBalance) return toast.error('Payout amount exceeds the available balance')
    if (!bankAccountId) return toast.error('Select a bank account')

    setRequesting(true)
    try {
      await api.post('/vendor/wallet/payouts', {
        amount,
        bank_account_id: bankAccountId,
      })
      toast.success('Payout requested. Pending approval.')
      setPayoutOpen(false)
      setPayoutAmount('')
      setBankAccountId('')
      await load()
    } catch (requestError) {
      toast.error(errorMessage(requestError))
    } finally {
      setRequesting(false)
    }
  }

  const printRow = (row) => {
    let title = `${row.categoryLabel} statement`
    let content

    if (row.order) {
      const order = row.order
      title = `Order invoice ${row.reference}`
      const items = (order.items || []).map((item) => `
        <tr>
          <td>${escapeHtml(item.product_name || item.name)}</td>
          <td class="right">${escapeHtml(item.quantity)}</td>
          <td class="right">${escapeHtml(money(item.unit_price))}</td>
          <td class="right">${escapeHtml(money(item.line_total))}</td>
        </tr>`).join('')
      const shipping = order.shipping_address || {}
      content = `
        <div class="header"><div><h1>Order invoice</h1><div class="muted">${escapeHtml(row.reference)}</div></div><div class="right">${escapeHtml(formatDateTime(row.createdAt))}</div></div>
        <div class="meta">
          <div><span class="label">Customer</span>${escapeHtml(row.customer)}</div>
          <div><span class="label">Store</span>${escapeHtml(order.store_name || '—')}</div>
          <div><span class="label">Order status</span>${escapeHtml(order.status)}</div>
          <div><span class="label">Payment</span>${escapeHtml(order.payment_status || '—')} ${escapeHtml(order.payment_method || '')}</div>
          <div><span class="label">Shipping address</span>${escapeHtml([shipping.street, shipping.municipality, shipping.district, shipping.province].filter(Boolean).join(', '))}</div>
          <div><span class="label">Order placed</span>${escapeHtml(formatDateTime(row.orderCreatedAt || row.createdAt))}</div>
          <div><span class="label">Wallet status</span>${escapeHtml(row.walletStatus)}</div>
        </div>
        <table><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Unit price</th><th class="right">Total</th></tr></thead><tbody>${items || '<tr><td colspan="4">No item details</td></tr>'}</tbody></table>
        <table>
          <tbody>
            <tr><td>Items subtotal</td><td class="right">${escapeHtml(money(order.items_subtotal))}</td></tr>
            <tr><td>Delivery charge</td><td class="right">${escapeHtml(money(order.delivery_charge))}</td></tr>
            <tr><td>Tax</td><td class="right">${escapeHtml(money(order.tax))}</td></tr>
            <tr><td>Refunds</td><td class="right">${escapeHtml(money(order.refunded_amount))}</td></tr>
            <tr><td>Net order total</td><td class="right">${escapeHtml(money(order.net_total ?? order.grand_total))}</td></tr>
            <tr><td>Commission</td><td class="right">${escapeHtml(money(order.commission_amount))}</td></tr>
            <tr class="total"><td>Net vendor payable</td><td class="right">${escapeHtml(money(order.net_vendor_payable ?? order.vendor_payable))}</td></tr>
          </tbody>
        </table>
        <div class="muted">Printed from the vendor Finance statement.</div>`
    } else {
      const detailRows = [
        ['Reference', row.reference],
        ['Category', row.categoryLabel],
        ['Description', row.description],
        ['Status', row.status],
        ['Date', formatDateTime(row.createdAt)],
        ['Payment method / account', row.paymentMethod || row.customer || '—'],
        ['Balance after', row.balanceAfter == null ? '—' : money(row.balanceAfter)],
      ]
      if (row.settlement) {
        detailRows.push(
          ['Period', `${row.settlement.period_start || '—'} – ${row.settlement.period_end || '—'}`],
          ['Gross sales', money(row.settlement.gross_sales)],
          ['Commission', money(row.settlement.commission_total)],
          ['Refunds', money(row.settlement.refunds_total)],
          ['Adjustments', money(row.settlement.adjustments_total)],
        )
      }
      content = `
        <div class="header"><div><h1>${escapeHtml(title)}</h1><div class="muted">${escapeHtml(row.reference)}</div></div><div class="right">${escapeHtml(formatDateTime(row.createdAt))}</div></div>
        <div class="meta">${detailRows.map(([label, value]) => `<div><span class="label">${escapeHtml(label)}</span>${escapeHtml(value)}</div>`).join('')}</div>
        <table><tbody><tr class="total"><td>Amount</td><td class="right">${escapeHtml(signedAmount(row))}</td></tr></tbody></table>
        <div class="muted">Printed from the vendor Finance statement.</div>`
    }

    if (!writePrintDocument(title, content)) {
      toast.error('Allow pop-ups to print this finance record.')
    }
  }

  const exportStatement = () => {
    try {
      exportReportFromRows({
        columns: [
          { label: 'Date' },
          { label: 'Category' },
          { label: 'Reference' },
          { label: 'Description' },
          { label: 'Status' },
          { label: 'Payment Status' },
          { label: 'Commission', align: 'right' },
          { label: 'Amount', align: 'right' },
          { label: 'Balance After', align: 'right' },
        ],
        rows: filteredRows.map((row) => [
          formatDateTime(row.createdAt),
          row.categoryLabel,
          row.reference,
          row.description,
          row.status,
          row.paymentStatus || '',
          row.order ? money(row.order.commission_amount) : '',
          signedAmount(row),
          row.balanceAfter == null ? '' : money(row.balanceAfter),
        ]),
        title: walletTab === 'settlements' ? 'Vendor Settled Statements' : 'Vendor Wallet Activity',
        subtitle: walletTab === 'settlements'
          ? 'Settlements matching the selected filters.'
          : 'Filtered vendor orders, wallet movements, and payout requests.',
        sectionLabel: walletTab === 'settlements' ? 'Settled statements' : 'Orders and transactions',
        fileName: `gosika_vendor_${walletTab === 'settlements' ? 'settlements' : 'wallet'}_${new Date().toISOString().slice(0, 10)}`,
        rangeLabel: appliedDates.from || appliedDates.to
          ? `${appliedDates.from || 'Beginning'} – ${appliedDates.to || 'Present'}`
          : 'All time',
        preparedBy: personLabel(user),
        company: companyFromBranding(branding),
      })
      toast.success(`${filteredRows.length} ${walletTab === 'settlements' ? 'statement' : 'wallet record'}${filteredRows.length === 1 ? '' : 's'} exported.`)
    } catch (exportError) {
      toast.error(errorMessage(exportError))
    }
  }

  const exportEarnings = () => {
    try {
      const summary = analyticsSummary || {}
      const metrics = [
        ['Summary', 'Gross sales', money(summary.revenue)],
        ['Summary', 'Commission rate', commissionRate == null ? '' : `${Number(commissionRate)}%`],
        ['Summary', 'Commission', money(summary.commission_total)],
        ['Summary', 'Refunds', money(summary.refunds_total)],
        ['Summary', 'Projected net earnings', money(summary.net_earnings)],
        ['Wallet', 'Available balance', money(wallet?.available_balance)],
        ['Wallet', 'Pending balance', money(wallet?.pending_balance)],
        ['Wallet', 'Total withdrawn', money(totalWithdrawn)],
        ...revenueTrend.map((item) => ['Revenue trend', item.label, money(item.value)]),
      ]

      exportReportFromRows({
        columns: [
          { label: 'Section' },
          { label: 'Metric' },
          { label: 'Value', align: 'right' },
        ],
        rows: metrics,
        title: 'Vendor Finance Earnings Report',
        subtitle: 'Earnings analytics, commission, wallet balances, and revenue trend.',
        sectionLabel: 'Finance overview',
        fileName: `gosika_vendor_earnings_${earningRange}_${new Date().toISOString().slice(0, 10)}`,
        rangeLabel: EARNING_RANGES.find((item) => item.value === earningRange)?.label || earningRange,
        preparedBy: personLabel(user),
        company: companyFromBranding(branding),
      })
      toast.success('Finance earnings report exported.')
    } catch (exportError) {
      toast.error(errorMessage(exportError))
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} height={100} />)}
        </div>
        <Skeleton height={340} />
      </div>
    )
  }

  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div className="flex flex-col gap-4">
      <div className="page-header">
        <div className="page-header-left">
          <h1>{activePage === 'wallet' ? 'Wallet' : 'Finance analytics'}</h1>
          <p>
            {activePage === 'wallet'
              ? 'Manage balances, orders, transactions, settlements, and withdrawals.'
              : 'Review earnings, payment health, wallet balances, and settlement trends.'}
          </p>
        </div>
        {activePage === 'wallet' && (
          <Button
            variant="primary"
            icon={Banknote}
            onClick={() => {
              setPayoutAmount(availableBalance.toFixed(2))
              setPayoutOpen(true)
            }}
            disabled={!payoutsEnabled || !payoutRequestWindowOpen || availableBalance < minimumPayout}
          >
            Withdraw available balance
          </Button>
        )}
      </div>

      <nav className="tabs" role="tablist" aria-label="Finance sections">
        <Link
          to="/vendor/finance/wallet"
          className={`tab ${activePage === 'wallet' ? 'active' : ''}`}
          role="tab"
          aria-selected={activePage === 'wallet'}
        >
          Wallet
        </Link>
        <Link
          to="/vendor/finance/analytics"
          className={`tab ${activePage === 'analytics' ? 'active' : ''}`}
          role="tab"
          aria-selected={activePage === 'analytics'}
        >
          Analytics
        </Link>
      </nav>

      {activePage === 'wallet' && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            {[
              { label: 'Total wallet balance', value: money(displayedTotalBalance), hint: 'Available + pending earnings' },
              { label: 'Available balance', value: money(wallet?.available_balance), hint: 'Ready to withdraw', tone: 'var(--success)' },
              { label: 'Pending balance', value: money(displayedPendingBalance), hint: 'Clearing or awaiting settlement' },
              { label: 'Total withdrawn', value: money(totalWithdrawn), hint: 'Payouts marked as paid' },
            ].map((item) => (
              <div key={item.label} className="kpi-card">
                <div className="kpi-label">{item.label}</div>
                <div className="kpi-value" style={{ color: item.tone }}>{item.value}</div>
                <div className="muted text-xs">{item.hint}</div>
              </div>
            ))}
          </div>

          <div className="tabs" role="tablist" aria-label="Wallet records">
            <button
              type="button"
              className={`tab ${walletTab === 'activity' ? 'active' : ''}`}
              role="tab"
              aria-selected={walletTab === 'activity'}
              onClick={() => {
                setWalletTab('activity')
                resetFilters()
              }}
            >
              Orders & transactions
            </button>
            <button
              type="button"
              className={`tab ${walletTab === 'settlements' ? 'active' : ''}`}
              role="tab"
              aria-selected={walletTab === 'settlements'}
              onClick={() => {
                setWalletTab('settlements')
                resetFilters()
              }}
            >
              Settled statements
            </button>
          </div>
        </>
      )}

      {activePage === 'analytics' && (analyticsLoading ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} height={110} />)}
        </div>
      ) : analyticsError ? (
        <ErrorState
          message={analyticsError}
          onRetry={() => setAnalyticsRetry((retry) => retry + 1)}
        />
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            {[
              {
                label: 'Gross sales',
                value: money(analyticsSummary?.revenue),
                hint: 'Non-cancelled orders in this period',
                icon: TrendingUp,
                color: 'var(--primary)',
              },
              {
                label: 'Commission',
                value: money(analyticsSummary?.commission_total),
                hint: `Platform fee${commissionRate == null ? '' : ` · ${Number(commissionRate)}%`}`,
                icon: Percent,
                color: 'var(--danger)',
              },
              {
                label: 'Refunds',
                value: money(analyticsSummary?.refunds_total),
                hint: 'Completed refunds in this period',
                icon: RotateCcw,
                color: '#f59e0b',
              },
              {
                label: 'Projected net earnings',
                value: money(analyticsSummary?.net_earnings),
                hint: 'Estimate includes unpaid orders; withdrawable balance is credited funds only',
                icon: PiggyBank,
                color: 'var(--success)',
              },
              {
                label: 'Withdrawable',
                value: money(wallet?.available_balance),
                hint: `Pending ${money(wallet?.pending_balance)} · Total ${money(wallet?.balance)}`,
                icon: WalletIcon,
                color: '#2563eb',
              },
              {
                label: 'Total withdrawn',
                value: money(totalWithdrawn),
                hint: 'Payouts marked paid',
                icon: Coins,
                color: 'var(--ink)',
              },
            ].map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label} className="card flex flex-col justify-between" style={{ padding: '16px 18px', margin: 0 }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="muted text-xs font-semibold uppercase" style={{ letterSpacing: '0.04em' }}>{item.label}</span>
                    <span className="avatar" style={{ width: 32, height: 32, background: 'var(--bg)', color: item.color }}>
                      <Icon size={16} />
                    </span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>{item.value}</div>
                  <div className="muted text-xs mt-1">{item.hint}</div>
                </div>
              )
            })}
          </div>

          <section className="card" aria-labelledby="finance-revenue-heading" style={{ padding: '20px 24px' }}>
            <div className="flex items-center justify-between wrap mb-2">
              <div>
                <h3 id="finance-revenue-heading" className="flex items-center gap-2" style={{ fontSize: 16, margin: 0 }}>
                  <BarChart3 size={17} color="var(--primary)" /> Revenue growth
                </h3>
                <p className="muted text-xs" style={{ margin: '4px 0 0' }}>Gross order volume · NPR · {revenueTrend.length} data points</p>
              </div>
              <div className="flex items-center gap-2 wrap">
                <div className="tabs" style={{ marginBottom: 0 }}>
                  {EARNING_RANGES.map((range) => (
                    <button
                      key={range.value}
                      type="button"
                      className={`tab ${earningRange === range.value ? 'active' : ''}`}
                      onClick={() => setEarningRange(range.value)}
                      aria-pressed={earningRange === range.value}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm flex items-center gap-1"
                  onClick={exportEarnings}
                  disabled={!analyticsSummary}
                >
                  <Download size={13} /> Export earnings
                </button>
              </div>
            </div>
            {revenueTrend.length ? (
              <FluidLineChart
                labels={revenueTrend.map((point) => point.label)}
                values={revenueTrend.map((point) => Number(point.value) || 0)}
                formatValue={(value, short) => money(value, { decimals: short ? 0 : 2 })}
                height={250}
              />
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No revenue data"
                message="Sales for this period will appear here."
              />
            )}
          </section>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 16, alignItems: 'stretch' }}>
            <section className="card" aria-labelledby="finance-wallet-heading">
              <h3 id="finance-wallet-heading" className="flex items-center gap-2" style={{ fontSize: 16, margin: '0 0 12px' }}>
                <WalletIcon size={16} color="var(--primary)" /> Wallet balance mix
              </h3>
              {Number(wallet?.balance || 0) > 0 ? (
                <>
                  <FluidDoughnutChart
                    segments={[
                      { label: 'Available', value: availableBalance, color: '#16a34a' },
                      { label: 'Pending', value: Number(wallet?.pending_balance || 0), color: '#ff8a3d' },
                    ]}
                    centerLabel="Wallet total"
                    centerValue={money(wallet?.balance, { decimals: 0 })}
                    height={180}
                  />
                  <div className="flex items-center justify-between muted text-xs">
                    <span>
                      <i aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, marginRight: 6, borderRadius: '50%', background: '#16a34a' }} />
                      Available {money(wallet?.available_balance)}
                    </span>
                    <span>
                      <i aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, marginRight: 6, borderRadius: '50%', background: '#ff8a3d' }} />
                      Pending {money(wallet?.pending_balance)}
                    </span>
                  </div>
                </>
              ) : (
                <EmptyState icon={WalletIcon} title="No wallet balance" message="Wallet funds will be shown here." />
              )}
            </section>

            <section className="card" aria-labelledby="finance-payments-heading">
              <div className="flex items-center justify-between mb-2">
                <h3 id="finance-payments-heading" className="flex items-center gap-2" style={{ fontSize: 16, margin: 0 }}>
                  <Percent size={16} color="var(--primary)" /> Payment status
                </h3>
                <span className="muted text-xs">{EARNING_RANGES.find((range) => range.value === earningRange)?.label}</span>
              </div>
              {paymentBreakdown.total ? (
                <>
                  <FluidDoughnutChart
                    segments={paymentBreakdown.segments}
                    centerLabel="Orders"
                    centerValue={paymentBreakdown.total.toLocaleString()}
                    height={180}
                  />
                  <div className="flex flex-col gap-2">
                    {paymentBreakdown.segments.map((segment) => (
                      <div key={segment.label} className="flex items-center justify-between text-xs">
                        <span className="capitalize">
                          <i aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, marginRight: 6, borderRadius: '50%', background: segment.color }} />
                          {segment.label}
                        </span>
                        <span className="font-semibold">{segment.value.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState icon={Percent} title="No payment data" message="Order payment statuses for this period will appear here." />
              )}
            </section>

            <section className="card" aria-labelledby="finance-settlements-heading">
              <div className="flex items-center justify-between mb-3">
                <h3 id="finance-settlements-heading" className="flex items-center gap-2" style={{ fontSize: 16, margin: 0 }}>
                  <Coins size={16} color="var(--primary)" /> Recent settlements
                </h3>
                <span className="muted text-xs">{rows.filter((row) => row.category === 'settlements').length} total</span>
              </div>
              {rows.filter((row) => row.category === 'settlements').slice(0, 3).length ? (
                <div className="flex flex-col gap-3">
                  {rows.filter((row) => row.category === 'settlements').slice(0, 3).map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-3" style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <div className="font-medium text-sm">{row.reference}</div>
                        <div className="muted text-xs">{row.settlement?.period_end || formatDateTime(row.createdAt)}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-sm">{money(row.settlement?.net_payable ?? row.amount)}</div>
                        <StatusBadge status={row.status} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Coins}
                  title="No settlements yet"
                  message="Settlement records will appear here."
                />
              )}
            </section>
          </div>
        </>
      ))}

      {activePage === 'wallet' && (
        <div className="card">
          <div className="flex items-center justify-between wrap mb-2">
            <div>
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>
                {walletTab === 'settlements' ? 'Settled statements' : 'Orders & transactions'}
              </h3>
              <p className="muted text-xs" style={{ margin: 0 }}>
                {walletTab === 'settlements'
                  ? 'Settlement periods, payable amounts, and status.'
                  : 'Order values and wallet balance movements are shown separately.'}
              </p>
            </div>
            <div className="flex items-center gap-2 wrap">
              <ExportScopeNote>Exports every matching record in this tab across all pages.</ExportScopeNote>
              <button type="button" className="btn btn-outline btn-sm flex items-center gap-1" onClick={exportStatement} disabled={!filteredRows.length}>
                <Download size={14} /> Export filtered report
              </button>
            </div>
          </div>

          <FilterBar
            search={search}
            onSearchChange={(value) => { setPage(1); setSearch(value) }}
            debounceMs={300}
            searchPlaceholder={walletTab === 'settlements'
              ? 'Search settlement number...'
              : 'Search order, customer, transaction, or reference...'}
            statusFilter={statusFilter}
            onStatusChange={(value) => { setPage(1); setStatusFilter(value) }}
            statusOptions={statusOptions}
            fromDate={fromDate}
            toDate={toDate}
            onFromDateChange={setFromDate}
            onToDateChange={setToDate}
            onApplyFilters={() => {
              setPage(1)
              setAppliedDates({ from: fromDate, to: toDate })
            }}
            onReset={resetFilters}
            extraFilters={walletTab === 'settlements' ? null : (
              <>
                <select
                  className="input"
                  aria-label="Filter by category"
                  value={categoryFilter}
                  onChange={(event) => { setPage(1); setCategoryFilter(event.target.value) }}
                  style={{ height: 36, flex: '1 1 150px', minWidth: 150, fontSize: 13, borderRadius: 8, fontWeight: 600 }}
                >
                  <option value="all">All categories</option>
                  <option value="orders">Orders</option>
                  <option value="transactions">Wallet transactions</option>
                  <option value="refunds">Refunds</option>
                  <option value="payouts">Payout requests</option>
                </select>
                <select
                  className="input"
                  aria-label="Filter by payment status"
                  value={paymentFilter}
                  onChange={(event) => { setPage(1); setPaymentFilter(event.target.value) }}
                  style={{ height: 36, flex: '1 1 150px', minWidth: 150, fontSize: 13, borderRadius: 8, fontWeight: 600 }}
                >
                  <option value="all">All payment statuses</option>
                  {PAYMENT_STATUSES.map((value) => (
                    <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </>
            )}
          />

        {visibleRows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category / Reference</th>
                  <th>Details</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>Balance after</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td className="muted text-sm">{formatDateTime(row.createdAt)}</td>
                    <td>
                      <div className="font-medium">{row.categoryLabel}</div>
                      <div className="muted text-xs">{row.reference || '—'}</div>
                    </td>
                    <td>
                      <div>{row.description || '—'}</div>
                      {(row.customer || row.paymentStatus) && (
                        <div className="muted text-xs">
                          {[row.customer, row.paymentStatus && `Payment ${row.paymentStatus}`, row.paymentMethod].filter(Boolean).join(' · ')}
                        </div>
                      )}
                      {row.order && (
                        <div className="muted text-xs">
                          Order total {money(row.grossAmount)} · Commission {money(row.commissionAmount)} · {row.walletStatus}
                        </div>
                      )}
                    </td>
                    <td><StatusBadge status={row.status} /></td>
                    <td className="font-semibold" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span className={row.direction === 'credit' ? 'text-success' : row.direction === 'debit' ? 'text-danger' : ''}>
                        {signedAmount(row)}
                      </span>
                      {row.order && (
                        <div className="muted text-xs">
                          {row.direction === 'credit' ? 'Wallet earning' : 'Estimated payable'}
                        </div>
                      )}
                    </td>
                    <td className="muted text-sm" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {row.balanceAfter == null ? '—' : money(row.balanceAfter)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-btn btn-sm"
                        title="Print record"
                        aria-label={`Print ${row.categoryLabel} ${row.reference || ''}`}
                        onClick={() => printRow(row)}
                      >
                        <Printer size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={WalletIcon}
            title={walletTab === 'settlements' ? 'No settled statements found' : 'No wallet records found'}
            message={walletTab === 'settlements'
              ? 'Try changing the search, status, or date filters.'
              : 'Try changing the search, status, category, payment, or date filters.'}
          />
        )}
        {filteredRows.length > 0 && (
          <Pagination
            page={page}
            lastPage={lastPage}
            total={filteredRows.length}
            perPage={PAGE_SIZE}
            onChange={setPage}
          />
        )}
        </div>
      )}

      {activePage === 'wallet' && (
        <div className="alert alert-info" style={{ marginBottom: 0 }}>
          {payoutsEnabled
            ? <>{payoutRequestWindowOpen
              ? <>Withdrawals can only be requested from your available balance. Paid, delivered orders become withdrawable after the admin-configured {wallet?.settlement_holding_days ?? 'holding'}-day holding period. Payout schedule: {payoutFrequencyLabel}.</>
              : <>Payout requests are closed. Requests are accepted on {payoutRequestWindowLabel} (Nepal time). Your available balance remains in your wallet until then.</>}</>
            : 'Vendor payouts are currently disabled by the administrator.'}
        </div>
      )}

      <Modal open={payoutOpen} onClose={() => setPayoutOpen(false)} title="Withdraw available balance">
        <form onSubmit={requestPayout} className="flex flex-col gap-2">
          <p className="muted text-sm" style={{ marginTop: 0 }}>
            Request a payout to a registered bank account. Minimum payout: {money(minimumPayout)}.
            {' '}Payout schedule: {payoutFrequencyLabel}. {wallet?.requires_manual_payout_approval === false
              ? 'Requests are auto-approved; payout completion is still recorded by the admin.'
              : 'Requests require admin approval.'}
          </p>
          <Input
            label="Amount (NPR)"
            type="number"
            min={minimumPayout}
            max={availableBalance}
            step="0.01"
            required
            value={payoutAmount}
            onChange={(event) => setPayoutAmount(event.target.value)}
            hint={`Available: ${money(availableBalance)}`}
          />
          {bankAccounts.length ? (
            <Select label="Bank account" required value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}>
              <option value="">Select bank account</option>
              {bankAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.bank_name} ••••{String(account.account_number || '').slice(-4)}
                </option>
              ))}
            </Select>
          ) : (
            <div className="alert alert-warning">
              No bank account found. Add one from <Link to="/vendor/bank-accounts">Bank Account settings</Link> before requesting a payout.
            </div>
          )}
          <Button type="submit" block disabled={requesting || !payoutAmount || !bankAccountId}>
            {requesting ? <Spinner size={15} color="#fff" /> : 'Request payout'}
          </Button>
        </form>
      </Modal>
    </div>
  )
}
