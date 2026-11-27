import { useState } from 'react'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { buildVariantCombinations, parseVariantOptions } from '../../utils/productForm'

const initialDefinitions = (variants) => {
  const keys = Array.from(new Set(
    variants.flatMap((variant) => Object.keys(parseVariantOptions(variant.options))),
  ))
  return keys.length ? keys.map((key) => ({ key, values: '' })) : [{ key: '', values: '' }]
}

export default function ProductVariantBuilder({
  variants,
  onChange,
  errors = {},
  disabled,
  allowImage = false,
  allowSku = true,
  defaultPrice = '',
}) {
  const [definitions, setDefinitions] = useState(() => initialDefinitions(variants))
  const [localError, setLocalError] = useState('')

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: [
      'minmax(140px, 1.4fr)',
      ...(allowSku ? ['minmax(100px, .8fr)'] : []),
      'minmax(100px, .8fr)',
      'minmax(100px, .8fr)',
      'minmax(80px, .6fr)',
      'minmax(160px, 1.2fr)',
      ...(allowImage ? ['minmax(130px, .8fr)'] : []),
      '36px',
    ].join(' '),
    gap: 8,
    alignItems: 'start',
  }

  const updateDefinition = (index, key, value) => {
    setDefinitions((current) => current.map((definition, definitionIndex) => (
      definitionIndex === index ? { ...definition, [key]: value } : definition
    )))
  }

  const generate = () => {
    const generated = buildVariantCombinations(definitions, {
      sku: '',
      name: '',
      price: defaultPrice || '',
      compare_at_price: '',
      quantity: '0',
      options: '',
      image: null,
    })

    if (!generated.length) {
      setLocalError('Enter an option name and at least one value to generate variants.')
      return
    }

    const existingOptions = new Set(variants.map((variant) => String(variant.options || '').trim()))
    const fresh = generated.filter((variant) => !existingOptions.has(variant.options.trim()))
    if (!fresh.length) {
      setLocalError('Those combinations are already in the variant table.')
      return
    }

    onChange([...variants, ...fresh])
    setLocalError('')
  }

  const setVariant = (index, key, value) => {
    onChange(variants.map((variant, variantIndex) => (
      variantIndex === index ? { ...variant, [key]: value } : variant
    )))
  }

  const removeVariant = (index) => {
    onChange(variants.filter((_, variantIndex) => variantIndex !== index))
  }

  return (
    <div className="variant-builder">
      <div className="variant-generator">
        <div className="flex items-center justify-between gap-2 mb-2">
          <strong className="text-sm">Build combinations</strong>
          <span className="muted text-xs">Size, color, material, or custom options</span>
        </div>
        {definitions.map((definition, index) => (
          <div key={index} className="variant-definition-row">
            <input
              className="input"
              value={definition.key}
              onChange={(event) => updateDefinition(index, 'key', event.target.value)}
              placeholder="Option name (e.g. size)"
              aria-label={`Option ${index + 1} name`}
              disabled={disabled}
            />
            <input
              className="input"
              value={definition.values}
              onChange={(event) => updateDefinition(index, 'values', event.target.value)}
              placeholder="Values (e.g. S, M, L)"
              aria-label={`Option ${index + 1} values`}
              disabled={disabled}
            />
            {definitions.length > 1 && (
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={() => setDefinitions((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                disabled={disabled}
                title="Remove option"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setDefinitions((current) => [...current, { key: '', values: '' }])} disabled={disabled}>
            <Plus size={14} /> Add option
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={generate} disabled={disabled}>
            <Sparkles size={14} /> Generate variants
          </button>
          <span className="muted text-xs">Up to 50 combinations at a time.</span>
        </div>
        {localError && <div className="field-error mt-2">{localError}</div>}
      </div>

      <div className="variant-table-wrap">
        <div className="variant-table-head" style={gridStyle}>
          <span>Variant</span>
          {allowSku && <span>SKU</span>}
          <span>Price (NPR)</span>
          <span>Compare at</span>
          <span>Stock</span>
          <span>Options</span>
          {allowImage && <span>Image</span>}
          <span />
        </div>
        {variants.map((variant, index) => (
          <div key={index} className="variant-table-row" style={gridStyle}>
            <div>
              <input
                className="input"
                value={variant.name || ''}
                onChange={(event) => setVariant(index, 'name', event.target.value)}
                placeholder={`Variant ${index + 1}`}
                disabled={disabled}
                aria-label={`Variant ${index + 1} name`}
              />
              {errors[`variants.${index}.name`]?.[0] && <small className="field-error">{errors[`variants.${index}.name`][0]}</small>}
            </div>
            {allowSku && (
              <div>
                <input
                  className="input"
                  value={variant.sku || ''}
                  onChange={(event) => setVariant(index, 'sku', event.target.value)}
                  placeholder="Auto"
                  disabled={disabled}
                  aria-label={`Variant ${index + 1} SKU`}
                />
                {errors[`variants.${index}.sku`]?.[0] && <small className="field-error">{errors[`variants.${index}.sku`][0]}</small>}
              </div>
            )}
            <div>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={variant.price ?? ''}
                onChange={(event) => setVariant(index, 'price', event.target.value)}
                placeholder="0.00"
                disabled={disabled}
                aria-label={`Variant ${index + 1} price`}
              />
              {errors[`variants.${index}.price`]?.[0] && <small className="field-error">{errors[`variants.${index}.price`][0]}</small>}
            </div>
            <div>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={variant.compare_at_price ?? ''}
                onChange={(event) => setVariant(index, 'compare_at_price', event.target.value)}
                placeholder="—"
                disabled={disabled}
                aria-label={`Variant ${index + 1} compare at price`}
              />
            </div>
            <div>
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                value={variant.quantity ?? '0'}
                onChange={(event) => setVariant(index, 'quantity', event.target.value)}
                disabled={disabled}
                aria-label={`Variant ${index + 1} stock`}
              />
            </div>
            <div>
              <input
                className="input"
                value={variant.options || ''}
                onChange={(event) => setVariant(index, 'options', event.target.value)}
                placeholder="color=Red, size=M"
                disabled={disabled}
                aria-label={`Variant ${index + 1} options`}
              />
              {errors[`variants.${index}.options`]?.[0] && <small className="field-error">{errors[`variants.${index}.options`][0]}</small>}
            </div>
            {allowImage && (
              <div>
                <input
                  type="file"
                  accept="image/*"
                  className="input"
                  onChange={(event) => setVariant(index, 'image', event.target.files?.[0] || null)}
                  disabled={disabled}
                  aria-label={`Variant ${index + 1} image`}
                />
                {variant.image?.name && <small className="muted text-xs">{variant.image.name}</small>}
                {errors[`variants.${index}.image`]?.[0] && <small className="field-error">{errors[`variants.${index}.image`][0]}</small>}
              </div>
            )}
            <button
              type="button"
              className="icon-btn icon-btn-sm text-danger"
              onClick={() => removeVariant(index)}
              disabled={disabled}
              title={`Remove variant ${index + 1}`}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {!variants.length && (
          <div className="variant-empty muted">
            No variants yet. Add one manually or generate combinations above.
          </div>
        )}
      </div>
    </div>
  )
}
