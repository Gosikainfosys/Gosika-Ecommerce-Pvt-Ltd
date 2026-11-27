import { useEffect, useState } from 'react'
import { CheckCircle2, Film, Trash2, Upload, Video } from 'lucide-react'
import { Field } from './Input'
import { apiMedia } from '../../utils/format'

const MAX_VIDEO_SIZE = 50 * 1024 * 1024
const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-m4v']

export default function DemoVideoUpload({ value, file, onChange, onRemove, error, disabled }) {
  const [localError, setLocalError] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')

  const source = file ? previewUrl : apiMedia(value)

  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      return undefined
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const handleFile = (event) => {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected || disabled) return

    if (!ALLOWED_TYPES.includes(selected.type)) {
      setLocalError('Choose an MP4, WebM, OGG, or MOV video file.')
      return
    }
    if (selected.size > MAX_VIDEO_SIZE) {
      setLocalError('Demo video must be 50 MB or smaller.')
      return
    }

    setLocalError('')
    onChange(selected)
  }

  const remove = () => {
    setLocalError('')
    onRemove()
  }

  const shownError = localError || error

  return (
    <Field
      label="Demo video"
      hint="Upload an MP4, WebM, OGG, or MOV file up to 50 MB. It will be hosted with the product."
      error={shownError}
    >
      <div className="demo-video-upload">
        {source ? (
          <div className="demo-video-preview">
            <video controls preload="metadata" src={source} aria-label="Demo video preview" />
            <div className="demo-video-preview-info">
              <span className="flex items-center gap-1" style={{ minWidth: 0 }}>
                <Film size={14} className="muted" />
                <span className="text-xs truncate">{file?.name || 'Uploaded demo video'}</span>
                {file && <span className="product-new-badge">NEW</span>}
              </span>
              <button type="button" className="btn btn-outline btn-sm" onClick={remove} disabled={disabled}>
                <Trash2 size={13} /> Remove video
              </button>
            </div>
          </div>
        ) : (
          <label className={`demo-video-dropzone${disabled ? ' is-disabled' : ''}`}>
            <input type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime,video/x-m4v" onChange={handleFile} disabled={disabled} />
            <Video size={22} />
            <strong className="text-sm">Click to upload a demo video</strong>
            <span className="muted text-xs">MP4, WebM, OGG, or MOV · up to 50 MB</span>
          </label>
        )}
        {source && (
          <label className={`btn btn-soft btn-sm${disabled ? ' is-disabled' : ''}`} style={{ marginTop: 10, cursor: disabled ? 'not-allowed' : 'pointer' }}>
            <Upload size={14} /> Replace video
            <input type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime,video/x-m4v" onChange={handleFile} disabled={disabled} style={{ display: 'none' }} />
          </label>
        )}
        {source && !file && (
          <span className="flex items-center gap-1 muted text-xs" style={{ marginTop: 8 }}>
            <CheckCircle2 size={13} color="var(--success)" /> Saved on the server
          </span>
        )}
      </div>
    </Field>
  )
}
