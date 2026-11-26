import React from 'react'

export default function PayoutProofFields({
  providerReference,
  onProviderReferenceChange,
  notes,
  onNotesChange,
  proofFiles,
  onProofFilesChange,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 700 }}>
        Transfer reference
        <input
          className="input"
          value={providerReference}
          onChange={(event) => onProviderReferenceChange(event.target.value)}
          maxLength={120}
          placeholder="Bank transaction or reference ID"
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 700 }}>
        Notes
        <textarea
          className="input"
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Optional transfer details"
          style={{ resize: 'vertical' }}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 700 }}>
        Receipts or screenshots
        <input
          className="input"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          multiple
          onChange={(event) => onProofFilesChange(Array.from(event.target.files || []))}
        />
      </label>

      {proofFiles.length > 0 && (
        <div className="muted text-xs">
          {proofFiles.map((file) => file.name).join(' · ')}
        </div>
      )}
      <div className="muted text-xs">
        A transfer reference or at least one receipt/screenshot is required. Up to 5 JPG, PNG, or PDF files, 5 MB each.
      </div>
    </div>
  )
}
