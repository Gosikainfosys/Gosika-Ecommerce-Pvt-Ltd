import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, X } from 'lucide-react'
import api from '../api/client'
import { useWishlist } from '../context/WishlistContext'
import { AccountPage, AccountEmpty, AccountError, AccountSkeleton } from './account/AccountUI'
import { money, errorMessage, getProductImage } from '../utils/format'

const PAGE_TITLE = 'Wishlist'
const PAGE_SUBTITLE = 'Products you saved for later.'

export default function Wishlist() {
  const { toggle } = useWishlist()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [removing, setRemoving] = useState(null)

  const load = () => {
    setLoading(true)
    setError(null)
    api
      .get('/wishlist')
      .then((res) => {
        const data = res.data.data || res.data
        setItems(data?.items || [])
      })
      .catch((loadError) => setError(loadError))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleRemove = async (item) => {
    const productId = item.product?.id || item.product_id
    if (!productId) return
    setRemoving(productId)
    const result = await toggle(productId)
    setRemoving(null)
    if (result?.ok) {
      setItems((previous) => previous.filter((entry) => (entry.product?.id || entry.product_id) !== productId))
    }
  }

  const actions = <Link to="/shop" className="btn btn-outline btn-sm">Continue shopping</Link>

  if (loading) {
    return (
      <AccountPage title={PAGE_TITLE} subtitle={PAGE_SUBTITLE} actions={actions}>
        <AccountSkeleton rows={2} />
      </AccountPage>
    )
  }

  if (error) {
    return (
      <AccountPage title={PAGE_TITLE} subtitle={PAGE_SUBTITLE} actions={actions}>
        <AccountError message={errorMessage(error)} onRetry={load} />
      </AccountPage>
    )
  }

  if (!items.length) {
    return (
      <AccountPage title={PAGE_TITLE} subtitle={PAGE_SUBTITLE} actions={actions}>
        <AccountEmpty
          icon={Heart}
          title="Your wishlist is empty"
          message="Tap the heart icon on any product to save it here for later."
          action={<Link to="/shop" className="btn btn-primary">Explore products</Link>}
        />
      </AccountPage>
    )
  }

  return (
    <AccountPage title={`${PAGE_TITLE} (${items.length})`} subtitle={PAGE_SUBTITLE} actions={actions}>
      <div className="product-grid account-wishlist-grid">
        {items.map((item) => {
          const product = item.product
          const productId = product?.id || item.product_id
          if (!product) return null
          return (
            <div key={productId} className="card card-pad-none card-hover account-wishlist-card">
              <Link to={`/product/${productId}`} aria-label={product.name} className="account-wishlist-image">
                <img src={getProductImage(product)} alt={product.name} loading="lazy" />
              </Link>
              <div className="account-wishlist-body">
                <Link to={`/product/${productId}`} className="line-clamp-2 font-semibold" style={{ fontSize: 14, lineHeight: 1.35, minHeight: 38, display: 'block' }}>
                  {product.name}
                </Link>
                <span className="price-current" style={{ fontSize: 15 }}>{money(product.price)}</span>
              </div>
              <div className="account-wishlist-actions">
                <Link to={`/product/${productId}`} className="btn btn-primary btn-sm flex-1">View Product</Link>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => handleRemove(item)}
                  disabled={removing === productId}
                  title="Remove from wishlist"
                  aria-label={`Remove ${product.name} from wishlist`}
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </AccountPage>
  )
}
