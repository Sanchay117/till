// Three pages do not need a routing library.
import { useEffect, useState } from 'react'

export type Route = { page: 'home' } | { page: 'new' } | { page: 'invoice'; id: `0x${string}` } | { page: 'notFound' }

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return { page: 'home' }
  if (path === '/new') return { page: 'new' }
  const invoice = path.match(/^\/i\/(0x[0-9a-fA-F]{64})$/)
  if (invoice) return { page: 'invoice', id: invoice[1].toLowerCase() as `0x${string}` }
  return { page: 'notFound' }
}

export function navigate(to: string) {
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])
  return route
}

/** For <a> tags: client-side navigation on a plain click, normal behaviour for new tabs. */
export function linkProps(to: string) {
  return {
    href: to,
    onClick(event: React.MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      navigate(to)
    },
  }
}
