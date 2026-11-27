import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import ProductImageGallery from '../../components/ui/ProductImageGallery'
import ProductVariantBuilder from '../../components/ui/ProductVariantBuilder'
import RichTextEditor from '../../components/ui/RichTextEditor'
import PageHeader from '../../components/admin/PageHeader'
import { useToast } from '../../context/ToastContext'
import useUnsavedChangesWarning from '../../hooks/useUnsavedChangesWarning'
import { attributeValues, parseVariantOptions, slugify } from '../../utils/productForm'

const makeForm = (preserve = {}) => ({
  vendor_id: preserve.vendor_id || '',
  store_id: preserve.store_id || '',
  name: '',
  slug: '',
  sku: '',
  demo_video_url: '',
  category_id: preserve.category_id || '',
  brand_id: preserve.brand_id || '',
  status: preserve.status || 'published',
  price: '',
  compare_at_price: '',
  cost_price: '',
  quantity: '0',
  low_stock_threshold: preserve.low_stock_threshold ?? '5',
  tax_rate: preserve.tax_rate ?? '',
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
  variants: [],
  attributes: [],
  meta_json: '{}',
})

export default function AdminProductForm() {
  const navigate = useNavigate()
  const toast = useToast()
  const [form, setForm] = useState(makeForm)
  const [slugTouched, setSlugTouched] = useState(false)
  const [vendors, setVendors] = useState([])
  const [categories, setCategories] = useState([])
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [dirty, setDirty] = useState(false)
  const guardNavigation = useUnsavedChangesWarning(dirty)
  const [formError, setFormError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [imageError, setImageError] = useState('')

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
    if (!form.images.length) {
      setImageError('Add at least one product image before saving.')
      return false
    }
    if (form.is_variant && !form.variants.some((variant) => variant.price !== '')) {
      setFormError('Add at least one priced variant or turn off the variant setting.')
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

    ;[
      'vendor_id', 'store_id', 'name', 'slug', 'demo_video_url', 'category_id', 'brand_id',
      'price', 'compare_at_price', 'cost_price', 'quantity', 'low_stock_threshold',
      'tax_rate', 'weight_grams', 'dimensions', 'hs_code', 'manufacturer',
      'short_description', 'description',
    ].forEach((key) => append(key, form[key]))
    append('status', status || form.status)
    append('is_variant', form.is_variant ? '1' : '0')
    append('is_featured', form.is_featured ? '1' : '0')
    append('is_negotiable', form.is_negotiable ? '1' : '0')
    append('meta', JSON.stringify(JSON.parse(form.meta_json || '{}')))

    const uploadedImages = form.images.filter((image) => image.file)
    const uploadIndexes = new Map()
    uploadedImages.forEach((image, index) => {
      uploadIndexes.set(image.id, index)
      data.append('images[]', image.file)
    })
    form.images.filter((image) => !image.file).forEach((image) => data.append('image_urls[]', image.url))

    const primaryImage = form.images.find((image) => image.isPrimary) || form.images[0]
    if (primaryImage?.file) {
      append('primary_image_upload_index', uploadIndexes.get(primaryImage.id))
    } else if (primaryImage?.url) {
      append('primary_image_url', primaryImage.url)
    }

    data.append('variants_present', '1')
    const variants = form.is_variant ? form.variants.filter((variant) => variant.price !== '') : []
    variants.forEach((variant, index) => {
      append(`variants[${index}][sku]`, variant.sku)
      append(`variants[${index}][name]`, variant.name)
      append(`variants[${index}][price]`, variant.price)
      append(`variants[${index}][compare_at_price]`, variant.compare_at_price)
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

    return data
  }

  const submit = async (mode, event) => {
    event?.preventDefault()
    if (saving || loading) return
    if (!validate()) return

    setSaving(true)
    setUploadProgress(0)
    try {
      await api.post('/admin/products', buildPayload(mode === 'draft' ? 'draft' : undefined), {
        onUploadProgress: (progressEvent) => {
          if (!progressEvent.total) return
          setUploadProgress(Math.min(100, Math.round((progressEvent.loaded * 100) / progressEvent.total)))
        },
      })
      setDirty(false)

      if (mode === 'another') {
        toast.success('Product added. Add another product below.')
        setForm(makeForm({
          vendor_id: form.vendor_id,
          store_id: form.store_id,
          category_id: form.category_id,
          brand_id: form.brand_id,
          status: form.status,
          low_stock_threshold: form.low_stock_threshold,
          tax_rate: form.tax_rate,
        }))
        setSlugTouched(false)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        toast.success(mode === 'draft' ? 'Product saved as a draft.' : 'Product added to the catalog.')
        navigate('/admin/marketplace/products')
      }
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
      setUploadProgress(0)
    }
  }

  return (
    <div className="product-create-page">
      <PageHeader
        title="Add Product"
        description="Start with the essentials — advanced catalog details stay out of the way."
        breadcrumbs={[
          { label: 'Marketplace', to: '/admin/marketplace/vendors' },
          { label: 'Products', to: '/admin/marketplace/products' },
          { label: 'Add Product' },
        ]}
        actions={(
          <button type="button" className="btn btn-outline btn-sm" onClick={() => guardNavigation(navigate, '/admin/marketplace/products')}>
            <ArrowLeft size={14} /> Back to products
          </button>
        )}
      />

      {dirty && <div className="alert alert-info text-xs">You have unsaved changes.</div>}

      <form onSubmit={(event) => submit('product', event)} style={{ display: 'grid', gap: 14 }}>
        {formError && <div className="alert alert-error" role="alert">{formError}</div>}

        <FormSection
          title="Basic product information"
          description="What buyers see first. Vendor and store defaults are selected for you."
          icon={Tag}
        >
          <div className="form-row">
            <Select
              label="Vendor"
              required
              value={form.vendor_id}
              disabled={loading || saving}
              error={fieldErrors.vendor_id?.[0]}
              onChange={(event) => {
                const vendor = vendors.find((item) => item.id === event.target.value)
                const firstStore = vendor?.stores?.find((store) => store.status === 'active')
                update('vendor_id', event.target.value)
                update('store_id', firstStore?.id || '')
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
            <Input label="Product name" required maxLength={200} value={form.name} onChange={(event) => updateName(event.target.value)} error={fieldErrors.name?.[0]} placeholder="e.g. Handwoven Himalayan Cashmere Shawl" />
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
            <Input
              label="URL slug"
              maxLength={220}
              value={form.slug}
              onChange={(event) => {
                setSlugTouched(true)
                update('slug', event.target.value)
              }}
              hint="Generated from the product name; you can edit it."
              error={fieldErrors.slug?.[0]}
            />
            <Input label="SKU" value="Generated automatically when saved" disabled hint="Gosika assigns a unique SKU." />
          </div>
          <label className="checkbox-row" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={form.is_variant} onChange={(event) => update('is_variant', event.target.checked)} />
            <span>This product has variants (size, color, material, custom options)</span>
          </label>
        </FormSection>

        <FormSection
          title="Product images"
          description="Drop photos, add image URLs, choose the cover, and drag to reorder."
          icon={ImageIcon}
          badge={`${form.images.length}/10`}
        >
          <ProductImageGallery
            images={form.images}
            onChange={(images) => update('images', images)}
            error={imageError || fieldErrors['images.0']?.[0]}
            disabled={saving}
            uploadProgress={uploadProgress}
          />
          <Input
            label="Demo video URL"
            value={form.demo_video_url}
            onChange={(event) => update('demo_video_url', event.target.value)}
            error={fieldErrors.demo_video_url?.[0]}
            hint="Optional https:// video link shown with the listing."
            placeholder="https://…"
          />
        </FormSection>

        <FormSection
          title="Pricing & inventory"
          description="The fields vendors use most are kept visible."
          icon={Truck}
        >
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Input label="Selling price (NPR)" type="number" min="0" step="0.01" required value={form.price} onChange={(event) => update('price', event.target.value)} error={fieldErrors.price?.[0]} />
            <Input label="Compare-at price" type="number" min="0" step="0.01" value={form.compare_at_price} onChange={(event) => update('compare_at_price', event.target.value)} error={fieldErrors.compare_at_price?.[0]} />
            <Input label="Stock quantity" type="number" min="0" step="1" required disabled={form.is_variant} value={form.is_variant ? '0' : form.quantity} onChange={(event) => update('quantity', event.target.value)} hint={form.is_variant ? 'Stock comes from variants.' : ''} error={fieldErrors.quantity?.[0]} />
            <Input label="Low stock threshold" type="number" min="0" step="1" value={form.low_stock_threshold} onChange={(event) => update('low_stock_threshold', event.target.value)} error={fieldErrors.low_stock_threshold?.[0]} />
          </div>
          <details className="product-advanced">
            <summary>Advanced pricing & shipping</summary>
            <div className="grid md:grid-cols-2 gap-4 mt-3">
              <Input label="Cost price (NPR)" type="number" min="0" step="0.01" value={form.cost_price} onChange={(event) => update('cost_price', event.target.value)} error={fieldErrors.cost_price?.[0]} hint="Private — not shown to buyers." />
              <Input label="Tax rate (%)" type="number" min="0" max="100" step="1" value={form.tax_rate} onChange={(event) => update('tax_rate', event.target.value)} error={fieldErrors.tax_rate?.[0]} />
              <Input label="Shipping weight (grams)" type="number" min="0" step="1" value={form.weight_grams} onChange={(event) => update('weight_grams', event.target.value)} error={fieldErrors.weight_grams?.[0]} />
              <Input label="Dimensions (L × W × H)" maxLength={60} value={form.dimensions} onChange={(event) => update('dimensions', event.target.value)} placeholder="25 x 15 x 8 cm" error={fieldErrors.dimensions?.[0]} />
              <Input label="HS code" maxLength={20} value={form.hs_code} onChange={(event) => update('hs_code', event.target.value)} error={fieldErrors.hs_code?.[0]} />
              <Input label="Manufacturer" maxLength={255} value={form.manufacturer} onChange={(event) => update('manufacturer', event.target.value)} error={fieldErrors.manufacturer?.[0]} />
            </div>
          </details>
        </FormSection>

        {form.is_variant && (
          <FormSection
            title="Product variants"
            description="Generate combinations or add variants one by one."
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
          description="A short summary and a formatted detailed description."
          icon={FileText}
        >
          <Textarea
            label="Short description"
            rows={2}
            maxLength={1000}
            value={form.short_description}
            onChange={(event) => update('short_description', event.target.value)}
            error={fieldErrors.short_description?.[0]}
            hint="Shown on product cards and search results."
          />
          <RichTextEditor
            label="Full description"
            rows={6}
            value={form.description}
            onChange={(value) => update('description', value)}
            error={fieldErrors.description?.[0]}
            disabled={saving}
            hint="Use bold, lists, and links for a clean product story."
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
              <span>Feature this product</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.is_negotiable} onChange={(event) => update('is_negotiable', event.target.checked)} />
              <span>Allow price negotiation</span>
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <strong className="text-sm">Product attributes</strong>
              <p className="muted text-xs m-0">Material, care details, or other customer-facing filters.</p>
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
          <button type="button" className="btn btn-outline" onClick={() => guardNavigation(navigate, '/admin/marketplace/products')} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-soft" onClick={() => submit('draft')} disabled={saving || loading || vendors.length === 0 || stores.length === 0}>
            Save as Draft
          </button>
          <button type="button" className="btn btn-outline" onClick={() => submit('another')} disabled={saving || loading || vendors.length === 0 || stores.length === 0}>
            <Plus size={15} /> Save & Add Another
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || loading || vendors.length === 0 || stores.length === 0}>
            <Save size={15} /> {saving ? 'Saving…' : 'Save Product'}
          </button>
        </div>
      </form>
    </div>
  )
}
