/* Momentum – push handling inside the service worker (imported by the generated sw.js). */
self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch {
    d = { title: 'Momentum', body: event.data ? event.data.text() : '' }
  }
  const de = (self.navigator.language || 'de').toLowerCase().startsWith('de')
  const actions = d.occKey ? [{ action: 'done', title: de ? 'Erledigt ✓' : 'Done ✓' }, { action: 'open', title: de ? 'Öffnen' : 'Open' }] : []
  event.waitUntil(
    self.registration.showNotification(d.title || 'Momentum', {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      vibrate: [90, 40, 90],
      data: { url: d.url || './', occKey: d.occKey || null },
      actions,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const scope = self.registration.scope
  let target = new URL(data.url || './', scope).href
  if (event.action === 'done' && data.occKey) target = new URL(`./#/today?done=${encodeURIComponent(data.occKey)}`, scope).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of windows) {
        if ('focus' in c) {
          await c.focus()
          if ('navigate' in c) await c.navigate(target).catch(() => {})
          return
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})
