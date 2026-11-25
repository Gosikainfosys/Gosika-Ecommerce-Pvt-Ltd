import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react'
import api from '../../api/client'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Textarea from '../../components/ui/Textarea'
import PageHeader from '../../components/admin/PageHeader'
import { useToast } from '../../context/ToastContext'
import { money } from '../../utils/format'

const blankItem = () => ({ product_id: '', variant_id: '', quantity: '1', unit_price: '' })
const blankAddress = {
  full_name: '',
  phone: '',
  address_line_1: '',
  address_line_2: '',
  district: '',
  province: '',
  municipality: '',
  postal_code: '',
  landmark: '',
}

export default function AdminManualOrderForm() {
  const navigate = useNavigate()
  const toast = useToast()
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [shippingAddress, setShippingAddress] = useState(blankAddress)
  const [paymentMethod, setPaymentMethod] = useState('cod')
  const [paymentStatus, setPaymentStatus] = useState('pending')
  const [customerNotes, setCustomerNotes] = useState('')
  const [deliveryCharge, setDeliveryCharge] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [tax, setTax] = useState('0')
  const [items, setItems] = useState([blankItem()])

  useEffect(() => {
    let active = true
    Promise.all([
      api.get('/admin/customers', { params: { per_page: 100 } }),
      api.get('/admin/products', { params: { status: 'published', per_page: 100 } }),
    ]).then(([customerResponse, productResponse]) => {
      if (!active) return
      setCustomers(api.unwrapList(customerResponse.data))
      setProducts(api.unwrapList(productResponse.data))
    }).catch((error) => {
      toast.error(error.response?.data?.message || 'Failed to load customers and products.')
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => { active = false }
  }, [toast])

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.unit_price) || 0) * (Number(item.quantity) || 0), 0),
    [items],
  )
  const grandTotal = Math.max(
    0,
    subtotal - (Number(discount) || 0) + (Number(deliveryCharge) || 0) + (Number(tax) || 0),
  )

  const updateAddress = (key, value) => setShippingAddress((current) => ({ ...current, [key]: value }))
  const updateItem = (index, key, value) => {
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item
      const next = { ...item, [key]: value }
      if (key === 'product_id') {
        const product = products.find((candidate) => candidate.id === value)
        next.variant_id = ''
        next.unit_price = product?.price ?? ''
      }
      if (key === 'variant_id') {
        const product = products.find((candidate) => candidate.id === item.product_id)
        const variant = product?.variants?.find((candidate) => candidate.id === value)
        if (variant) next.unit_price = variant.price
      }
      return next
    }))
  }

  const selectCustomer = (id) => {
    setCustomerId(id)
    const customer = customers.find((candidate) => candidate.id === id)
    if (customer) {
      setShippingAddress((current) => ({
        ...current,
        full_name: customer.name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
        phone: customer.phone || '',
      }))
    }
  }

  const save = async (event) => {
    event.preventDefault()
    if (items.some((item) => !item.product_id || Number(item.quantity) < 1)) {
      toast.error('Select a product and valid quantity for every order line.')
      return
    }
    if (Number(discount) > subtotal) {
      toast.error('Discount cannot exceed the item subtotal.')
      return
    }

    setSaving(true)
    try {
      const response = await api.post('/admin/orders', {
        customer_id: customerId,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        customer_notes: customerNotes,
        shipping_address: shippingAddress,
        items: items.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id || null,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
        })),
        delivery_charge: Number(deliveryCharge) || 0,
        discount: Number(discount) || 0,
        tax: Number(tax) || 0,
      })
      const order = response.data?.data
      toast.success(`Manual order ${order?.order_number || ''} created.`)
      navigate(order?.id ? `/admin/orders/${order.id}` : '/admin/orders')
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create manual order.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Create Manual Order"
        description="Create an order on behalf of an existing customer."
        breadcrumbs={[
          { label: 'Orders', to: '/admin/orders' },
          { label: 'Create Order' },
        ]}
        actions={(
          <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('/admin/orders')}>
            <ArrowLeft size={14} /> Back to orders
          </button>
        )}
      />

      <form onSubmit={save} className="card" style={{ padding: 20, display: 'grid', gap: 18 }}>
        <div className="grid md:grid-cols-2 gap-4">
          <Select label="Customer" required value={customerId} disabled={loading || saving} onChange={(event) => selectCustomer(event.target.value)}>
            <option value="">Select customer</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {[customer.name, customer.phone, customer.email].filter(Boolean).join(' · ')}
              </option>
            ))}
          </Select>
          <Select label="Payment method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
            <option value="cod">Cash on delivery</option>
            <option value="khalti">Khalti</option>
            <option value="esewa">eSewa</option>
          </Select>
          <Select label="Payment status" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
          </Select>
          <Textarea label="Customer notes" rows={2} value={customerNotes} onChange={(event) => setCustomerNotes(event.target.value)} />
        </div>

        <section>
          <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Shipping address</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Input label="Full name" required value={shippingAddress.full_name} onChange={(event) => updateAddress('full_name', event.target.value)} />
            <Input label="Phone" required value={shippingAddress.phone} onChange={(event) => updateAddress('phone', event.target.value)} />
            <Input label="Address line 1" required value={shippingAddress.address_line_1} onChange={(event) => updateAddress('address_line_1', event.target.value)} />
            <Input label="Address line 2" value={shippingAddress.address_line_2} onChange={(event) => updateAddress('address_line_2', event.target.value)} />
            <Input label="Municipality" value={shippingAddress.municipality} onChange={(event) => updateAddress('municipality', event.target.value)} />
            <Input label="District" value={shippingAddress.district} onChange={(event) => updateAddress('district', event.target.value)} />
            <Input label="Province" value={shippingAddress.province} onChange={(event) => updateAddress('province', event.target.value)} />
            <Input label="Postal code" value={shippingAddress.postal_code} onChange={(event) => updateAddress('postal_code', event.target.value)} />
            <Input label="Landmark" value={shippingAddress.landmark} onChange={(event) => updateAddress('landmark', event.target.value)} />
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Order items</h2>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setItems((current) => [...current, blankItem()])}>
              <Plus size={14} /> Add item
            </button>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {items.map((item, index) => {
              const product = products.find((candidate) => candidate.id === item.product_id)
              const variants = product?.variants || []
              return (
                <div key={index} className="grid md:grid-cols-5 gap-3" style={{ alignItems: 'end', padding: 12, border: '1px solid var(--border)', borderRadius: 10 }}>
                  <Select label="Product" required value={item.product_id} disabled={loading || saving} onChange={(event) => updateItem(index, 'product_id', event.target.value)}>
                    <option value="">Select product</option>
                    {products.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>{candidate.name} · {money(candidate.price)}</option>
                    ))}
                  </Select>
                  {variants.length > 0 && (
                    <Select label="Variant" value={item.variant_id} onChange={(event) => updateItem(index, 'variant_id', event.target.value)}>
                      <option value="">Default product price</option>
                      {variants.map((variant) => (
                        <option key={variant.id} value={variant.id}>{variant.name || variant.sku} · {money(variant.price)}</option>
                      ))}
                    </Select>
                  )}
                  <Input label="Quantity" type="number" min="1" step="1" required value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} />
                  <Input label="Unit price (NPR)" type="number" min="0" step="0.01" required value={item.unit_price} onChange={(event) => updateItem(index, 'unit_price', event.target.value)} />
                  <button type="button" className="btn btn-outline btn-sm" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
              )
            })}
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Charges</h2>
          <div className="grid md:grid-cols-4 gap-4">
            <Input label="Delivery charge (NPR)" type="number" min="0" step="0.01" value={deliveryCharge} onChange={(event) => setDeliveryCharge(event.target.value)} />
            <Input label="Discount (NPR)" type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} />
            <Input label="Tax (NPR)" type="number" min="0" step="0.01" value={tax} onChange={(event) => setTax(event.target.value)} />
            <div className="form-group">
              <span className="label">Order total</span>
              <strong style={{ display: 'block', padding: '10px 0' }}>{money(grandTotal)}</strong>
            </div>
          </div>
        </section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/orders')} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || loading || customers.length === 0 || products.length === 0}>
            <Save size={15} /> {saving ? 'Creating…' : 'Create Order'}
          </button>
        </div>
      </form>
    </div>
  )
}
