import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export default function FormSection({
  title,
  description,
  icon: Icon,
  children,
  defaultOpen = true,
  badge,
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="card product-form-section">
      <button
        type="button"
        className="product-section-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {Icon && <span className="product-section-icon"><Icon size={17} /></span>}
        <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
          <span className="product-section-title">{title}</span>
          {description && <span className="product-section-description">{description}</span>}
        </span>
        {badge && <span className="badge badge-soft text-xs">{badge}</span>}
        <ChevronDown
          size={17}
          className="muted"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}
        />
      </button>
      {open && <div className="product-section-body">{children}</div>}
    </section>
  )
}
