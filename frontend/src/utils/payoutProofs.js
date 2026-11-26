import api from '../api/client'

export async function downloadPayoutProof(audience, payoutId, recordId, proof, toast) {
  const walletPath = audience === 'vendor' ? '/vendor/wallet' : '/admin/wallet'
  try {
    const response = await api.get(
      `${walletPath}/payouts/${encodeURIComponent(payoutId)}/records/${encodeURIComponent(recordId)}/proofs/${proof.index}`,
      { responseType: 'blob', skipCache: true },
    )
    const objectUrl = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = proof.name || 'payout-proof'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch (error) {
    toast.error(error.response?.data?.message || 'Could not download the payout proof.')
  }
}
