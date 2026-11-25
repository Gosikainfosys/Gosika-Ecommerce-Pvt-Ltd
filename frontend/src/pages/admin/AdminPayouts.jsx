import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Banknote, Check, X, Eye, RefreshCw, Download,
  CheckCircle2, Building, User, Clock
} from 'lucide-react'
import api from '../../api/client'
import PageHeader from '../../components/admin/PageHeader'
import DataTable from '../../components/admin/DataTable'
import FilterBar from '../../components/admin/FilterBar'
import ConfirmDialog from '../../components/admin/ConfirmDialog'
import StatusBadge from '../../components/commerce/StatusBadge'
import { money, formatDateTime, timeAgo } from '../../utils/format'
import { useToast } from '../../context/ToastContext'
import { useBranding } from '../../context/BrandingContext'
import { useAuth } from '../../context/AuthContext'
import { exportReportFromRows, companyFromBranding, personLabel } from '../../utils/reportExport'

export default function AdminPayouts() {
  const { user } = useAuth()
  const branding = useBranding()
  const toast = useToast()
  const [payouts, setPayouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profilesPagination, setProfilesPagination] = useState(null)
  const [profilesPage, setProfilesPage] = useState(1)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('pending')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [appliedDates, setAppliedDates] = useState({ from: '', to: '' })

  const [dialogState, setDialogState] = useState({
    isOpen: false,
    action: null, // 'approve' | 'reject' | 'mark-paid'
    payout: null,
    loading: false
  })

  const loadPayouts = async () => {
    setLoading(true)
    try {
      const params = { page, per_page: 15 }
      if (statusFilter && statusFilter !== 'all') params.status = statusFilter
      if (search.trim()) params.search = search.trim()
      if (appliedDates.from) params.date_from = appliedDates.from
      if (appliedDates.to) params.date_to = appliedDates.to

      const res = await api.get('/admin/wallet/payouts', { params })
      const data = api.unwrapList(res.data)
      setPayouts(data)
      if (res.data?.meta?.pagination) {
        setPagination(res.data.meta.pagination)
      } else {
        setPagination({
          current_page: page,
          last_page: 1,
          total: data.length,
          per_page: 15
        })
      }
    } catch (err) {
      toast.error('Failed to load payout requests.')
    } finally {
      setLoading(false)
    }
  }

  const loadProfiles = async () => {
    setProfilesLoading(true)
    try {
      const params = { page: profilesPage, per_page: 15 }
      if (search.trim()) params.search = search.trim()

      const res = await api.get('/admin/wallet/payout-profiles', { params })
      const data = api.unwrapList(res.data)
      setProfiles(data)
      setProfilesPagination(res.data?.meta?.pagination || null)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load store financial profiles.')
    } finally {
      setProfilesLoading(false)
    }
  }

  const refreshFinance = () => {
    loadPayouts()
    loadProfiles()
  }

  useEffect(() => {
    loadPayouts()
  }, [page, statusFilter, search, appliedDates])

  useEffect(() => {
    const timer = setTimeout(loadProfiles, 250)
    return () => clearTimeout(timer)
  }, [profilesPage, search])

  const handleAction = (action, payout) => {
    setDialogState({
      isOpen: true,
      action,
      payout,
      loading: false
    })
  }

  const handleConfirmAction = async (reason) => {
    const { action, payout } = dialogState
    if (!payout) return

    setDialogState(prev => ({ ...prev, loading: true }))
    const targetId = payout.uuid || payout.id

    try {
      if (action === 'approve') {
        await api.post(`/admin/wallet/payouts/${targetId}/approve`)
        toast.success(`Payout #${payout.payout_number || payout.id} approved for disbursement.`)
      } else if (action === 'reject') {
        await api.post(`/admin/wallet/payouts/${targetId}/reject`, { reason })
        toast.success(`Payout request rejected. Funds returned to vendor pending balance.`)
      } else if (action === 'mark-paid') {
        await api.post(`/admin/wallet/payouts/${targetId}/mark-paid`)
        toast.success(`Payout marked as paid / transferred.`)
      }

      setDialogState({ isOpen: false, action: null, payout: null, loading: false })
      refreshFinance()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Payout operation failed.')
      setDialogState(prev => ({ ...prev, loading: false }))
    }
  }

  const exportCSV = () => {
    exportReportFromRows({
      columns: [
        { label: 'Payout #' },
        { label: 'Vendor' },
        { label: 'Bank Name' },
        { label: 'Account #' },
        { label: 'Amount', align: 'right' },
        { label: 'Status' },
        { label: 'Requested At' },
      ],
      rows: payouts.map(p => [
        p.payout_number || p.id,
        p.vendor_name || p.vendor?.company_name || '',
        p.bank_account?.bank_name || 'Bank Transfer',
        p.bank_account?.account_number || '',
        p.amount || 0,
        p.status || '',
        formatDateTime(p.created_at || p.requested_at)
      ]),
      title: 'Vendor Payouts Report',
      subtitle: 'Bank transfer payouts processed to merchant vendors with remittance details.',
      sectionLabel: 'Payout Ledger',
      fileName: `gosika_payouts_${new Date().toISOString().slice(0, 10)}`,
      preparedBy: personLabel(user),
      company: companyFromBranding(branding),
    })
    toast.success('Payouts exported as branded report.')
  }

  const rows = [
    ...profiles.map(profile => ({
      ...profile,
      row_type: 'profile',
      row_key: `profile-${profile.vendor_id}`,
    })),
    ...payouts.map(payout => ({
      ...payout,
      row_type: 'payout',
      row_key: `payout-${payout.uuid || payout.id}`,
    })),
  ]

  const columns = [
    {
      header: 'Store / Payout #',
      render: item => (
        <div>
          {item.row_type === 'profile' ? (
            <>
              <Link
                to={`/admin/finance/settlements/vendors/${item.vendor_id}`}
                style={{ fontWeight: 800, color: 'var(--primary)', textDecoration: 'none' }}
              >
                {item.vendor_name || 'Vendor'}
              </Link>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Vendor: {item.vendor_status || '—'}</div>
              {(item.stores || []).map(store => (
                <div key={store.id} style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {store.name} · {store.status}
                </div>
              ))}
              {!(item.stores || []).length && <div style={{ fontSize: 11, color: 'var(--muted)' }}>No store profile</div>}
              {item.pan_vat && <div style={{ fontSize: 11, color: 'var(--muted)' }}>PAN/VAT: {item.pan_vat}</div>}
            </>
          ) : (
            <>
              <div style={{ fontWeight: 800, color: 'var(--ink)', fontSize: 13 }}>
                #{item.payout_number || item.id}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {timeAgo(item.created_at || item.requested_at)}
              </div>
            </>
          )}
        </div>
      )
    },
    {
      header: 'Vendor / Bank Account',
      render: item => (
        item.row_type === 'profile' ? (
          (item.bank_accounts || []).length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {item.bank_accounts.map(account => (
                <div key={account.id}>
                  <div style={{ fontWeight: 700 }}>{account.bank_name}{account.is_default ? ' · Default' : ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {account.account_name} · {account.account_number}
                  </div>
                  <div style={{ fontSize: 10.5, color: account.is_verified ? '#15803d' : '#b45309' }}>
                    {account.branch_name || account.account_type || 'Bank account'} · {account.is_verified ? 'Verified' : 'Unverified'}
                  </div>
                </div>
              ))}
            </div>
          ) : <span style={{ color: 'var(--muted)' }}>No bank account on file</span>
        ) : (
          <div>
            <Link
              to={item.vendor_id ? `/admin/finance/settlements/vendors/${item.vendor_id}` : '#'}
              style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', textDecoration: 'none' }}
              className="hover:text-primary"
            >
              {item.vendor_name || item.vendor?.company_name || 'Vendor'}
            </Link>
            {(item.bank_account || item.bankAccount) ? (
              <div style={{ marginTop: 3 }}>
                <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--ink)' }}>
                  {(item.bank_account || item.bankAccount).bank_name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
                  Acct: {(item.bank_account || item.bankAccount).account_number} ({(item.bank_account || item.bankAccount).account_name})
                </div>
              </div>
            ) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>Bank Transfer</div>}
          </div>
        )
      )
    },
    {
      header: 'Wallet / Payout Amount',
      align: 'right',
      render: item => (
        item.row_type === 'profile' ? (
          <div style={{ minWidth: 130 }}>
            <div style={{ fontWeight: 900 }}>{money(item.wallet?.balance || 0)}</div>
            <div style={{ fontSize: 11, color: '#15803d' }}>Available: {money(item.wallet?.available_balance || 0)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Pending: {money(item.wallet?.pending_balance || 0)}</div>
          </div>
        ) : (
          <span style={{ fontWeight: 900, color: '#16a34a', fontSize: 14 }}>{money(item.amount)}</span>
        )
      )
    },
    {
      header: 'Settlements / Funding',
      render: item => item.row_type === 'profile' ? (
        <div style={{ minWidth: 150 }}>
          <div style={{ fontWeight: 700 }}>{item.settlements_count} settlement(s)</div>
          <div style={{ fontSize: 11, color: '#d97706' }}>Open: {money(item.open_settlement_total)}</div>
          <div style={{ fontSize: 11, color: '#b45309' }}>Held: {money(item.held_settlement_total)}</div>
          <div style={{ fontSize: 11, color: '#15803d' }}>Paid: {money(item.paid_settlement_total)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {item.payout_requests_count} payout request(s) · {item.earnings_maturity_days}-day holding period
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12 }}>
          <div>{String(item.funding_source || '—').replace(/_/g, ' ')}</div>
          {item.settlement?.settlement_number && (
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.settlement.settlement_number}</div>
          )}
        </div>
      )
    },
    {
      header: 'Status',
      render: item => <StatusBadge status={item.row_type === 'profile' ? item.vendor_status : item.status} />
    },
    {
      header: 'Actions',
      align: 'right',
      render: item => {
        if (item.row_type === 'profile') {
          return (
            <Link
              to={`/admin/finance/settlements/vendors/${item.vendor_id}`}
              className="btn btn-outline btn-xs"
              style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              View Profile
            </Link>
          )
        }

        const isPending = item.status === 'pending'
        const isApproved = item.status === 'approved'

        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
            {isPending && (
              <>
                <button
                  type="button"
                  className="btn btn-xs"
                  style={{ background: '#16a34a', color: '#fff', border: 'none' }}
                  onClick={() => handleAction('approve', item)}
                  title="Approve Payout"
                >
                  <Check size={12} style={{ marginRight: 3 }} /> Approve
                </button>

                <button
                  type="button"
                  className="btn btn-outline btn-xs"
                  style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                  onClick={() => handleAction('reject', item)}
                  title="Reject"
                >
                  <X size={12} /> Reject
                </button>
              </>
            )}

            {isApproved && (
              <button
                type="button"
                className="btn btn-xs"
                style={{ background: '#2563eb', color: '#fff', border: 'none' }}
                onClick={() => handleAction('mark-paid', item)}
                title="Mark Transfer Completed"
              >
                Mark Disbursed
              </button>
            )}
          </div>
        )
      }
    }
  ]

  const requestLastPage = pagination?.last_page || 1
  const profileLastPage = profilesPagination?.last_page || 1
  const requestFirst = pagination?.total ? (page - 1) * (pagination.per_page || 15) + 1 : 0
  const requestLast = Math.min(page * (pagination?.per_page || 15), pagination?.total || 0)
  const profileFirst = profilesPagination?.total ? (profilesPage - 1) * (profilesPagination.per_page || 15) + 1 : 0
  const profileLast = Math.min(profilesPage * (profilesPagination?.per_page || 15), profilesPagination?.total || 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Vendor Payout Requests"
        description="Verify vendor earnings withdrawals, check bank transfer details, approve payments, and confirm disbursements."
        exportInfo="Export includes only the payout requests currently shown after applied filters."
        breadcrumbs={[
          { label: 'Finance', to: '/admin/finance/payments' },
          { label: 'Payouts' }
        ]}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={exportCSV}
              style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8 }}
            >
              <Download size={14} /> Export CSV
            </button>

            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={refreshFinance}
              style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8 }}
            >
              <RefreshCw size={14} className={loading || profilesLoading ? 'spin' : ''} /> Refresh
            </button>
          </div>
        }
      />

      <FilterBar
        search={search}
        onSearchChange={(value) => { setPage(1); setProfilesPage(1); setSearch(value) }}
        debounceMs={300}
        searchPlaceholder="Search payout #, vendor, or store..."
        statusFilter={statusFilter}
        onStatusChange={(value) => { setPage(1); setStatusFilter(value) }}
        fromDate={fromDate}
        toDate={toDate}
        onFromDateChange={setFromDate}
        onToDateChange={setToDate}
        onApplyFilters={() => {
          setPage(1)
          setAppliedDates({ from: fromDate, to: toDate })
        }}
        statusOptions={[
          { value: 'pending', label: 'Pending Verification' },
          { value: 'approved', label: 'Approved (Pending Bank Transfer)' },
          { value: 'paid', label: 'Disbursed / Paid' },
          { value: 'rejected', label: 'Rejected' },
        ]}
        onReset={() => {
          setSearch('')
          setStatusFilter('pending')
          setFromDate('')
          setToDate('')
          setAppliedDates({ from: '', to: '' })
          setPage(1)
          setProfilesPage(1)
        }}
      />

      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginTop: -8 }}>
        {profilesPagination?.total ?? profiles.length} store/vendor profile(s) · {pagination?.total ?? payouts.length} payout request(s)
      </div>

      <DataTable
        columns={columns}
        data={rows}
        keyField="row_key"
        loading={loading || profilesLoading}
        emptyTitle="No stores or payout requests found"
        emptyDescription="Vendor store profiles will appear here even before payout requests are submitted."
      />

      {(profileLastPage > 1 || requestLastPage > 1) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          {profileLastPage > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Stores {profileFirst}–{profileLast} of {profilesPagination.total}
              </span>
              <button type="button" className="btn btn-outline btn-xs" onClick={() => setProfilesPage(profilesPage - 1)} disabled={profilesPage <= 1}>Previous</button>
              <button type="button" className="btn btn-outline btn-xs" onClick={() => setProfilesPage(profilesPage + 1)} disabled={profilesPage >= profileLastPage}>Next</button>
            </div>
          )}
          {requestLastPage > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Payout requests {requestFirst}–{requestLast} of {pagination.total}
              </span>
              <button type="button" className="btn btn-outline btn-xs" onClick={() => setPage(page - 1)} disabled={page <= 1}>Previous</button>
              <button type="button" className="btn btn-outline btn-xs" onClick={() => setPage(page + 1)} disabled={page >= requestLastPage}>Next</button>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={dialogState.isOpen}
        onClose={() => setDialogState({ isOpen: false, action: null, payout: null, loading: false })}
        onConfirm={handleConfirmAction}
        loading={dialogState.loading}
        title={
          dialogState.action === 'approve'
            ? `Approve Payout of ${money(dialogState.payout?.amount || 0)}?`
            : dialogState.action === 'reject'
            ? `Reject Payout Request #${dialogState.payout?.payout_number || dialogState.payout?.id}?`
            : `Confirm Bank Transfer Completed for #${dialogState.payout?.payout_number || dialogState.payout?.id}?`
        }
        message={
          dialogState.action === 'approve'
            ? 'Approving promotes the linked settlement to processing and marks this withdrawal ready for treasury bank clearance.'
            : dialogState.action === 'reject'
            ? 'Rejecting will refund the reserved funds back to the vendor wallet pending balance and return the settlement to eligible.'
            : 'Confirm that bank wire/transfer transaction has been executed.'
        }
        variant={dialogState.action === 'reject' ? 'danger' : 'success'}
        confirmText={
          dialogState.action === 'approve' ? 'Approve Payout' : dialogState.action === 'reject' ? 'Reject Payout' : 'Confirm Disbursed'
        }
        requireReason={dialogState.action === 'reject'}
        reasonPlaceholder="Provide the administrative explanation for rejecting this payout..."
      />
    </div>
  )
}
