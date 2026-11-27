import { useState } from 'react'
import { CheckCircle2, GripVertical, Image as ImageIcon, Plus, Trash2, Upload } from 'lucide-react'
import { apiImage } from '../../utils/format'
import { newImageId } from '../../utils/productForm'

const MAX_IMAGES = 10
const MAX_FILE_SIZE = 5 * 1024 * 1024

export default function ProductImageGallery({ images, onChange, error, disabled, uploadProgress = 0 }) {
  const [urlInput, setUrlInput] = useState('')
  const [localError, setLocalError] = useState('')
  const [draggingIndex, setDraggingIndex] = useState(null)

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length || disabled) return

    if (images.length + files.length > MAX_IMAGES) {
      setLocalError(`Add no more than ${MAX_IMAGES} product images.`)
      return
    }

    const invalid = files.find((file) => !file.type.startsWith('image/') || file.size > MAX_FILE_SIZE)
    if (invalid) {
      setLocalError('Choose image files that are 5 MB or smaller.')
      return
    }

    try {
      const uploaded = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({ id: newImageId(), url: reader.result, file, isPrimary: false })
        reader.onerror = () => reject(new Error('Could not read the selected image.'))
        reader.readAsDataURL(file)
      })))

      const hasPrimary = images.some((image) => image.isPrimary)
      onChange([
        ...images.map((image) => ({ ...image, isPrimary: image.isPrimary || (!hasPrimary && images.indexOf(image) === 0) })),
        ...uploaded.map((image, index) => ({ ...image, isPrimary: !hasPrimary && images.length === 0 && index === 0 })),
      ])
      setLocalError('')
    } catch (uploadError) {
      setLocalError(uploadError.message)
    }
  }

  const addUrl = () => {
    const url = urlInput.trim()
    if (!url || disabled) return
    if (images.length >= MAX_IMAGES) {
      setLocalError(`Add no more than ${MAX_IMAGES} product images.`)
      return
    }

    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid URL')
    } catch {
      setLocalError('Enter a valid image URL starting with http:// or https://.')
      return
    }

    const hasPrimary = images.some((image) => image.isPrimary)
    onChange([
      ...images,
      { id: newImageId(), url, file: null, isPrimary: !hasPrimary && images.length === 0 },
    ])
    setUrlInput('')
    setLocalError('')
  }

  const removeImage = (imageId) => {
    const remaining = images.filter((image) => image.id !== imageId)
    const removedPrimary = images.find((image) => image.id === imageId)?.isPrimary
    onChange(remaining.map((image, index) => ({
      ...image,
      isPrimary: removedPrimary ? index === 0 : image.isPrimary,
    })))
    setLocalError('')
  }

  const setCover = (imageId) => {
    onChange(images.map((image) => ({ ...image, isPrimary: image.id === imageId })))
  }

  const moveImage = (from, to) => {
    if (from === null || from === to || from < 0 || to < 0 || from >= images.length || to >= images.length) return
    const reordered = [...images]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    onChange(reordered)
  }

  const handleDrop = (event, index) => {
    event.preventDefault()
    event.stopPropagation()
    if (disabled) return

    const files = Array.from(event.dataTransfer.files || [])
    if (files.length) {
      addFiles(files)
      setDraggingIndex(null)
      return
    }

    const from = Number(event.dataTransfer.getData('text/plain'))
    moveImage(Number.isInteger(from) ? from : null, index)
    setDraggingIndex(null)
  }

  const shownError = localError || error

  return (
    <div className="product-gallery">
      <div className="product-gallery-controls">
        <label className={`btn btn-outline btn-sm${disabled ? ' is-disabled' : ''}`} style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
          <Upload size={14} /> Upload images
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => addFiles(event.target.files)}
            style={{ display: 'none' }}
            disabled={disabled}
          />
        </label>
        <div className="product-gallery-url">
          <input
            type="url"
            className="input"
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addUrl()
              }
            }}
            placeholder="Paste an image URL and press Enter"
            aria-label="Product image URL"
            disabled={disabled}
          />
          <button type="button" className="btn btn-soft btn-sm" onClick={addUrl} disabled={disabled || !urlInput.trim()}>
            <Plus size={14} /> Add URL
          </button>
        </div>
        <span className="muted text-xs">{images.length}/{MAX_IMAGES} images · JPG, PNG, WEBP up to 5 MB</span>
      </div>

      {shownError && <div className="field-error mb-3" role="alert">{shownError}</div>}
      {uploadProgress > 0 && uploadProgress < 100 && (
        <div className="product-upload-progress" role="progressbar" aria-valuenow={Math.round(uploadProgress)}>
          <span style={{ width: `${uploadProgress}%` }} />
          <small>Uploading images… {Math.round(uploadProgress)}%</small>
        </div>
      )}

      {images.length ? (
        <div className="product-gallery-grid">
          {images.map((image, index) => {
            const isPrimary = Boolean(image.isPrimary)
            return (
              <div
                key={image.id}
                className={`product-image-card${isPrimary ? ' is-primary' : ''}${draggingIndex === index ? ' is-dragging' : ''}`}
                draggable={!disabled}
                onDragStart={(event) => {
                  setDraggingIndex(index)
                  event.dataTransfer.setData('text/plain', String(index))
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDrop(event, index)}
                onDragEnd={() => setDraggingIndex(null)}
              >
                <img src={apiImage(image.url)} alt={`Product image ${index + 1}`} />
                <div className="product-image-overlay">
                  <span className="product-image-index">
                    <GripVertical size={12} /> {index + 1}
                  </span>
                  <div className="product-image-actions">
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      title={isPrimary ? 'Cover image' : 'Set as cover'}
                      aria-label={isPrimary ? 'Cover image' : 'Set as cover'}
                      onClick={() => setCover(image.id)}
                      disabled={disabled}
                    >
                      <CheckCircle2 size={13} color={isPrimary ? 'var(--primary)' : 'currentColor'} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      title="Remove image"
                      aria-label="Remove image"
                      onClick={() => removeImage(image.id)}
                      disabled={disabled}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {isPrimary && <span className="product-cover-badge">COVER</span>}
                {image.file && <span className="product-new-badge">NEW</span>}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="product-gallery-empty">
          <ImageIcon size={28} />
          <div className="font-semibold">Drop product photos here</div>
          <div className="muted text-xs">or use Upload images / Add URL above</div>
        </div>
      )}
    </div>
  )
}
