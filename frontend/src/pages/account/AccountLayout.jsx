import React, { useEffect, useMemo, useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { LogOut, ChevronRight, Menu, X } from 'lucide-react'
import * as Icons from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useBranding } from '../../context/BrandingContext'
import { initials, apiImage } from '../../utils/format'
import { CUSTOMER_NAV } from '../../utils/constants'
import { AccountNavContext } from './AccountUI'
import Drawer from '../../components/ui/Drawer'

function isNavItemActive(to, pathname) {
  if (pathname === to) return true
  if (to === '/account/wishlist' && pathname === '/wishlist') return true
  if (to === '/account/orders') {
    if (pathname === '/orders') return true
    if (/^\/orders\/[^/]+$/.test(pathname)) return true
    if (/^\/account\/orders\/[^/]+$/.test(pathname) && pathname !== '/account/orders/active') return true
  }
  return false
}

function AccountNavItems({ onNavigate }) {
  const { pathname } = useLocation()
  return CUSTOMER_NAV.map((item, idx) => {
    if (item.section) {
      return (
        <div key={`s-${item.section}-${idx}`} className="acc-s-label">
          <span className="acc-s-label-text">{item.section}</span>
        </div>
      )
    }
    const Icon = Icons[item.icon] || Icons.Circle
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={onNavigate}
        aria-label={item.label}
        title={item.label}
        aria-current={isNavItemActive(item.to, pathname) ? 'page' : undefined}
        className={`acc-nav-link${isNavItemActive(item.to, pathname) ? ' active' : ''}`}
      >
        <Icon size={17} strokeWidth={2} aria-hidden="true" />
        <span className="acc-nav-text">{item.label}</span>
      </Link>
    )
  })
}

function AccountIdentity({ user, initials: userInitials, compact = false }) {
  if (!user) return null
  return (
    <div className={`acc-user${compact ? ' acc-user--drawer' : ''}`}>
      {user.avatar ? (
        <img className="acc-user-avatar" src={apiImage(user.avatar)} alt="" />
      ) : (
        <span className="acc-user-avatar">{userInitials}</span>
      )}
      <div className="acc-user-text">
        <div className="acc-user-name">{user.name}</div>
        <div className="acc-user-mail">{user.email}</div>
      </div>
    </div>
  )
}

export default function AccountLayout() {
  const { user, logout } = useAuth()
  const branding = useBranding()
  const location = useLocation()
  const [label, setLabel] = useState('My Account')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const userInitials = useMemo(() => initials(user?.name || user?.email || 'U'), [user])
  const brandName = branding.brand_name || branding.site_name || 'GOSIKA'
  const brandLogo = branding.logo_light || branding.logo_dark || ''

  useEffect(() => {
    setMobileNavOpen(false)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  const handleLogout = async () => {
    await logout()
    window.location.href = '/'
  }

  const navCtx = useMemo(() => ({ label, setLabel }), [label])
  const closeMobileNav = () => setMobileNavOpen(false)

  return (
    <div className="account-shell" id="customer-account-shell">
      <div className="acc-desktop-toolbar">
        <div className="acc-desktop-heading">
          <BreadcrumbNav activeLabel={label} />
          <h1 className="acc-shell-title">My Account</h1>
        </div>
      </div>

      <div className="acc-mobilebar">
        <button
          type="button"
          className="acc-mobile-menu-btn"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open account navigation"
          aria-expanded={mobileNavOpen}
        >
          <Menu size={20} />
        </button>
        <h1 className="acc-current-title">{label}</h1>
      </div>

      <div className="account-layout" id="account-layout-grid">
        <aside className="acc-sidebar" aria-label="Account sidebar">
          <BrandBlock link brandName={brandName} brandLogo={brandLogo} />
          <AccountIdentity user={user} initials={userInitials} />
          <div className="acc-nav-scroll">
            <nav className="acc-nav" aria-label="Account navigation">
              <AccountNavItems />
            </nav>
          </div>
          <button type="button" className="acc-logout" onClick={handleLogout}>
            <LogOut size={17} />
            <span className="acc-logout-text">Logout</span>
          </button>
        </aside>

        <main className="account-main" id="account-main-content">
          <AccountNavContext.Provider value={navCtx}>
            <Outlet />
          </AccountNavContext.Provider>
        </main>
      </div>

      <Drawer
        open={mobileNavOpen}
        onClose={closeMobileNav}
        title="Account navigation"
        side="left"
        panelClassName="account-nav-drawer"
        bodyClassName="account-nav-drawer-body"
        headerContent={(
          <div className="account-drawer-header">
            <BrandBlock brandName={brandName} brandLogo={brandLogo} />
            <button
              type="button"
              className="icon-btn"
              onClick={closeMobileNav}
              aria-label="Close account navigation"
            >
              <X size={18} />
            </button>
          </div>
        )}
      >
        <AccountIdentity user={user} initials={userInitials} compact />
        <nav className="acc-nav" aria-label="Mobile account navigation">
          <AccountNavItems onNavigate={closeMobileNav} />
        </nav>
        <button type="button" className="acc-logout" onClick={handleLogout}>
          <LogOut size={17} />
          <span className="acc-logout-text">Logout</span>
        </button>
      </Drawer>
    </div>
  )
}

function BrandBlock({ link, brandName, brandLogo }) {
  const logo = (
    <>
      <span className="acc-brand-mark">
        {brandLogo ? <img className="acc-brand-logo" src={apiImage(brandLogo)} alt="" /> : 'G'}
      </span>
      <span className="acc-brand-copy">
        <span className="acc-brand-text">{brandName}</span>
        <span className="acc-brand-caption">Customer Account</span>
      </span>
    </>
  )
  return link ? (
    <Link className="acc-brand" to="/" aria-label={`${brandName} Home`}>
      {logo}
    </Link>
  ) : (
    <div className="acc-brand">{logo}</div>
  )
}

function BreadcrumbNav({ activeLabel }) {
  return (
    <nav className="acc-breadcrumb" aria-label="Breadcrumb">
      <Link to="/">Home</Link>
      <ChevronRight size={13} className="acc-breadcrumb-sep" aria-hidden="true" />
      <span>My Account</span>
      {activeLabel && activeLabel !== 'My Account' && (
        <>
          <ChevronRight size={13} className="acc-breadcrumb-sep" aria-hidden="true" />
          <span className="acc-breadcrumb-here">{activeLabel}</span>
        </>
      )}
    </nav>
  )
}
