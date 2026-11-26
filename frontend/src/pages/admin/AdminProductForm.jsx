import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Image as ImageIcon, Plus, Save, Trash2, Upload } from 'lucide-react'
import api from '../../api/client'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Textarea from '../../components/ui/Textarea'
import PageHeader from '../../components/admin/PageHeader'
import { useToast } from '../../context/ToastContext'
import { apiImage } from '../../utils/format'

const initialForm = {
  vendor_id: '',
  store_id: '',
  name: '',
  slug: '',
  sku: '',
  barcode: '',
  category_id: '',
  brand_id: '',
  status: 'published',
  price: '',
  compare_at_price: '',
  cost_price: '',
  quantity: '0',
  low_stock_threshold: '5',
  tax_rate: '',
  weight_grams: '0',
  dimensions: '',
  hs_code: '',
  manufacturer: '',
  short_description: '',
  description: '',
  is_variant: false,
  is_featured: false,
  is_negotiable: false,
  images: [],
  primary_image_id: '',
  variants: [],
  attributes: [],
  meta_json: '{}',
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

export default function AdminProductForm() {
  const navigate = useNavigate()
  const toast = useToast()
  const [form, setForm] = useState(initialForm)
  const [vendors, setVendors] = useState([])
  const [categories, setCategories] = useState([])
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [imageError, setImageError] = useState('')
  const [imageUrlInput, setImageUrlInput] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      api.get('/admin/vendors', { params: { status: 'approved', per_page: 100 } }),
      api.get('/categories'),
      api.get('/brands'),
    ]).then(([vendorResponse, categoryResponse, brandResponse]) => {
      if (!active) return
      const nextVendors = api.unwrapList(vendorResponse.data)
      setVendors(nextVendors)
      setCategories(api.unwrapList(categoryResponse.data))
      setBrands(api.unwrapList(brandResponse.data))
      const firstVendor = nextVendors.find((vendor) => (
        (vendor.stores || []).some((store) => store.status === 'active')
      ))
      const firstStore = firstVendor?.stores?.find((store) => store.status === 'active')
      if (firstVendor && firstStore) {
        setForm((current) => ({ ...current, vendor_id: firstVendor.id, store_id: firstStore.id }))
      }
    }).catch((error) => {
      toast.error(error.response?.data?.message || 'Failed to load product options.')
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => { active = false }
  }, [toast])

  const selectedVendor = vendors.find((vendor) => vendor.id === form.vendor_id)
  const stores = useMemo(
    () => (selectedVendor?.stores || []).filter((store) => store.status === 'active'),
    [selectedVendor],
  )
  const primaryImage = form.images.find((image) => image.id === form.primary_image_id)

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setFormError('')
  }

  const addImages = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return

    if (form.images.length + files.length > 10) {
      setImageError('Add no more than 10 product images.')
      return
    }

    const invalidFile = files.find((file) => !file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)
    if (invalidFile) {
      setImageError('Choose image files that are 5 MB or smaller.')
      return
    }

    try {
      const newImages = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({ id: newId(), file, url: reader.result })
        reader.onerror = () => reject(new Error('Could not read the selected image.'))
        reader.readAsDataURL(file)
      })))
      setForm((current) => ({
        ...current,
        images: [...current.images, ...newImages],
        primary_image_id: current.primary_image_id || newImages[0].id,
      }))
      setImageError('')
    } catch (error) {
      setImageError(error.message)
    }
  }

  const addImageUrl = () => {
    const value = imageUrlInput.trim()
    if (!value) return
    if (form.images.length >= 10) {
      setImageError('Add no more than 10 product images.')
      return
    }

    try {
      const parsed = new URL(value)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid URL')
    } catch {
      setImageError('Enter a valid image URL starting with http:// or https://.')
      return
    }

    const image = { id: newId(), file: null, url: value }
    setForm((current) => ({
      ...current,
      images: [...current.images, image],
      primary_image_id: current.primary_image_id || image.id,
    }))
    setImageUrlInput('')
    setImageError('')
  }

  const removeImage = (imageId) => {
    setForm((current) => {
      const images = current.images.filter((image) => image.id !== imageId)
      return {
        ...current,
        images,
        primary_image_id: current.primary_image_id === imageId
          ? (images[0]?.id || '')
          : current.primary_image_id,
      }
    })
    setImageError('')
  }

  const setVariant = (index, key, value) => {
    setForm((current) => {
      const variants = [...current.variants]
      variants[index] = { ...variants[index], [key]: value }
      return { ...current, variants }
    })
  }

  const addVariant = () => {
    setForm((current) => ({
      ...current,
      is_variant: true,
      variants: [...current.variants, {
        sku: '',
        name: '',
        price: '',
        compare_at_price: '',
        quantity: '0',
        options: '',
        image: null,
      }],
    }))
  }

  const removeVariant = (index) => {
    setForm((current) => {
      const variants = current.variants.filter((_, variantIndex) => variantIndex !== index)
      return { ...current, variants, is_variant: variants.length > 0 }
    })
  }

  const setAttribute = (index, key, value) => {
    setForm((current) => {
      const attributes = [...current.attributes]
      attributes[index] = { ...attributes[index], [key]: value }
      return { ...current, attributes }
    })
  }

  const addAttribute = () => setForm((current) => ({
    ...current,
    attributes: [...current.attributes, { name: '', type: 'text', values: '' }],
  }))

  const removeAttribute = (index) => setForm((current) => ({
    ...current,
    attributes: current.attributes.filter((_, attributeIndex) => attributeIndex !== index),
  }))

  const save = async (event) => {
    event.preventDefault()
    setFormError('')
    setFieldErrors({})
    setImageError('')

    if (form.images.length === 0) {
      setImageError('Add at least one product image before saving.')
      return
    }

    if (form.is_variant && !form.variants.some((variant) => variant.price !== '')) {
      setFormError('Add at least one priced variant or turn off the variant setting.')
      return
    }

    let meta
    try {
      meta = JSON.parse(form.meta_json || '{}')
      if (!meta || Array.isArray(meta) || typeof meta !== 'object') {
        throw new Error('Product metadata must be a JSON object.')
      }
    } catch {
      setFormError('Product metadata must be a valid JSON object.')
      return
    }

    setSaving(true)
    const data = new FormData()
    const append = (key, value) => {
      if (value !== undefined && value !== null && value !== '') data.append(key, String(value))
    }

    ;[
      'vendor_id', 'store_id', 'name', 'slug', 'sku', 'barcode', 'category_id', 'brand_id',
      'status', 'price', 'compare_at_price', 'cost_price', 'quantity', 'low_stock_threshold',
      'tax_rate', 'weight_grams', 'dimensions', 'hs_code', 'manufacturer',
      'short_description', 'description',
    ].forEach((key) => append(key, form[key]))
    append('is_variant', form.is_variant || form.variants.length > 0 ? '1' : '0')
    append('is_featured', form.is_featured ? '1' : '0')
    append('is_negotiable', form.is_negotiable ? '1' : '0')
    append('meta', JSON.stringify(meta))

    const uploadedImages = form.images.filter((image) => image.file)
    const uploadIndexes = new Map()
    uploadedImages.forEach((image, index) => {
      uploadIndexes.set(image.id, index)
      data.append('images[]', image.file)
    })
    form.images.filter((image) => !image.file).forEach((image) => data.append('image_urls[]', image.url))

    if (primaryImage?.file) {
      append('primary_image_upload_index', uploadIndexes.get(primaryImage.id))
    } else if (primaryImage?.url) {
      append('primary_image_url', primaryImage.url)
    }

    data.append('variants_present', '1')
    const variants = form.variants.filter((variant) => variant.price !== '')
    variants.forEach((variant, index) => {
      append(`variants[${index}][sku]`, variant.sku)
      append(`variants[${index}][name]`, variant.name)
      append(`variants[${index}][price]`, variant.price)
      append(`variants[${index}][compare_at_price]`, variant.compare_at_price)
      append(`variants[${index}][quantity]`, variant.quantity)
      String(variant.options || '').split(',').map((option) => option.trim()).filter(Boolean).forEach((option) => {
        const separator = option.indexOf('=')
        if (separator > 0) {
          const key = option.slice(0, separator).trim()
          const value = option.slice(separator + 1).trim()
          if (key && value) append(`variants[${index}][options][${key}]`, value)
        }
      })
      if (variant.image) data.append(`variants[${index}][image]`, variant.image)
    })

    form.attributes.filter((attribute) => attribute.name.trim()).forEach((attribute, index) => {
      append(`attributes[${index}][name]`, attribute.name.trim())
      append(`attributes[${index}][type]`, attribute.type)
      String(attribute.values || '').split(/[,\n]/).map((value) => value.trim()).filter(Boolean).forEach((value, valueIndex) => {
        append(`attributes[${index}][values][${valueIndex}]`, value)
      })
    })

    try {
      await api.post('/admin/products', data)
      toast.success('Product added to the catalog.')
      navigate('/admin/marketplace/products')
    } catch (error) {
      const response = error.response?.data
      if (response?.errors) {
        setFieldErrors(response.errors)
        if (response.errors.images) setImageError(response.errors.images[0])
        setFormError(response.message || 'Check the highlighted product details and try again.')
      } else {
        const message = response?.message || 'Failed to add product.'
        setFormError(message)
        toast.error(message)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Add Product"
        description="Create a complete catalog listing for an approved vendor and active store."
        breadcrumbs={[
          { label: 'Marketplace', to: '/admin/marketplace/vendors' },
          { label: 'Products', to: '/admin/marketplace/products' },
          { label: 'Add Product' },
        ]}
        actions={(
          <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('/admin/marketplace/products')}>
            <ArrowLeft size={14} /> Back to products
          </button>
        )}
      />

      <form onSubmit={save} style={{ display: 'grid', gap: 16 }}>
        {formError && <div className="alert alert-error" role="alert">{formError}</div>}

        <section className="card" style={{ padding: 20 }}>
          <h2 className="text-lg font-semibold mb-4">Vendor and listing</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Select
              label="Vendor"
              required
              value={form.vendor_id}
              disabled={loading || saving}
              error={fieldErrors.vendor_id?.[0]}
              onChange={(event) => {
                const vendor = vendors.find((item) => item.id === event.target.value)
                const firstStore = vendor?.stores?.find((store) => store.status === 'active')
                setForm((current) => ({
                  ...current,
                  vendor_id: event.target.value,
                  store_id: firstStore?.id || '',
                }))
              }}
            >
              <option value="">Select an approved vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>{vendor.company_name}</option>
              ))}
            </Select>
            <Select
              label="Store"
              required
              value={form.store_id}
              disabled={loading || saving || stores.length === 0}
              error={fieldErrors.store_id?.[0]}
              onChange={(event) => update('store_id', event.target.value)}
            >
              <option value="">Select an active store</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </Select>
            <Input label="Product name" required maxLength={200} value={form.name} onChange={(event) => update('name', event.target.value)} error={fieldErrors.name?.[0]} />
            <Input label="URL slug" maxLength={220} value={form.slug} onChange={(event) => update('slug', event.target.value)} hint="Leave blank to generate automatically" error={fieldErrors.slug?.[0]} />
            <Input label="SKU" maxLength={80} value={form.sku} onChange={(event) => update('sku', event.target.value)} error={fieldErrors.sku?.[0]} />
            <Input label="Barcode" maxLength={80} value={form.barcode} onChange={(event) => update('barcode', event.target.value)} error={fieldErrors.barcode?.[0]} />
            <Select label="Category" value={form.category_id} onChange={(event) => update('category_id', event.target.value)} error={fieldErrors.category_id?.[0]}>
              <option value="">No category</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
            <Select label="Brand" value={form.brand_id} onChange={(event) => update('brand_id', event.target.value)} error={fieldErrors.brand_id?.[0]}>
              <option value="">Unbranded</option>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </Select>
            <Select label="Listing status" value={form.status} onChange={(event) => update('status', event.target.value)} error={fieldErrors.status?.[0]}>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="pending_review">Pending review</option>
              <option value="out_of_stock">Out of stock</option>
              <option value="hidden">Hidden</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
        </section>

        <section className="card" style={{ padding: 20 }}>
          <h2 className="text-lg font-semibold mb-4">Pricing, inventory, and shipping</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Input label="Price (NPR)" type="number" min="0" step="0.01" required value={form.price} onChange={(event) => update('price', event.target.value)} error={fieldErrors.price?.[0]} />
            <Input label="Compare-at price (NPR)" type="number" min="0" step="0.01" value={form.compare_at_price} onChange={(event) => update('compare_at_price', event.target.value)} error={fieldErrors.compare_at_price?.[0]} />
            <Input label="Cost price (NPR)" type="number" min="0" step="0.01" value={form.cost_price} onChange={(event) => update('cost_price', event.target.value)} error={fieldErrors.cost_price?.[0]} />
            <Input label="Tax rate (%)" type="number" min="0" max="100" step="1" value={form.tax_rate} onChange={(event) => update('tax_rate', event.target.value)} error={fieldErrors.tax_rate?.[0]} />
            <Input label="Stock quantity" type="number" min="0" step="1" required disabled={form.variants.length > 0} value={form.variants.length > 0 ? '0' : form.quantity} onChange={(event) => update('quantity', event.target.value)} hint={form.variants.length > 0 ? 'Set inventory on each variant below.' : ''} error={fieldErrors.quantity?.[0]} />
            <Input label="Low stock threshold" type="number" min="0" step="1" value={form.low_stock_threshold} onChange={(event) => update('low_stock_threshold', event.target.value)} error={fieldErrors.low_stock_threshold?.[0]} />
            <Input label="Shipping weight (grams)" type="number" min="0" step="1" value={form.weight_grams} onChange={(event) => update('weight_grams', event.target.value)} error={fieldErrors.weight_grams?.[0]} />
            <Input label="Dimensions (L x W x H)" maxLength={60} value={form.dimensions} onChange={(event) => update('dimensions', event.target.value)} placeholder="25 x 15 x 8 cm" error={fieldErrors.dimensions?.[0]} />
            <Input label="HS code" maxLength={20} value={form.hs_code} onChange={(event) => update('hs_code', event.target.value)} error={fieldErrors.hs_code?.[0]} />
            <Input label="Manufacturer" maxLength={255} value={form.manufacturer} onChange={(event) => update('manufacturer', event.target.value)} error={fieldErrors.manufacturer?.[0]} />
          </div>
        </section>

        <section className="card" style={{ padding: 20 }}>
          <h2 className="text-lg font-semibold mb-4">Product description</h2>
          <Textarea label="Short description" rows={2} maxLength={1000} value={form.short_description} onChange={(event) => update('short_description', event.target.value)} error={fieldErrors.short_description?.[0]} />
          <Textarea label="Full description" rows={6} value={form.description} onChange={(event) => update('description', event.target.value)} error={fieldErrors.description?.[0]} />
          <div className="flex flex-wrap gap-5 mt-3">
            <label className="checkbox-row">
              <input type="checkbox" checked={form.is_featured} onChange={(event) => update('is_featured', event.target.checked)} />
              <span>Feature this product</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.is_negotiable} onChange={(event) => update('is_negotiable', event.target.checked)} />
              <span>Allow price negotiation</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.is_variant || form.variants.length > 0} onChange={(event) => update('is_variant', event.target.checked)} disabled={form.variants.length > 0} />
              <span>Product has variants</span>
            </label>
          </div>
        </section>

        <section className="card" style={{ padding: 20 }}>
          <div className="flex items-center gap-2 mb-1">
            <ImageIcon size={18} />
            <h2 className="text-lg font-semibold m-0">Product images</h2>
          </div>
          <p className="muted text-sm mb-4">Upload up to 10 images (5 MB each), add image URLs, and select the cover image.</p>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
              <Upload size={14} /> Upload images
              <input type="file" accept="image/*" multiple onChange={addImages} style={{ display: 'none' }} disabled={saving} />
            </label>
            <div className="flex gap-2" style={{ minWidth: 260, flex: 1 }}>
              <input
                type="url"
                className="input"
                value={imageUrlInput}
                onChange={(event) => setImageUrlInput(event.target.value)}
                placeholder="Add image URL (https://...)"
                aria-label="Product image URL"
              />
              <button type="button" className="btn btn-outline btn-sm" onClick={addImageUrl}>Add URL</button>
            </div>
          </div>
          {imageError && <div className="field-error mb-3" role="alert">{imageError}</div>}
          {fieldErrors['images.0'] && <div className="field-error mb-3" role="alert">{fieldErrors['images.0'][0]}</div>}
          {form.images.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {form.images.map((image) => {
                const isPrimary = image.id === form.primary_image_id
                return (
                  <div key={image.id} className="card" style={{ padding: 8, border: isPrimary ? '2px solid var(--primary)' : '1px solid var(--border)' }}>
                    <img src={apiImage(image.url)} alt="Product preview" style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 6 }} />
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => update('primary_image_id', image.id)} aria-pressed={isPrimary}>
                        <CheckCircle2 size={13} /> {isPrimary ? 'Cover image' : 'Set as cover'}
                      </button>
                      <button type="button" className="icon-btn icon-btn-sm" title="Remove image" onClick={() => removeImage(image.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="muted text-sm">No product images selected yet.</div>
          )}
        </section>

        <section className="card" style={{ padding: 20 }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-lg font-semibold m-0">Variants</h2>
              <p className="muted text-sm m-0">Add size, color, or other sellable product options.</p>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={addVariant}><Plus size={14} /> Add variant</button>
          </div>
          {form.variants.map((variant, index) => (
            <div key={index} className="card mb-3" style={{ padding: 14, background: 'var(--bg)' }}>
              <div className="flex items-center justify-between mb-3">
                <strong>Variant {index + 1}</strong>
                <button type="button" className="btn btn-ghost btn-xs text-danger" onClick={() => removeVariant(index)}><Trash2 size={13} /> Remove</button>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <Input label="Variant name" maxLength={200} value={variant.name} onChange={(event) => setVariant(index, 'name', event.target.value)} error={fieldErrors[`variants.${index}.name`]?.[0]} />
                <Input label="Variant SKU" maxLength={80} value={variant.sku} onChange={(event) => setVariant(index, 'sku', event.target.value)} error={fieldErrors[`variants.${index}.sku`]?.[0]} />
                <Input label="Price (NPR)" type="number" min="0" step="0.01" required value={variant.price} onChange={(event) => setVariant(index, 'price', event.target.value)} error={fieldErrors[`variants.${index}.price`]?.[0]} />
                <Input label="Compare-at price (NPR)" type="number" min="0" step="0.01" value={variant.compare_at_price} onChange={(event) => setVariant(index, 'compare_at_price', event.target.value)} />
                <Input label="Stock quantity" type="number" min="0" step="1" value={variant.quantity} onChange={(event) => setVariant(index, 'quantity', event.target.value)} />
                <Input label="Options (key=value, comma separated)" value={variant.options} onChange={(event) => setVariant(index, 'options', event.target.value)} placeholder="color=Red, size=M" />
                <div className="form-group">
                  <label className="label">Variant image</label>
                  <input type="file" accept="image/*" className="input" onChange={(event) => setVariant(index, 'image', event.target.files?.[0] || null)} />
                  {variant.image && <small className="muted text-xs">{variant.image.name}</small>}
                  {fieldErrors[`variants.${index}.image`]?.[0] && <div className="field-error">{fieldErrors[`variants.${index}.image`][0]}</div>}
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="card" style={{ padding: 20 }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-lg font-semibold m-0">Product attributes</h2>
              <p className="muted text-sm m-0">Define customer-facing details such as material, color, or size.</p>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={addAttribute}><Plus size={14} /> Add attribute</button>
          </div>
          {form.attributes.map((attribute, index) => (
            <div key={index} className="grid md:grid-cols-2 gap-4 items-end mb-3">
              <Input label="Attribute name" maxLength={80} value={attribute.name} onChange={(event) => setAttribute(index, 'name', event.target.value)} />
              <Select label="Attribute type" value={attribute.type} onChange={(event) => setAttribute(index, 'type', event.target.value)}>
                <option value="text">Text</option>
                <option value="select">Select</option>
                <option value="color">Color</option>
                <option value="size">Size</option>
              </Select>
              <Input label="Values (comma separated)" value={attribute.values} onChange={(event) => setAttribute(index, 'values', event.target.value)} placeholder="Cotton, Wool, Silk" />
              <button type="button" className="btn btn-ghost btn-sm text-danger justify-self-start" onClick={() => removeAttribute(index)}><Trash2 size={13} /> Remove attribute</button>
            </div>
          ))}
        </section>

        <details className="card" style={{ padding: 20 }}>
          <summary className="font-semibold" style={{ cursor: 'pointer' }}>Advanced product metadata (JSON)</summary>
          <div className="mt-3">
            <Textarea label="Metadata" rows={5} value={form.meta_json} onChange={(event) => update('meta_json', event.target.value)} hint="Enter a JSON object for additional product metadata." />
          </div>
        </details>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/marketplace/products')} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || loading || vendors.length === 0 || stores.length === 0}>
            <Save size={15} /> {saving ? 'Saving…' : 'Save Product'}
          </button>
        </div>
      </form>
    </div>
  )
}
