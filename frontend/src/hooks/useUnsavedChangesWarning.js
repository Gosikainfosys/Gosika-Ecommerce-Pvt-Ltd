import { useEffect, useRef } from 'react'

const DEFAULT_MESSAGE = 'You have unsaved product changes. Leave this page anyway?'

export default function useUnsavedChangesWarning(dirty, message = DEFAULT_MESSAGE) {
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }

    const handleClickCapture = (event) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const anchor = event.target.closest?.('a[href]')
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return

      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#')) return

      const target = new URL(anchor.href, window.location.href)
      if (target.origin !== window.location.origin || target.href === window.location.href) return

      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleClickCapture, true)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleClickCapture, true)
    }
  }, [message])

  return (navigate, ...args) => {
    if (!dirtyRef.current || window.confirm(message)) navigate(...args)
  }
}
