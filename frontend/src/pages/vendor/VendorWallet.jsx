import React, { useCallback, useEffect, useState } from 'react'
import { Download, Wallet as WalletIcon, ArrowDownLeft, ArrowUpRight, AlertCircle, Banknote } from 'lucide-react'
import api from '../../api/client'
import { useList } from '../../hooks/useApi'
import StatusBadge from '../../components/commerce/StatusBadge'
import { Skeleton } from '../../components/ui/Skeleton'
import Pagination from '../../components/ui/Pagination'
import Select from '../../components/ui/Select'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Spinner from '../../components/ui/Spinner'
import { useToast } from '../../context/ToastContext'
import { money, formatDateTime, errorMessage } from '../../utils/format'
import FilterBar from '../../components/admin/FilterBar'
import ExportScopeNote from '../../components/admin/ExportScopeNote'
import { exportReportFromRows, companyFromBranding, personLabel } from '../../utils/reportExport'
import { useBranding } from '../../context/BrandingContext'
import { useAuth } from '../../context/AuthContext'

const OPEN_PAYOUT_STATUSES = ['pending', 'approved', 'processing']

const isRequestableSettlement = (settlement) =>
  settlement.status === 'eligible' &&
  Number(settlement.net_payable || 0) > 0 &&
  !(settlement.payout_requests || []).some((payout) => OPEN_PAYOUT_STATUSES.includes(payout.status))

export default function VendorWallet() {
  const toast = useToast()
  const { user } = useAuth()
  const branding = useBranding()
  const [wallet, setWallet] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [appliedDates, setAppliedDates] = useState({ from: '', to: '' })
  const [payoutOpen, setPayoutOpen] = useState(false)
  const [settlements, setSettlements] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [settlementId, setSettlementId] = useState('')
  const [bankAccountId, setBankAccountId] = useState('')
  const [payoutLoading, setPayoutLoading] = useState(false)
  const [payoutError, setPayoutError] = useState('')
  const [requesting, setRequesting] = useState(false)

  const load = () => {
    api.get('/vendor/wallet').then((response) => {
      setWallet(response.data?.data ?? response.data)
    }).catch(() => {
      setError('Could not load wallet data')
    }).finally(() => {
      setLoading(false)
    })
  }
  useEffect(load, [])

  const fetchTransactions = useCallback((page, pageSize) => api.get('/vendor/wallet/transactions', {
    params: {
      page,
      per_page: pageSize,
      search: search.trim() || undefined,
      type: typeFilter === 'all' ? undefined : typeFilter,
      status: statusFilter === 'all' ? undefined : statusFilter,
      date_from: appliedDates.from || undefined,
      date_to: appliedDates.to || undefined,
    },
  }), [search, typeFilter, statusFilter, appliedDates])
  const { items: transactions, meta, page, setPage, loading: transactionsLoading } = useList(fetchTransactions, {
    deps: [search, typeFilter, statusFilter, appliedDates],
    pageSize: 15,
  })

  const requestPayout = async (e) => {
    e.preventDefault()
    if (!settlementId) return toast.error('Select an eligible settlement')
    if (!bankAccountId) return toast.error('Select a bank account')
    setRequesting(true)
    try {
      await api.post('/vendor/wallet/payouts', {
        settlement_id: settlementId,
        bank_account_id: bankAccountId,
      })
      toast.success('Payout requested. Pending approval.')
      setPayoutOpen(false)
      setSettlementId('')
      setBankAccountId('')
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRequesting(false)
    }
  }

  const openPayoutModal = async () => {
    setPayoutOpen(true)
    setSettlementId('')
    setBankAccountId('')
    setPayoutError('')
    setPayoutLoading(true)
    try {
      const [settlementsResponse, bankAccountsResponse] = await Promise.all([
        api.get('/vendor/wallet/settlements', { params: { status: 'eligible', per_page: 100 } }),
        api.get('/vendor/bank-accounts'),
      ])
      setSettlements((settlementsResponse.data?.data || []).filter(isRequestableSettlement))
      setBankAccounts(bankAccountsResponse.data?.data || [])
    } catch (err) {
      setPayoutError(errorMessage(err))
    } finally {
      setPayoutLoading(false)
    }
  }

  const exportTransactions = async () => {
    try {
      const rows = []
      let exportPage = 1
      let lastPage = 1
      do {
        const response = await api.get('/vendor/wallet/transactions', {
          params: {
            page: exportPage,
            per_page: 100,
            search: search.trim() || undefined,
            type: typeFilter === 'all' ? undefined : typeFilter,
            status: statusFilter === 'all' ? undefined : statusFilter,
            date_from: appliedDates.from || undefined,
            date_to: appliedDates.to || undefined,
          },
        })
        rows.push(...api.unwrapList(response.data))
        lastPage = response.data?.meta?.pagination?.last_page || 1
        exportPage += 1
      } while (exportPage <= lastPage)

      exportReportFromRows({
        columns: [
          { label: 'Transaction Type' },
          { label: 'Description' },
          { label: 'Status' },
          { label: 'Date' },
          { label: 'Amount', align: 'right' },
          { label: 'Balance After', align: 'right' },
        ],
        rows: rows.map((transaction) => {
          const credit = String(transaction.transaction_type).startsWith('credit_')
          return [
            (transaction.transaction_type || '').replace(/_/g, ' '),
            transaction.description || '',
            transaction.status || '',
            formatDateTime(transaction.created_at),
            `${credit ? '+' : '-'}${money(Math.abs(Number(transaction.amount || 0)))}`,
            money(transaction.balance_after),
          ]
        }),
        title: 'Vendor Wallet Transaction Report',
        subtitle: 'Filtered vendor wallet activity, balance movements and transaction statuses.',
        sectionLabel: 'Wallet Transactions',
        fileName: `gosika_vendor_wallet_${new Date().toISOString().slice(0, 10)}`,
        rangeLabel: appliedDates.from || appliedDates.to
          ? `${appliedDates.from || 'Beginning'} – ${appliedDates.to || 'Present'}`
          : 'All time',
        preparedBy: personLabel(user),
        company: companyFromBranding(branding),
      })
      toast.success(`${rows.length} filtered transaction${rows.length === 1 ? '' : 's'} exported.`)
    } catch (exportError) {
      toast.error(errorMessage(exportError))
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={100} />)}
        </div>
        <Skeleton height={300} />
      </div>
    )
  }

  if (error) return <div className="alert alert-error">{error}</div>

  const selectedSettlement = settlements.find((settlement) => settlement.id === settlementId)

  return (
    <div className="flex flex-col gap-4">
      <div className="page-header">
        <div className="page-header-left">
          <h1>Wallet</h1>
          <p>Your earnings, balances and payout requests</p>
        </div>
        <Button variant="primary" icon={Banknote} onClick={openPayoutModal}>
          Withdraw funds
        </Button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {[
          { label: 'Available balance', value: money(wallet?.available_balance), hint: 'Ready to withdraw', tone: 'var(--success)' },
          { label: 'Pending balance', value: money(wallet?.pending_balance), hint: 'Clearing / awaiting delivery' },
          { label: 'Total balance', value: money(wallet?.balance), hint: 'Available + pending' },
        ].map((k) => (
          <div key={k.label} className="kpi-card">
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.tone }}>{k.value}</div>
            <div className="muted text-xs">{k.hint}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="flex items-center justify-between wrap mb-2">
          <h3 style={{ fontSize: 16 }}>Transactions</h3>
          <div className="flex items-center gap-2 wrap">
            <ExportScopeNote>Exports all matching wallet transactions across pages in the branded Excel report format.</ExportScopeNote>
            <button type="button" className="btn btn-outline btn-sm flex items-center gap-1" onClick={exportTransactions} disabled={!meta.total || transactionsLoading}>
              <Download size={14} /> Export filtered report
            </button>
          </div>
        </div>
        <FilterBar
          search={search}
          onSearchChange={(value) => { setPage(1); setSearch(value) }}
          debounceMs={300}
          searchPlaceholder="Search transaction, reference, or description..."
          statusFilter={statusFilter}
          onStatusChange={(value) => { setPage(1); setStatusFilter(value) }}
          statusOptions={[
            { value: 'completed', label: 'Completed' },
            { value: 'held', label: 'Held' },
          ]}
          fromDate={fromDate}
          toDate={toDate}
          onFromDateChange={setFromDate}
          onToDateChange={setToDate}
          onApplyFilters={() => {
            setPage(1)
            setAppliedDates({ from: fromDate, to: toDate })
          }}
          onReset={() => {
            setSearch('')
            setTypeFilter('all')
            setStatusFilter('all')
            setFromDate('')
            setToDate('')
            setAppliedDates({ from: '', to: '' })
            setPage(1)
          }}
          extraFilters={
            <select
              className="input"
              aria-label="Filter by transaction type"
              value={typeFilter}
              onChange={(event) => { setPage(1); setTypeFilter(event.target.value) }}
              style={{ height: 36, minWidth: 150, fontSize: 13, borderRadius: 8, fontWeight: 600 }}
            >
              <option value="all">All transaction types</option>
              <option value="credit">Income</option>
              <option value="debit">Withdrawals</option>
            </select>
          }
        />
        {transactionsLoading ? <Skeleton height={180} /> : transactions.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Type</th><th>Description</th><th>Status</th><th>Date</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Balance</th></tr>
              </thead>
              <tbody>
                {transactions.map((t) => {
                  const isCredit = String(t.transaction_type).startsWith('credit_')
                  return (
                    <tr key={t.id}>
                      <td>
                        <span className="flex items-center gap-2">
                          {isCredit ? <ArrowDownLeft size={15} color="var(--success)" /> : <ArrowUpRight size={15} color="var(--danger)" />}
                          <span className="capitalize font-medium">{t.transaction_type.replace(/_/g, ' ')}</span>
                        </span>
                      </td>
                      <td className="muted">{t.description || '—'}</td>
                      <td><StatusBadge status={t.status} /></td>
                      <td className="muted text-sm">{formatDateTime(t.created_at)}</td>
                      <td className="font-semibold" style={{ textAlign: 'right' }}>
                        <span className={isCredit ? 'text-success' : 'text-danger'}>{isCredit ? '+' : '-'}{money(Math.abs(t.amount))}</span>
                      </td>
                      <td className="muted text-sm" style={{ textAlign: 'right' }}>{t.balance_after != null ? money(t.balance_after) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: 32 }}>
            <div className="es-icon"><WalletIcon size={32} /></div>
            <p className="muted">No transactions yet. Your earnings will appear here as orders are completed.</p>
          </div>
        )}
        {!transactionsLoading && meta.total > 0 && (
          <Pagination page={page} lastPage={meta.last_page} total={meta.total} onChange={setPage} />
        )}
      </div>

      <div className="alert alert-info" style={{ marginBottom: 0 }}>
        <AlertCircle size={18} />
        <span>Balances update automatically after successful deliveries. Payout requests are made for eligible settlements.</span>
      </div>

      <Modal open={payoutOpen} onClose={() => setPayoutOpen(false)} title="Withdraw funds">
        <form onSubmit={requestPayout} className="flex flex-col gap-2">
          <p className="muted text-sm" style={{ marginTop: 0 }}>Choose an eligible settlement and bank account. The payout amount is locked to the settlement net payable.</p>
          {payoutLoading ? (
            <div className="flex items-center justify-center" style={{ padding: 20 }}>
              <Spinner size={20} />
            </div>
          ) : payoutError ? (
            <div className="alert alert-error">{payoutError}</div>
          ) : (
            <>
              {!settlements.length && (
                <div className="alert alert-info">No eligible settlements are currently available for payout.</div>
              )}
              {settlements.length > 0 && (
                <Select label="Eligible settlement" required value={settlementId} onChange={(e) => setSettlementId(e.target.value)}>
                  <option value="">Select a settlement</option>
                  {settlements.map((settlement) => (
                    <option key={settlement.id} value={settlement.id}>
                      {settlement.settlement_number} · {money(settlement.net_payable)}
                    </option>
                  ))}
                </Select>
              )}
              {selectedSettlement && (
                <div className="alert alert-info">
                  Payout amount: <strong>{money(selectedSettlement.net_payable)}</strong>
                </div>
              )}
              {bankAccounts.length > 0 ? (
                <Select label="Bank account" required value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                  <option value="">Select bank account</option>
                  {bankAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.bank_name} ••••{account.account_number}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="alert alert-warning">No bank accounts found. Add one to your vendor profile before requesting a payout.</div>
              )}
            </>
          )}
          <Button type="submit" block disabled={requesting || payoutLoading || !!payoutError || !settlementId || !bankAccountId}>
            {requesting ? <Spinner size={15} color="#fff" /> : 'Request payout'}
          </Button>
        </form>
      </Modal>
    </div>
  )
}
