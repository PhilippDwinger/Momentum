import { useSyncExternalStore } from 'react'

/**
 * Minimal hash router. Hash routing works on any static host and inside the PWA scope
 * without server rewrites.
 */
export interface Route {
  path: string
  segments: string[]
  query: URLSearchParams
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/today'
  const [path, qs = ''] = raw.split('?')
  const clean = path.startsWith('/') ? path : `/${path}`
  return { path: clean, segments: clean.split('/').filter(Boolean), query: new URLSearchParams(qs) }
}

let current = parse()
const listeners = new Set<() => void>()
window.addEventListener('hashchange', () => {
  current = parse()
  listeners.forEach((l) => l())
})

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const hash = to.startsWith('#') ? to : `#${to}`
  if (opts.replace) {
    history.replaceState(null, '', hash)
    current = parse()
    listeners.forEach((l) => l())
  } else if (window.location.hash !== hash) {
    window.location.hash = hash
  }
}

export function href(to: string) {
  return `#${to}`
}

/** Update query params of the current route (replaceState). */
export function setQuery(patch: Record<string, string | null>) {
  const q = new URLSearchParams(current.query)
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) q.delete(k)
    else q.set(k, v)
  }
  const qs = q.toString()
  navigate(`${current.path}${qs ? `?${qs}` : ''}`, { replace: true })
}
