export function isCustomerAccountPath(pathname) {
  return pathname === '/account'
    || pathname.startsWith('/account/')
    || pathname === '/orders'
    || pathname.startsWith('/orders/')
    || pathname === '/wishlist'
}
