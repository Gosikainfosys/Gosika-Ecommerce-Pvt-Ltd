import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FolderTree, Plus, Edit, Trash2, Search, LayoutGrid, List,
  Eye, Percent, ChevronDown, ChevronRight
} from 'lucide-react'
import api from '../../api/client'
import { Skeleton } from '../../components/ui/Skeleton'
import EmptyState from '../../components/ui/EmptyState'
import { apiImage, handleImgError, IMG_PLACEHOLDER } from '../../utils/format'
import { useToast } from '../../context/ToastContext'

const CATEGORY_IMAGE_MAP = {
  'food-beverages': { image: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500&q=80' },
  'apparel': { image: 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=500&q=80' },
  'home-living': { image: 'https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=500&q=80' },
  'beauty-care': { image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=500&q=80' },
  'electronics': { image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&q=80' },
  'handicrafts': { image: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=500&q=80' },
  'sports-outdoors': { image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&q=80' },
}

function presetCategoryImage(category) {
  const slug = (category?.slug || category?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-')) || ''
  if (CATEGORY_IMAGE_MAP[slug]?.image) return CATEGORY_IMAGE_MAP[slug].image
  for (const key of Object.keys(CATEGORY_IMAGE_MAP)) {
    if (slug.includes(key) || key.includes(slug)) return CATEGORY_IMAGE_MAP[key].image
  }
  return IMG_PLACEHOLDER
}

function categoryImageUrl(category) {
  return category?.image ? apiImage(category.image) : presetCategoryImage(category)
}

function handleCategoryImageError(event, category) {
  const fallback = presetCategoryImage(category)
  if (fallback !== IMG_PLACEHOLDER && event.currentTarget.src !== fallback) {
    event.currentTarget.onerror = () => handleImgError(event)
    event.currentTarget.src = fallback
    return
  }
  handleImgError(event)
}

function buildCategoryTree(list) {
  const nodes = new Map(list.map((category) => [category.id, { ...category, children: [] }]))
  const roots = []

  nodes.forEach((node) => {
    const parent = node.parent_id ? nodes.get(node.parent_id) : null
    if (parent && parent.id !== node.id) parent.children.push(node)
    else roots.push(node)
  })

  const sortNodes = (items) => {
    items.sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || a.name.localeCompare(b.name))
    items.forEach((item) => sortNodes(item.children))
  }
  sortNodes(roots)

  return roots
}

function filterCategoryTree(nodes, term) {
  const query = term.trim().toLowerCase()
  if (!query) return nodes

  return nodes.reduce((matches, node) => {
    const children = filterCategoryTree(node.children || [], query)
    const selfMatches =
      node.name?.toLowerCase().includes(query) ||
      node.slug?.toLowerCase().includes(query)

    if (selfMatches || children.length) {
      matches.push({ ...node, children })
    }
    return matches
  }, [])
}

function flattenCategoryTree(nodes) {
  return nodes.flatMap((node) => [node, ...flattenCategoryTree(node.children || [])])
}

function descendantProductCount(node) {
  const own = Number(node.products_count) || 0
  return own + (node.children || []).reduce((sum, child) => sum + descendantProductCount(child), 0)
}

function CategoryTreeRows({ nodes, depth, collapsed, onToggle, onView, onEdit, onDelete, onAddChild, deleting }) {
  return nodes.map((node) => {
    const hasChildren = (node.children || []).length > 0
    const isCollapsed = collapsed.has(node.id)

    return (
      <React.Fragment key={node.id}>
        <tr onClick={() => onView(node)} style={{ cursor: 'pointer' }}>
          <td>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: depth * 22 }}>
              {hasChildren ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  style={{ width: 24, padding: 0, flexShrink: 0 }}
                  onClick={(event) => { event.stopPropagation(); onToggle(node.id) }}
                  title={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
              ) : (
                <span style={{ width: 24, flexShrink: 0 }} />
              )}
              <span className="thumb" style={{ width: 44, height: 44, borderRadius: 'var(--radius)', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--border)' }}>
                <img
                  src={categoryImageUrl(node)}
                  alt={node.name}
                  className="thumb-img"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(event) => handleCategoryImageError(event, node)}
                />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="font-bold text-sm text-ink" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {depth > 0 && <span style={{ color: 'var(--primary)' }}>↳</span>}
                  {node.name}
                </div>
                <div className="muted text-xs">
                  {depth === 0 ? 'Top Level Department' : `Level ${depth + 1} · ${hasChildren ? `${node.children.length} subcategor${node.children.length === 1 ? 'y' : 'ies'}` : 'Sub-category'}`}
                </div>
              </div>
            </div>
          </td>
          <td><span className="font-mono text-xs muted">{node.slug}</span></td>
          <td>
            <span className={`chip chip-sm ${Number(node.tax_rate) > 0 ? '' : 'chip-muted'}`}>
              <Percent size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3 }} />
              {Number(node.tax_rate) || 0}%
            </span>
          </td>
          <td><span className="font-bold text-ink">{descendantProductCount(node)}</span></td>
          <td>
            <span className="chip chip-sm" style={{ background: node.status === 'active' ? 'var(--success-bg)' : '#f1f5f9', color: node.status === 'active' ? 'var(--success)' : '#64748b' }}>
              {node.status === 'active' ? 'Live' : 'Inactive'}
            </span>
          </td>
          <td style={{ textAlign: 'right' }}>
            <div style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <button className="btn btn-outline btn-xs" onClick={(event) => { event.stopPropagation(); onAddChild(node) }} title={`Create a subcategory under ${node.name}`}>
                <Plus size={12} /> Child
              </button>
              <button className="btn btn-outline btn-xs" onClick={(event) => { event.stopPropagation(); onView(node) }} title="View category">
                <Eye size={12} /> View
              </button>
              <button className="btn btn-outline btn-xs" onClick={(event) => { event.stopPropagation(); onEdit(node) }} title="Edit category">
                <Edit size={12} /> Edit
              </button>
              <button className="btn btn-danger-outline btn-xs" disabled={deleting === node.id} onClick={(event) => { event.stopPropagation(); onDelete(node) }} title="Delete category">
                <Trash2 size={12} />
              </button>
            </div>
          </td>
        </tr>
        {hasChildren && !isCollapsed && (
          <CategoryTreeRows
            nodes={node.children}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddChild={onAddChild}
            deleting={deleting}
          />
        )}
      </React.Fragment>
    )
  })
}

export default function AdminCategories() {
  const toast = useToast()
  const navigate = useNavigate()
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState('tree') // 'tree' | 'grid'
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [deleting, setDeleting] = useState(null)

  const load = () => {
    api.get('/admin/categories')
      .then((r) => {
        setCategories(api.unwrapList(r.data))
      })
      .catch(() => toast.error('Failed to load categories.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [toast])

  const tree = useMemo(() => buildCategoryTree(categories), [categories])
  const filteredTree = useMemo(() => filterCategoryTree(tree, search), [tree, search])
  const visibleCategories = useMemo(() => flattenCategoryTree(filteredTree), [filteredTree])

  const totalProducts = categories.reduce((sum, category) => sum + (Number(category.products_count) || 0), 0)
  const taxed = categories.filter((category) => Number(category.tax_rate) > 0).length

  const toggleNode = (id) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addChild = (category) => {
    navigate(`/admin/marketplace/categories/new?parent=${encodeURIComponent(category.id)}`)
  }

  const doDelete = async (category) => {
    const childCount = category.children?.length || 0
    const warning = childCount
      ? `Delete category "${category.name}"? Its ${childCount} subcategor${childCount === 1 ? 'y' : 'ies'} will become top-level categories.`
      : `Delete category "${category.name}"? Products stay in the catalog but lose this department link.`
    if (!window.confirm(warning)) return

    setDeleting(category.id)
    try {
      await api.delete(`/admin/categories/${category.id}`)
      toast.success('Category deleted')
      load()
    } catch (e) {
      toast.error('Failed to delete category. It may still have products linked.')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Categories & Tax</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            Manage marketplace departments, nested subcategories, VAT rates, navigation icons, and cover images.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="date-filter-group" style={{ marginRight: 8 }}>
            <button
              className={`date-filter-btn ${viewMode === 'tree' ? 'active' : ''}`}
              onClick={() => setViewMode('tree')}
              title="Tree View"
            >
              <FolderTree size={13} style={{ display: 'inline', marginRight: 4 }} /> Tree
            </button>
            <button
              className={`date-filter-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid View"
            >
              <LayoutGrid size={13} style={{ display: 'inline', marginRight: 4 }} /> Grid
            </button>
          </div>

          <button className="btn btn-primary btn-sm" onClick={() => navigate('/admin/marketplace/categories/new')}>
            <Plus size={14} /> Add New Category
          </button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 16 }}>
        <div className="card flex flex-col justify-between" style={{ padding: '16px 18px', margin: 0 }}>
          <div className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Departments</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>{categories.length}</div>
        </div>
        <div className="card flex flex-col justify-between" style={{ padding: '16px 18px', margin: 0 }}>
          <div className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Catalog Items</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)' }}>{totalProducts}</div>
        </div>
        <div className="card flex flex-col justify-between" style={{ padding: '16px 18px', margin: 0 }}>
          <div className="muted text-xs font-bold uppercase" style={{ letterSpacing: '0.04em' }}>Taxed Departments</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#2563eb' }}>{taxed}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="Search categories or subcategories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'tree' && (
            <>
              <button className="btn btn-outline btn-xs" onClick={() => setCollapsed(new Set())}>Expand all</button>
              <button className="btn btn-outline btn-xs" onClick={() => setCollapsed(new Set(tree.map((category) => category.id)))}>Collapse all</button>
            </>
          )}
          <span className="muted text-sm">{visibleCategories.length} categor{visibleCategories.length === 1 ? 'y' : 'ies'} listed</span>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={70} />)}
        </div>
      ) : !visibleCategories.length ? (
        <EmptyState
          icon={FolderTree}
          title={search ? `No categories matching "${search}"` : 'No categories found'}
          message={search ? 'Try searching for another category.' : 'Add marketplace departments to organize vendor products.'}
          action={
            <button className="btn btn-primary" onClick={() => navigate('/admin/marketplace/categories/new')}>
              <Plus size={14} /> Add New Category
            </button>
          }
        />
      ) : viewMode === 'tree' ? (
        <div className="card card-pad-none" style={{ overflow: 'hidden' }}>
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Category / Subcategory</th>
                  <th>Slug / Identifier</th>
                  <th>VAT Rate</th>
                  <th>Products</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                <CategoryTreeRows
                  nodes={filteredTree}
                  depth={0}
                  collapsed={collapsed}
                  onToggle={toggleNode}
                  onView={(category) => navigate(`/admin/marketplace/categories/${category.id}`)}
                  onEdit={(category) => navigate(`/admin/marketplace/categories/${category.id}/edit`)}
                  onDelete={doDelete}
                  onAddChild={addChild}
                  deleting={deleting}
                />
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
          {visibleCategories.map((category) => (
            <div key={category.id} className="card card-pad-none card-hover" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: 'pointer' }} onClick={() => navigate(`/admin/marketplace/categories/${category.id}`)}>
              <div style={{ height: 130, position: 'relative', overflow: 'hidden' }}>
                <img
                  src={categoryImageUrl(category)}
                  alt={category.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(event) => handleCategoryImageError(event, category)}
                />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.1) 60%)' }} />
                <div style={{ position: 'absolute', bottom: 10, left: 12, right: 12 }}>
                  <div style={{ color: '#fff', fontWeight: 800, fontSize: 16, textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>{category.name}</div>
                </div>
              </div>
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div className="flex items-center justify-between text-xs mb-3">
                  <span className="font-mono muted">slug: {category.slug}</span>
                  <span className="chip chip-sm">VAT {Number(category.tax_rate) || 0}%</span>
                </div>
                <div className="muted text-xs mb-3">{category.products_count ?? 0} products · {category.status}</div>
                <div className="flex items-center justify-end gap-1 mt-auto pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <button className="btn btn-outline btn-xs" onClick={(event) => { event.stopPropagation(); addChild(category) }}>
                    <Plus size={12} /> Child
                  </button>
                  <button className="btn btn-outline btn-xs" onClick={(event) => { event.stopPropagation(); navigate(`/admin/marketplace/categories/${category.id}`) }}>
                    <Eye size={12} /> View
                  </button>
                  <button className="btn btn-outline btn-xs" onClick={(event) => { event.stopPropagation(); navigate(`/admin/marketplace/categories/${category.id}/edit`) }}>
                    <Edit size={12} /> Edit
                  </button>
                  <button className="btn btn-danger-outline btn-xs" disabled={deleting === category.id} onClick={(event) => { event.stopPropagation(); doDelete(category) }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
