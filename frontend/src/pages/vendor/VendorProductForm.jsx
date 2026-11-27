import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  FileText,
  Image as ImageIcon,
  Layers,
  Plus,
  Save,
  Settings2,
  Tag,
  Trash2,
  Truck,
} from 'lucide-react'
import api from '../../api/client'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Textarea from '../../components/ui/Textarea'
import FormSection from '../../components/ui/FormSection'
import DemoVideoUpload from '../../components/ui/DemoVideoUpload'
import ProductImageGallery from '../../components/ui/ProductImageGallery'
import ProductVariantBuilder from '../../components/ui/ProductVariantBuilder'
import RichTextEditor from '../../components/ui/RichTextEditor'
import Button from '../../components/ui/Button'
import Spinner from '../../components/ui/Spinner'
import { useToast } from '../../context/ToastContext'
import useUnsavedChangesWarning from '../../hooks/useUnsavedChangesWarning'
import { errorMessage } from '../../utils/format'
import {
  attributeValues,
  formatVariantOptions,
  newImageId,
  parseVariantOptions,
  slugify,
} from '../../utils/productForm'

const emptyForm = (preserve = {}) => ({
  name: '',
  slug: '',
  sku: '',
  price: '',
  compare_at_price: '',
  quantity: '0',
  low_stock_threshold: preserve.low_stock_threshold ?? '5',
  description: '',
  short_description: '',
  category_id: preserve.category_id || '',
  brand_id: preserve.brand_id || '',
  weight_grams: preserve.weight_grams ?? '0',
  dimensions: '',
  barcode: '',
  demo_video_url: '',
  demo_video: null,
  demo_video_removed: false,
  cost_price: '',
  hs_code: '',
  manufacturer: '',
  tax_rate: preserve.tax_rate ?? '',
  images: [],
  is_negotiable: false,
  is_featured: false,
  is_variant: false,
  variants: [],
  attributes: [],
  meta_json: '{}',
})

export default function VendorProductForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isEdit = Boolean(id)

  const [form, setForm] = useState(emptyForm)
  const [slugTouched, setSlugTouched] = useState(false)
  const [categories, setCategories] = useState([])
  const [brands, setBrands] = useState([])
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [imageError, setImageError] = useState('')
  const [loading, setLoading] = useState(isEdit)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [productStatus, setProductStatus] = useState('')
  const [baselineImageIds, setBaselineImageIds] = useState([])
  const [removedImageIds, setRemovedImageIds] = useState([])
  const guardNavigation = useUnsavedChangesWarning(dirty)

  useEffect(() => {
    api.get('/categories').then((response) => setCategories(api.unwrapList(response.data))).catch(() => {})
    api.get('/brands').then((response) => setBrands(api.unwrapList(response.data))).catch(() => {})

    if (!isEdit) return

    let active = true
    api.get(`/vendor/products/${id}`)
      .then((response) => {
        if (!active) return
        const product = response.data.data
        const images = (product.images || []).map((image, index) => ({
          id: image.id || newImageId(),
          existingId: image.id || null,
          url: image.url || image,
          file: null,
          isPrimary: Boolean(image.is_primary || (index === 0 && !(product.images || []).some((item) => item.is_primary))),
        }))

        setProductStatus(product.status)
        setBaselineImageIds(images.map((image) => image.existingId).filter(Boolean))
        setSlugTouched(true)
        setForm({
          name: product.name || '',
          slug: product.slug || '',
          sku: product.sku || '',
          price: String(product.price ?? ''),
          compare_at_price: String(product.compare_at_price ?? ''),
          quantity: String(product.quantity ?? '0'),
          low_stock_threshold: String(product.low_stock_threshold ?? '5'),
          description: product.description || '',
          short_description: product.short_description || '',
          category_id: product.category?.id || '',
          brand_id: product.brand?.id || '',
          weight_grams: String(product.weight_grams ?? '0'),
          dimensions: product.dimensions || '',
          barcode: product.barcode || '',
          demo_video_url: product.demo_video_url || '',
          demo_video: null,
          demo_video_removed: false,
          cost_price: String(product.cost_price ?? ''),
          hs_code: product.hs_code || '',
          manufacturer: product.manufacturer || '',
          tax_rate: String(product.tax_rate ?? ''),
          images,
          is_negotiable: !!product.is_negotiable,
          is_featured: !!product.is_featured,
          is_variant: !!product.is_variant,
          variants: (product.variants || []).map((variant) => ({
            sku: variant.sku || '',
            name: variant.name || '',
            price: String(variant.price ?? ''),
            compare_at_price: String(variant.compare_at_price ?? ''),
            quantity: String(variant.quantity ?? '0'),
            options: formatVariantOptions(variant.options),
            image: null,
          })),
          attributes: (product.attributes || []).map((attribute) => ({
            name: attribute.name || '',
            type: attribute.type || 'text',
            values: (attribute.values || []).join(', '),
          })),
          meta_json: '{}',
        })
      })
      .catch(() => setLoadFailed(true))
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [id, isEdit])

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setFormError('')
    setDirty(true)
  }

  const updateName = (value) => {
    setForm((current) => ({
      ...current,
      name: value,
      slug: slugTouched ? current.slug : slugify(value),
    }))
    setFieldErrors((current) => {
      const next = { ...current }
      delete next.name
      return next
    })
    setFormError('')
    setDirty(true)
  }

  const setVariant = (index, key, value) => {
    update('variants', form.variants.map((variant, variantIndex) => (
      variantIndex === index ? { ...variant, [key]: value } : variant
    )))
  }

  const addAttribute = () => update('attributes', [
    ...form.attributes,
    { name: '', type: 'text', values: '' },
  ])

  const setAttribute = (index, key, value) => {
    update('attributes', form.attributes.map((attribute, attributeIndex) => (
      attributeIndex === index ? { ...attribute, [key]: value } : attribute
    )))
  }

  const changeImages = (images) => {
    const removed = form.images
      .filter((image) => image.existingId && !images.some((candidate) => candidate.existingId === image.existingId))
      .map((image) => image.existingId)

    if (removed.length) {
      setRemovedImageIds((current) => Array.from(new Set([...current, ...removed])))
    }
    update('images', images)
  }

  const validate = () => {
    setFormError('')
    setFieldErrors({})
    setImageError('')

    if (!form.name.trim()) {
      setFieldErrors({ name: ['Enter a product name.'] })
      setFormError('Enter a product name before saving.')
      return false
    }
    if (form.price === '' || Number(form.price) < 0) {
      setFieldErrors({ price: ['Enter a valid selling price.'] })
      setFormError('Enter a valid selling price before saving.')
      return false
    }
    if (!isEdit && !form.images.length) {
      setImageError('Add at least one product image before saving.')
      return false
    }
    if (form.is_variant && !form.variants.some((variant) => variant.price !== '')) {
      setFormError('Add at least one priced variant or turn off the variant setting.')
      return false
    }
    if (form.variants.length && form.variants.some((variant) => variant.price === '')) {
      setFormError('Every variant needs a price. Remove any incomplete variant and try again.')
      return false
    }

    try {
      const meta = JSON.parse(form.meta_json || '{}')
      if (!meta || Array.isArray(meta) || typeof meta !== 'object') {
        throw new Error('Product metadata must be a JSON object.')
      }
    } catch {
      setFormError('Product metadata must be a valid JSON object.')
      return false
    }

    return true
  }

  const buildPayload = (status) => {
    const data = new FormData()
    const append = (key, value) => {
      if (value !== undefined && value !== null && value !== '') data.append(key, String(value))
    }
    const appendNullable = (key, value) => data.append(key, value ?? '')

    append('name', form.name)
    appendNullable('slug', form.slug)
    appendNullable('description', form.description)
    appendNullable('short_description', form.short_description)
    appendNullable('category_id', form.category_id)
    appendNullable('brand_id', form.brand_id)
    if (status) append('status', status)
    if (isEdit && form.sku) append('sku', form.sku)
    append('price', form.price)
    appendNullable('compare_at_price', form.compare_at_price)
    append('quantity', form.quantity)
    append('low_stock_threshold', form.low_stock_threshold)
    append('weight_grams', form.weight_grams)
    appendNullable('dimensions', form.dimensions)
    appendNullable('barcode', form.barcode)
    appendNullable('cost_price', form.cost_price)
    appendNullable('hs_code', form.hs_code)
    appendNullable('manufacturer', form.manufacturer)
    appendNullable('tax_rate', form.tax_rate)
    append('is_variant', form.is_variant ? '1' : '0')
    data.append('is_featured', form.is_featured ? '1' : '0')
    data.append('is_negotiable', form.is_negotiable ? '1' : '0')
    data.append('variants_present', '1')
    data.append('meta', JSON.stringify(JSON.parse(form.meta_json || '{}')))

    if (form.demo_video) data.append('demo_video', form.demo_video)
    else if (form.demo_video_removed) data.append('remove_demo_video', '1')

    form.variants.forEach((variant, index) => {
      append(`variants[${index}][sku]`, variant.sku)
      append(`variants[${index}][name]`, variant.name)
      append(`variants[${index}][price]`, variant.price)
      appendNullable(`variants[${index}][compare_at_price]`, variant.compare_at_price)
      append(`variants[${index}][quantity]`, variant.quantity)
      Object.entries(parseVariantOptions(variant.options)).forEach(([key, value]) => {
        append(`variants[${index}][options][${key}]`, value)
      })
      if (variant.image) data.append(`variants[${index}][image]`, variant.image)
    })

    form.attributes.filter((attribute) => attribute.name.trim()).forEach((attribute, index) => {
      append(`attributes[${index}][name]`, attribute.name.trim())
      append(`attributes[${index}][type]`, attribute.type)
      attributeValues(attribute.values).forEach((value, valueIndex) => {
        append(`attributes[${index}][values][${valueIndex}]`, value)
      })
    })

    let uploadIndex = 0
    form.images.forEach((image) => {
      if (image.file) {
        data.append('images[]', image.file)
        if (image.isPrimary) data.append('primary_image_upload_index', String(uploadIndex))
        uploadIndex += 1
      } else if (image.existingId) {
        return
      } else if (image.url) {
        data.append('image_urls[]', image.url)
        if (image.isPrimary) data.append('primary_image_url', image.url)
      }
    })

    return data
  }

  const syncImageChanges = async (savedProduct) => {
    if (!isEdit) return

    for (const imageId of removedImageIds) {
      await api.delete(`/vendor/products/${id}/images/${imageId}`)
    }

    if (!form.images.length) {
      setRemovedImageIds([])
      setBaselineImageIds([])
      return
    }

    const refreshed = await api.get(`/vendor/products/${id}`)
    const finalImages = refreshed.data.data.images || []
    const baseline = new Set(baselineImageIds)
    const newSaved = finalImages.filter((image) => !baseline.has(image.id))
    const savedFileImages = newSaved.filter((image) => !/^https?:\/\//i.test(image.url || ''))
    const savedUrlImages = newSaved.filter((image) => /^https?:\/\//i.test(image.url || ''))
    const idForLocalImage = new Map()

    form.images.filter((image) => image.file).forEach((image, index) => {
      if (savedFileImages[index]) idForLocalImage.set(image.id, savedFileImages[index].id)
    })
    form.images.filter((image) => !image.file && !image.existingId).forEach((image, index) => {
      if (savedUrlImages[index]) idForLocalImage.set(image.id, savedUrlImages[index].id)
    })

    const orderedIds = form.images
      .map((image) => image.existingId || idForLocalImage.get(image.id))
      .filter((imageId) => finalImages.some((finalImage) => finalImage.id === imageId))

    if (orderedIds.length !== finalImages.length) return

    const desiredPrimary = form.images.find((image) => image.isPrimary) || form.images[0]
    const primaryId = desiredPrimary?.existingId || idForLocalImage.get(desiredPrimary?.id)
    await api.put(`/vendor/products/${id}/images`, {
      images: orderedIds,
      primary_image_id: primaryId || undefined,
    })

    setRemovedImageIds([])
    setBaselineImageIds(finalImages.map((image) => image.id))
  }

  const submit = async (mode, event) => {
    event?.preventDefault()
    if (saving || loading) return
    if (!validate()) return

    setSaving(true)
    setUploadProgress(0)
    try {
      const data = buildPayload(mode === 'draft' ? 'draft' : undefined)
      const endpoint = isEdit ? `/vendor/products/${id}` : '/vendor/products'
      if (isEdit) data.append('_method', 'PUT')
      const response = await api.post(endpoint, data, {
        onUploadProgress: (progressEvent) => {
          if (!progressEvent.total) return
          setUploadProgress(Math.min(100, Math.round((progressEvent.loaded * 100) / progressEvent.total)))
        },
      })
      setDirty(false)

      if (isEdit) {
        await syncImageChanges(response.data.data)
        setProductStatus(response.data.data.status || productStatus)
      }

      if (mode === 'another' && !isEdit) {
        toast.success('Product created. Add another product below.')
        setForm(emptyForm({
          category_id: form.category_id,
          brand_id: form.brand_id,
          low_stock_threshold: form.low_stock_threshold,
          tax_rate: form.tax_rate,
          weight_grams: form.weight_grams,
        }))
        setSlugTouched(false)
        setRemovedImageIds([])
        setBaselineImageIds([])
        setUploadProgress(0)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        toast.success(isEdit ? 'Product updated successfully' : 'Product created successfully')
        navigate('/vendor/products')
      }
    } catch (error) {
      const responseData = error.response?.data
      if (responseData?.errors) {
        setFieldErrors(responseData.errors)
        setFormError(responseData.message || errorMessage(error))
        if (responseData.errors.images) setImageError(responseData.errors.images[0])
      } else {
        const message = errorMessage(error)
        setFormError(message)
        toast.error(message)
      }
    } finally {
      setSaving(false)
      setUploadProgress(0)
    }
  }

  const submitForReview = async () => {
    try {
      await api.post(`/vendor/products/${id}/submit`)
      toast.success('Product submitted for administrative review')
      navigate('/vendor/products')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (isEdit && loadFailed) {
    return <div className="alert alert-error">Product not found.</div>
  }

  if (isEdit && loading) {
    return <div className="flex items-center gap-2 muted"><Spinner size={18} color="var(--primary)" /> Loading product details…</div>
  }

  return (
    <div className="product-create-page">
      <div className="flex items-center gap-2 mb-3">
        <Link to="/vendor/products" className="icon-btn"><ArrowLeft size={16} /></Link>
        <h1 style={{ fontSize: 22, margin: 0 }}>{isEdit ? 'Edit Product' : 'Create New Product'}</h1>
        {productStatus && <span className={`badge badge-${productStatus}`}>{productStatus.replaceAll('_', ' ')}</span>}
      </div>

      <form onSubmit={(event) => submit('product', event)} style={{ display: 'grid', gap: 14 }}>
        {formError && (
          <div className="alert alert-error" role="alert">
            {formError}
            {fieldErrors.store && (
              <div className="mt-2">
                <Link to="/vendor/stores" className="btn btn-primary btn-sm">Review Store Profile</Link>
              </div>
            )}
          </div>
        )}
        {dirty && <div className="alert alert-info text-xs">You have unsaved changes.</div>}

        <FormSection
          title="Basic product information"
          description="Name, category, and URL are all you need to start."
          icon={Tag}
        >
          <div className="form-row">
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="label">Product name <span className="req">*</span></label>
              <input
                className={`input${fieldErrors.name ? ' has-error' : ''}`}
                required
                value={form.name}
                onChange={(event) => updateName(event.target.value)}
                placeholder="e.g. Handwoven Himalayan Cashmere Shawl"
              />
              {fieldErrors.name && <div className="field-error">{fieldErrors.name[0]}</div>}
            </div>
            <Input
              label="URL slug"
              value={form.slug}
              onChange={(event) => {
                setSlugTouched(true)
                update('slug', event.target.value)
              }}
              hint="Generated from the product name; you can edit it."
              error={fieldErrors.slug?.[0]}
            />
            <Input label="SKU" value={isEdit && form.sku ? form.sku : 'Generated automatically when saved'} disabled hint="Gosika assigns a unique SKU." />
            <Select label="Product category" value={form.category_id} onChange={(event) => update('category_id', event.target.value)} error={fieldErrors.category_id?.[0]}>
              <option value="">Select a category</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
            <Select label="Brand" value={form.brand_id} onChange={(event) => update('brand_id', event.target.value)} error={fieldErrors.brand_id?.[0]}>
              <option value="">Select / Unbranded</option>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </Select>
          </div>
          <label className="checkbox-row" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={form.is_variant} onChange={(event) => update('is_variant', event.target.checked)} />
            <span>This product has variants (size, color, material, custom options)</span>
          </label>
        </FormSection>

        <FormSection
          title="Product images"
          description="Drag to reorder, set a cover, upload files, or paste image URLs."
          icon={ImageIcon}
          badge={`${form.images.length}/10`}
        >
          <ProductImageGallery
            images={form.images}
            onChange={changeImages}
            error={imageError || fieldErrors['images.0']?.[0]}
            disabled={saving}
            uploadProgress={uploadProgress}
          />
          <DemoVideoUpload
            value={form.demo_video_url}
            file={form.demo_video}
            onChange={(file) => update('demo_video', file)}
            onRemove={() => {
              setForm((current) => ({
                ...current,
                demo_video: null,
                demo_video_url: '',
                demo_video_removed: true,
              }))
              setDirty(true)
            }}
            error={fieldErrors.demo_video?.[0]}
            disabled={saving}
          />
        </FormSection>

        <FormSection
          title="Pricing & inventory"
          description="The fields you use on every product."
          icon={Truck}
        >
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Input label="Selling price (NPR)" type="number" min="0" step="0.01" required value={form.price} onChange={(event) => update('price', event.target.value)} error={fieldErrors.price?.[0]} placeholder="1500" />
            <Input label="Compare-at price" type="number" min="0" step="0.01" value={form.compare_at_price} onChange={(event) => update('compare_at_price', event.target.value)} error={fieldErrors.compare_at_price?.[0]} placeholder="2000" />
            <Input label="Stock quantity" type="number" min="0" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} error={fieldErrors.quantity?.[0]} disabled={form.is_variant} hint={form.is_variant ? 'Stock comes from variants.' : ''} />
            <Input label="Low stock threshold" type="number" min="0" value={form.low_stock_threshold} onChange={(event) => update('low_stock_threshold', event.target.value)} error={fieldErrors.low_stock_threshold?.[0]} />
          </div>
          <details className="product-advanced">
            <summary>Advanced pricing & shipping</summary>
            <div className="grid md:grid-cols-2 gap-4 mt-3">
              <Input label="Cost price (NPR)" type="number" min="0" step="0.01" value={form.cost_price} onChange={(event) => update('cost_price', event.target.value)} error={fieldErrors.cost_price?.[0]} hint="Private — not shown to buyers." />
              <Input label="Tax rate (%)" type="number" min="0" max="100" value={form.tax_rate} onChange={(event) => update('tax_rate', event.target.value)} error={fieldErrors.tax_rate?.[0]} />
              <Input label="Shipping weight (grams)" type="number" min="0" value={form.weight_grams} onChange={(event) => update('weight_grams', event.target.value)} error={fieldErrors.weight_grams?.[0]} placeholder="500" />
              <Input label="Dimensions (L × W × H)" value={form.dimensions} onChange={(event) => update('dimensions', event.target.value)} error={fieldErrors.dimensions?.[0]} placeholder="25 x 15 x 8 cm" />
              <Input label="Barcode" value={form.barcode} onChange={(event) => update('barcode', event.target.value)} error={fieldErrors.barcode?.[0]} />
              <Input label="HS code" value={form.hs_code} onChange={(event) => update('hs_code', event.target.value)} error={fieldErrors.hs_code?.[0]} />
              <Input label="Manufacturer" value={form.manufacturer} onChange={(event) => update('manufacturer', event.target.value)} error={fieldErrors.manufacturer?.[0]} />
            </div>
          </details>
        </FormSection>

        {form.is_variant && (
          <FormSection
            title="Product variants"
            description="Generate size/color/material combinations or add them manually."
            icon={Layers}
            badge={`${form.variants.length} variants`}
          >
            <ProductVariantBuilder
              variants={form.variants}
              onChange={(variants) => update('variants', variants)}
              errors={fieldErrors}
              disabled={saving}
              allowImage
              allowSku
              defaultPrice={form.price}
            />
          </FormSection>
        )}

        <FormSection
          title="Product description"
          description="Write a quick summary and a formatted full description."
          icon={FileText}
        >
          <Textarea
            label="Short description"
            rows={2}
            value={form.short_description}
            onChange={(event) => update('short_description', event.target.value)}
            error={fieldErrors.short_description?.[0]}
            placeholder="Brief 1–2 sentence highlight of the product…"
          />
          <RichTextEditor
            label="Full description"
            rows={6}
            value={form.description}
            onChange={(value) => update('description', value)}
            error={fieldErrors.description?.[0]}
            disabled={saving}
            hint="Use bold, lists, and links to explain materials, care, and features."
          />
        </FormSection>

        <FormSection
          title="Additional product details"
          description="Optional attributes, flags, and metadata."
          icon={Settings2}
          defaultOpen={false}
        >
          <div className="flex flex-wrap gap-5 mb-4">
            <label className="checkbox-row">
              <input type="checkbox" checked={form.is_featured} onChange={(event) => update('is_featured', event.target.checked)} />
              <span>Feature this product in store showcase</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.is_negotiable} onChange={(event) => update('is_negotiable', event.target.checked)} />
              <span>Allow price negotiation / inquiries</span>
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <strong className="text-sm">Product attributes</strong>
              <p className="muted text-xs m-0">Material, color, size, and other customer-facing filters.</p>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={addAttribute} disabled={saving}>
              <Plus size={14} /> Add attribute
            </button>
          </div>
          {form.attributes.map((attribute, index) => (
            <div key={index} className="variant-definition-row mb-2">
              <input className="input" value={attribute.name} onChange={(event) => setAttribute(index, 'name', event.target.value)} placeholder="Attribute name" aria-label={`Attribute ${index + 1} name`} disabled={saving} />
              <select className="select" value={attribute.type} onChange={(event) => setAttribute(index, 'type', event.target.value)} aria-label={`Attribute ${index + 1} type`} disabled={saving}>
                <option value="text">Text</option>
                <option value="select">Select</option>
                <option value="color">Color</option>
                <option value="size">Size</option>
              </select>
              <input className="input" value={attribute.values} onChange={(event) => setAttribute(index, 'values', event.target.value)} placeholder="Cotton, Wool" aria-label={`Attribute ${index + 1} values`} disabled={saving} />
              <button type="button" className="icon-btn icon-btn-sm text-danger" onClick={() => update('attributes', form.attributes.filter((_, attributeIndex) => attributeIndex !== index))} disabled={saving} title="Remove attribute">
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          <details className="product-advanced">
            <summary>Advanced product metadata (JSON)</summary>
            <div className="mt-3">
              <Textarea label="Metadata" rows={5} value={form.meta_json} onChange={(event) => update('meta_json', event.target.value)} hint="Optional JSON object for custom integrations." disabled={saving} />
            </div>
          </details>
        </FormSection>

        <div className="product-action-bar">
          {dirty && <span className="muted text-xs" style={{ marginRight: 'auto' }}>Unsaved changes</span>}
          <button type="button" className="btn btn-outline" onClick={() => guardNavigation(navigate, '/vendor/products')} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-soft" onClick={() => submit('draft')} disabled={saving}>
            Save as Draft
          </button>
          {!isEdit && (
            <button type="button" className="btn btn-outline" onClick={() => submit('another')} disabled={saving}>
              <Plus size={15} /> Save & Add Another
            </button>
          )}
          {isEdit && ['draft', 'hidden'].includes(productStatus) && (
            <Button type="button" variant="soft" onClick={submitForReview} disabled={saving}>
              Submit for Admin Review
            </Button>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner size={16} color="#fff" /> : <Save size={16} />}
            {saving ? 'Saving…' : isEdit ? 'Update Product' : 'Save Product'}
          </Button>
        </div>
      </form>
    </div>
  )
}
