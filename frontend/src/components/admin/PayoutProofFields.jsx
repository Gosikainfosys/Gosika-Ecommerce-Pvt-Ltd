import React, { useEffect, useState } from 'react'

export default function PayoutProofFields({
  providerReference,
  onProviderReferenceChange,
  notes,
  onNotesChange,
  proofFiles,
  onProofFilesChange,
}) {
  const [previewUrls, setPreviewUrls] = useState([])

  useEffect(() => {
    const urls = proofFiles.map((file) => (
      file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    ))
    setPreviewUrls(urls)
    return () => urls.forEach((url) => url && URL.revokeObjectURL(url))
  }, [proofFiles])

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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {proofFiles.map((file, index) => (
            <div
              key={`${file.name}-${file.lastModified}-${index}`}
              style={{ width: 108, display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              {previewUrls[index] ? (
                <img
                  src={previewUrls[index]}
                  alt={`${file.name} preview`}
                  style={{
                    width: 108,
                    height: 76,
                    objectFit: 'contain',
                    background: '#f3f4f6',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 108,
                    height: 76,
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--muted)',
                    background: '#f3f4f6',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  PDF
                </div>
              )}
              <span className="muted text-xs" title={file.name} style={{ overflowWrap: 'anywhere' }}>
                {file.name}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="muted text-xs">
        A transfer reference or at least one receipt/screenshot is required. Up to 5 JPG, PNG, or PDF files, 5 MB each.
      </div>
    </div>
  )
}
