import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react'
import api from '../../api/client'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import Textarea from '../../components/ui/Textarea'
import PageHeader from '../../components/admin/PageHeader'
import LocationMapPicker from '../../components/common/LocationMapPicker'
import { useToast } from '../../context/ToastContext'
import { money } from '../../utils/format'

const blankItem = () => ({ product_id: '', variant_id: '', quantity: '1', unit_price: '', product_search: '' })
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
  latitude: '',
  longitude: '',
}

function SearchPicker({
  label,
  value,
  placeholder,
  options,
  loading,
  open,
  required = false,
  disabled = false,
  onChange,
  onFocus,
  onBlur,
  onSelect,
  renderOption,
  footer,
  hint,
}) {
  return (
    <div className="form-group" style={{ position: 'relative' }}>
      <label className="label">{label} {required && <span className="req">*</span>}</label>
      <input
        className="input"
        required={required}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={onFocus}
        onBlur={() => window.setTimeout(onBlur, 120)}
        onChange={(event) => onChange(event.target.value)}
      />
      {open && (
        <div
          className="card"
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 20,
            maxHeight: 260,
            overflowY: 'auto',
            padding: 6,
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {loading ? (
            <div className="muted text-sm p-2">Searching…</div>
          ) : (
            <React.Fragment>
              {options.length ? options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  className="btn btn-ghost"
                  style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    onSelect(option)
                  }}
                >
                  {renderOption(option)}
                </button>
              )) : (
                <div className="muted text-sm p-2">No matching results.</div>
              )}
              {footer}
            </React.Fragment>
          )}
        </div>
      )}
      {hint && <div className="muted text-xs mt-1">{hint}</div>}
    </div>
  )
}

export default function AdminManualOrderForm() {
  const navigate = useNavigate()
  const toast = useToast()
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [manualCustomer, setManualCustomer] = useState(false)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerSearchResults, setCustomerSearchResults] = useState([])
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false)
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const [productSearchResults, setProductSearchResults] = useState([])
  const [productSearchLoading, setProductSearchLoading] = useState(false)
  const [activeProductIndex, setActiveProductIndex] = useState(null)
  const [shippingSettings, setShippingSettings] = useState({})
  const [shippingAddress, setShippingAddress] = useState(blankAddress)
  const [paymentMethod, setPaymentMethod] = useState('cod')
  const [paymentStatus, setPaymentStatus] = useState('pending')
  const [customerNotes, setCustomerNotes] = useState('')
  const [discount, setDiscount] = useState('0')
  const [items, setItems] = useState([blankItem()])

  useEffect(() => {
    let active = true
    Promise.all([
      api.get('/admin/customers', { params: { status: 'active', per_page: 20 } }),
      api.get('/admin/products', { params: { status: 'published', per_page: 20 } }),
      api.get('/admin/settings/shipping'),
    ]).then(([customerResponse, productResponse, settingsResponse]) => {
      if (!active) return
      setCustomers(api.unwrapList(customerResponse.data))
      setProducts(api.unwrapList(productResponse.data))
      setShippingSettings(settingsResponse.data?.data || {})
    }).catch((error) => {
      const message = error.response?.data?.message || 'Failed to load customers, products, or shipping settings.'
      setLoadError(message)
      toast.error(message)
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => { active = false }
  }, [toast])

  useEffect(() => {
    const query = customerQuery.trim()
    if (!customerDropdownOpen || query.length < 2) {
      setCustomerSearchResults([])
      setCustomerSearchLoading(false)
      return undefined
    }

    let active = true
    setCustomerSearchLoading(true)
    const timeout = window.setTimeout(() => {
      api.get('/admin/customers', { params: { status: 'active', search: query, per_page: 20 } })
        .then((response) => {
          if (active) setCustomerSearchResults(api.unwrapList(response.data))
        })
        .catch((error) => {
          if (active) toast.error(error.response?.data?.message || 'Could not search customers.')
        })
        .finally(() => {
          if (active) setCustomerSearchLoading(false)
        })
    }, 250)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [customerQuery, customerDropdownOpen, toast])

  useEffect(() => {
    const query = productSearchQuery.trim()
    if (activeProductIndex === null || query.length < 2) {
      setProductSearchResults([])
      setProductSearchLoading(false)
      return undefined
    }

    let active = true
    setProductSearchResults([])
    setProductSearchLoading(true)
    const timeout = window.setTimeout(() => {
      api.get('/admin/products', { params: { status: 'published', search: query, per_page: 20 } })
        .then((response) => {
          if (!active) return
          const results = api.unwrapList(response.data)
          setProductSearchResults(results)
          setProducts((current) => {
            const byId = new Map(current.map((product) => [product.id, product]))
            results.forEach((product) => byId.set(product.id, product))
            return Array.from(byId.values())
          })
        })
        .catch((error) => {
          if (active) toast.error(error.response?.data?.message || 'Could not search products.')
        })
        .finally(() => {
          if (active) setProductSearchLoading(false)
        })
    }, 250)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [productSearchQuery, activeProductIndex, toast])

  const customerSearchTerm = customerQuery.trim().toLowerCase()
  const productSearchTerm = productSearchQuery.trim().toLowerCase()
  const customerOptions = customerSearchTerm.length >= 2
    ? customerSearchResults
    : customers.filter((customer) => (
      !customerSearchTerm
      || [customer.name, customer.phone, customer.email].some((value) => String(value || '').toLowerCase().includes(customerSearchTerm))
    )).slice(0, 20)
  const productOptions = productSearchTerm.length >= 2
    ? productSearchResults
    : products.filter((product) => (
      !productSearchTerm
      || [product.name, product.sku].some((value) => String(value || '').toLowerCase().includes(productSearchTerm))
    )).slice(0, 20)

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.unit_price) || 0) * (Number(item.quantity) || 0), 0),
    [items],
  )
  const tax = useMemo(() => {
    const amount = items.reduce((sum, item) => {
      const product = products.find((candidate) => candidate.id === item.product_id)
      const rate = Number(product?.tax_rate) || 0
      return sum + (Number(item.unit_price) || 0) * (Number(item.quantity) || 0) * rate / 100
    }, 0)
    return Math.round((amount + Number.EPSILON) * 100) / 100
  }, [items, products])
  const deliveryCharge = useMemo(() => {
    const byVendor = new Map()
    items.forEach((item) => {
      const product = products.find((candidate) => candidate.id === item.product_id)
      if (!product) return
      const vendorId = product.vendor?.id || product.id
      const lineTotal = (Number(item.unit_price) || 0) * (Number(item.quantity) || 0)
      byVendor.set(vendorId, (byVendor.get(vendorId) || 0) + lineTotal)
    })
    const flatFee = Number(shippingSettings['shipping.flat_charge'] ?? shippingSettings.flat_charge ?? 80)
    const freeThreshold = Number(
      shippingSettings['shipping.free_delivery_threshold']
      ?? shippingSettings.free_delivery_threshold
      ?? shippingSettings.free_shipping_threshold
      ?? 2000,
    )
    const charge = Array.from(byVendor.values()).reduce((sum, vendorSubtotal) => (
      sum + (freeThreshold > 0 && vendorSubtotal >= freeThreshold ? 0 : flatFee)
    ), 0)
    return Math.round((charge + Number.EPSILON) * 100) / 100
  }, [items, products, shippingSettings])
  const grandTotal = Math.max(
    0,
    subtotal - (Number(discount) || 0) + deliveryCharge + tax,
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
        next.unit_price = variant?.price ?? product?.price ?? ''
      }
      return next
    }))
  }

  const searchProductsForItem = (index, query) => {
    setActiveProductIndex(index)
    setProductSearchQuery(query)
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index
        ? { ...item, product_search: query, product_id: '', variant_id: '', unit_price: '' }
        : item
    )))
  }

  const selectProduct = (index, product) => {
    setProducts((current) => (
      current.some((candidate) => candidate.id === product.id)
        ? current.map((candidate) => candidate.id === product.id ? product : candidate)
        : [...current, product]
    ))
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index
        ? {
          ...item,
          product_id: product.id,
          variant_id: '',
          unit_price: product.price ?? '',
          product_search: product.name,
        }
        : item
    )))
    setActiveProductIndex(null)
  }

  const selectCustomer = (id) => {
    setCustomerId(id)
    setManualCustomer(false)
    const customer = [...customers, ...customerSearchResults].find((candidate) => candidate.id === id)
    if (customer) {
      setCustomers((current) => (
        current.some((candidate) => candidate.id === id) ? current : [...current, customer]
      ))
      setShippingAddress({
        ...blankAddress,
        full_name: customer.name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
        phone: customer.phone || '',
      })
      setCustomerQuery(customer.name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim())
    }
    setCustomerDropdownOpen(false)
  }

  const chooseManualCustomer = () => {
    const name = customerQuery.trim()
    if (name.length < 2) {
      toast.error('Type a customer name first, then choose "Create new customer".')
      return
    }
    setCustomerId('')
    setManualCustomer(true)
    setCustomerDropdownOpen(false)
    setShippingAddress((current) => ({
      ...current,
      full_name: current.full_name || name,
    }))
  }

  const handleMapAddressChange = (location) => {
    setShippingAddress((current) => ({
      ...current,
      address_line_1: location.street || current.address_line_1,
      municipality: location.municipality || '',
      district: location.district || '',
      province: location.province || '',
      landmark: location.landmark || '',
      latitude: location.latitude ?? '',
      longitude: location.longitude ?? '',
    }))
  }

  const save = async (event) => {
    event.preventDefault()
    if (loadError) {
      toast.error('Reload the form to retry loading the current shipping settings.')
      return
    }
    const useNewCustomer = !customerId && (manualCustomer || customerQuery.trim().length >= 2)
    if (!customerId && !useNewCustomer) {
      toast.error('Type a customer name to create a walk-in customer, or select an existing customer.')
      return
    }
    if (useNewCustomer && (!shippingAddress.full_name.trim() || !shippingAddress.phone.trim())) {
      toast.error('Enter the walk-in customer name and phone in the shipping address.')
      return
    }
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
        ...(customerId
          ? { customer_id: customerId }
          : {
            customer: {
              full_name: shippingAddress.full_name || customerQuery.trim(),
              phone: shippingAddress.phone || null,
            },
          }),
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
        description="Create an order for an existing customer or a walk-in customer."
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
        {loadError && <div className="alert alert-error" role="alert">{loadError} Reload the page before creating the order.</div>}
        <div className="grid md:grid-cols-2 gap-4">
          <SearchPicker
            label="Customer"
            required
            value={customerQuery}
            placeholder="Search customer name, phone, or email"
            options={customerOptions}
            loading={customerSearchLoading}
            open={customerDropdownOpen}
            disabled={loading || saving}
            onFocus={() => setCustomerDropdownOpen(true)}
            onBlur={() => setCustomerDropdownOpen(false)}
            onChange={(query) => {
              setCustomerQuery(query)
              setCustomerId('')
              setManualCustomer(false)
              setCustomerDropdownOpen(true)
            }}
            onSelect={(customer) => selectCustomer(customer.id)}
            renderOption={(customer) => (
              <span>
                <strong>{customer.name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim()}</strong>
                <span className="muted text-xs" style={{ display: 'block' }}>
                  {[customer.phone, customer.email].filter(Boolean).join(' · ')}
                </span>
              </span>
            )}
            footer={customerQuery.trim().length >= 2 && !manualCustomer && !customerId ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onMouseDown={(event) => {
                  event.preventDefault()
                  chooseManualCustomer()
                }}
              >
                <Plus size={14} /> Create new customer “{customerQuery.trim()}”
              </button>
            ) : null}
            hint={manualCustomer
              ? 'A new customer will be created from the shipping name and phone entered below.'
              : 'Select an existing customer, or just type a new name to create a walk-in customer.'}
          />
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
          <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Shipping address and map pin</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Input label="Full name" required value={shippingAddress.full_name} onChange={(event) => updateAddress('full_name', event.target.value)} />
            <Input label="Phone" required value={shippingAddress.phone} onChange={(event) => updateAddress('phone', event.target.value)} />
          </div>
          <LocationMapPicker
            key={customerId || 'manual-order'}
            title="Delivery address map"
            description="Pin the delivery location or use GPS; the location details will be saved with the order."
            value={{
              province: shippingAddress.province,
              district: shippingAddress.district,
              municipality: shippingAddress.municipality,
              street: shippingAddress.address_line_1,
              landmark: shippingAddress.landmark,
              latitude: shippingAddress.latitude,
              longitude: shippingAddress.longitude,
            }}
            onChange={handleMapAddressChange}
          />
          <div className="grid md:grid-cols-2 gap-4 mt-3">
            <Input label="Address line 2" value={shippingAddress.address_line_2} onChange={(event) => updateAddress('address_line_2', event.target.value)} />
            <Input label="Postal code" value={shippingAddress.postal_code} onChange={(event) => updateAddress('postal_code', event.target.value)} />
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
                  <SearchPicker
                    label="Product"
                    required
                    value={item.product_search}
                    placeholder="Search product name or SKU"
                    options={productOptions}
                    loading={productSearchLoading && activeProductIndex === index}
                    open={activeProductIndex === index}
                    disabled={loading || saving}
                    onFocus={() => {
                      setActiveProductIndex(index)
                      setProductSearchQuery(item.product_search || '')
                    }}
                    onBlur={() => setActiveProductIndex(null)}
                    onChange={(query) => searchProductsForItem(index, query)}
                    onSelect={(candidate) => selectProduct(index, candidate)}
                    renderOption={(candidate) => (
                      <span>
                        <strong>{candidate.name}</strong>
                        <span className="muted text-xs" style={{ display: 'block' }}>
                          {money(candidate.price)} · SKU {candidate.sku || '—'}
                        </span>
                      </span>
                    )}
                  />
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
            <Input
              label="Delivery charge (NPR)"
              type="number"
              min="0"
              step="0.01"
              value={deliveryCharge.toFixed(2)}
              readOnly
              hint="Auto-calculated from the configured flat fee and free-delivery threshold for each vendor."
            />
            <Input label="Discount (NPR)" type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} />
            <Input
              label="Tax (NPR)"
              type="number"
              min="0"
              step="0.01"
              value={tax.toFixed(2)}
              readOnly
              hint="Auto-calculated from each product's configured tax rate."
            />
            <div className="form-group">
              <span className="label">Order total</span>
              <strong style={{ display: 'block', padding: '10px 0' }}>{money(grandTotal)}</strong>
            </div>
          </div>
        </section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/orders')} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || loading || Boolean(loadError) || products.length === 0 || (!customerId && customerQuery.trim().length < 2)}>
            <Save size={15} /> {saving ? 'Creating…' : 'Create Order'}
          </button>
        </div>
      </form>
    </div>
  )
}
