import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Save } from 'lucide-react'
import api from '../../api/client'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Textarea from '../../components/ui/Textarea'
import PageHeader from '../../components/admin/PageHeader'
import { useToast } from '../../context/ToastContext'

const initialForm = {
  vendor_id: '',
  store_id: '',
  name: '',
  sku: '',
  category_id: '',
  price: '',
  compare_at_price: '',
  quantity: '0',
  low_stock_threshold: '5',
  tax_rate: '0',
  image_url: '',
  description: '',
  status: 'published',
}

export default function AdminProductForm() {
  const navigate = useNavigate()
  const toast = useToast()
  const [form, setForm] = useState(initialForm)
  const [vendors, setVendors] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([
      api.get('/admin/vendors', { params: { status: 'approved', per_page: 100 } }),
      api.get('/categories'),
    ]).then(([vendorResponse, categoryResponse]) => {
      if (!active) return
      const nextVendors = api.unwrapList(vendorResponse.data)
      setVendors(nextVendors)
      setCategories(api.unwrapList(categoryResponse.data))
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

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      await api.post('/admin/products', {
        ...form,
        sku: form.sku.trim() || null,
        category_id: form.category_id || null,
        price: Number(form.price),
        compare_at_price: form.compare_at_price === '' ? null : Number(form.compare_at_price),
        quantity: Number(form.quantity),
        low_stock_threshold: Number(form.low_stock_threshold),
        tax_rate: Number(form.tax_rate),
        image_url: form.image_url.trim() || null,
      })
      toast.success('Product added to the catalog.')
      navigate('/admin/marketplace/products')
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to add product.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Add Product"
        description="Create a catalog product for an approved vendor and active store."
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

      <form onSubmit={save} className="card" style={{ padding: 20, display: 'grid', gap: 16 }}>
        <div className="grid md:grid-cols-2 gap-4">
          <Select
            label="Vendor"
            required
            value={form.vendor_id}
            disabled={loading || saving}
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
            onChange={(event) => update('store_id', event.target.value)}
          >
            <option value="">Select an active store</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </Select>
          <Input label="Product name" required maxLength={200} value={form.name} onChange={(event) => update('name', event.target.value)} />
          <Input label="SKU" maxLength={80} value={form.sku} onChange={(event) => update('sku', event.target.value)} />
          <Select label="Category" value={form.category_id} onChange={(event) => update('category_id', event.target.value)}>
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </Select>
          <Select label="Listing status" value={form.status} onChange={(event) => update('status', event.target.value)}>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </Select>
          <Input label="Price (NPR)" type="number" min="0" step="0.01" required value={form.price} onChange={(event) => update('price', event.target.value)} />
          <Input label="Compare-at price (NPR)" type="number" min="0" step="0.01" value={form.compare_at_price} onChange={(event) => update('compare_at_price', event.target.value)} />
          <Input label="Stock quantity" type="number" min="0" step="1" required value={form.quantity} onChange={(event) => update('quantity', event.target.value)} />
          <Input label="Low stock threshold" type="number" min="0" step="1" value={form.low_stock_threshold} onChange={(event) => update('low_stock_threshold', event.target.value)} />
          <Input label="Tax rate (%)" type="number" min="0" max="100" step="1" value={form.tax_rate} onChange={(event) => update('tax_rate', event.target.value)} />
          <Input label="Main image URL" type="url" value={form.image_url} onChange={(event) => update('image_url', event.target.value)} />
        </div>
        <Textarea label="Description" rows={5} value={form.description} onChange={(event) => update('description', event.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
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
