import React, { useEffect, useState } from 'react'
import PayoutProofFields from './PayoutProofFields'

export default function PayoutProofDialog({
  isOpen,
  onClose,
  onSubmit,
  loading,
  title,
  message,
  confirmText = 'Mark Disbursed',
}) {
  const [providerReference, setProviderReference] = useState('')
  const [notes, setNotes] = useState('')
  const [proofFiles, setProofFiles] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) {
      setProviderReference('')
      setNotes('')
      setProofFiles([])
      setError('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const submit = (event) => {
    event.preventDefault()
    if (!providerReference.trim() && proofFiles.length === 0) {
      setError('Enter a transfer reference or attach at least one receipt or screenshot.')
      return
    }
    if (proofFiles.length > 5) {
      setError('Upload no more than 5 files.')
      return
    }

    setError('')
    onSubmit({ providerReference, notes, proofFiles })
  }

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="payout-proof-title"
        onSubmit={submit}
        className="card"
        style={{ width: 'min(100%, 520px)', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div>
          <h3 id="payout-proof-title" style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{title}</h3>
          <p className="muted text-sm" style={{ margin: '7px 0 0' }}>{message}</p>
        </div>
        <PayoutProofFields
          providerReference={providerReference}
          onProviderReferenceChange={setProviderReference}
          notes={notes}
          onNotesChange={setNotes}
          proofFiles={proofFiles}
          onProofFilesChange={setProofFiles}
        />
        {error && <div role="alert" style={{ color: '#dc2626', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose} disabled={loading}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
            {loading ? 'Saving…' : confirmText}
          </button>
        </div>
      </form>
    </div>
  )
}
