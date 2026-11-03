/**
 * Minimal in-memory stand-in for the Bridge 3 HTTP API – only the endpoints Momentum uses, with
 * the same request/response shapes and error ids as the real server (verified against it).
 * Used when no real Bridge is available (`BRIDGE_TEST_URL` unset).
 */
const SPLIT = '<|BRIDGE_IP_SPLIT|>'

interface Client {
  ip: string
  password: string
  mailbox: unknown[]
  topics: Set<string>
}

export class FakeBridge {
  url = 'http://fake-bridge.test'
  clients = new Map<string, Client>()
  sessions = new Map<string, string>()
  realm = `${this.url}${SPLIT}publicrealm`
  sentLog: unknown[] = []
  private n = 0

  restart() {
    this.clients.clear()
    this.sessions.clear()
  }

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const path = input.replace(this.url, '')
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    const err = (status: number, error: string) => new Response(JSON.stringify({ detail: { error, name: error, message: error } }), { status })
    const auth = () => {
      const ip = this.sessions.get(body.session_token)
      return ip ? this.clients.get(ip) : undefined
    }
    switch (path) {
      case '/realm/public':
        return ok({ realm_address: this.realm })
      case '/client/register': {
        const ip = `${this.url}${SPLIT}${body.identity_secret ?? `rnd${++this.n}`}`.slice(0, 120)
        if (this.clients.has(ip)) return err(409, 'ALREADY_EXISTS')
        this.clients.set(ip, { ip, password: body.password, mailbox: [], topics: new Set() })
        return ok({ client_ip: ip, stable_identity: true })
      }
      case '/client/login': {
        const c = this.clients.get(body.client_ip)
        if (!c || c.password !== body.password) return err(401, 'INVALID_CREDENTIALS')
        const token = `tok${++this.n}`
        this.sessions.set(token, c.ip)
        return ok({ session_token: token, expires_at: new Date(Date.now() + 3600e3).toISOString() })
      }
    }
    const me = auth()
    if (!me) return err(401, 'SESSION_INVALID')
    switch (path) {
      case '/realm/join':
        return ok({ joined: true, realm_address: this.realm })
      case '/realm/topic/subscribe':
        me.topics.add(body.topic)
        return ok({ subscribed: true })
      case '/realm/topic/publish': {
        let delivered = 0
        for (const c of this.clients.values()) {
          if (!c.topics.has(body.topic) || (c === me && body.include_self === false)) continue
          c.mailbox.push({
            mode: 'fast',
            message: { message_id: `m${++this.n}`, sender_ip: me.ip, recipient_ip: c.ip, content_type: 'event', expires_at: '' },
            content: { realm_address: body.realm_address, topic: body.topic, data: body.content },
          })
          delivered++
        }
        return ok({ topic: body.topic, subscribers: delivered, delivered, failed: [] })
      }
      case '/message/send': {
        const to = this.clients.get(body.recipient_ip)
        if (!to) return err(404, 'RECIPIENT_NOT_FOUND')
        if (JSON.stringify(body.content).length > 64 * 1024) return err(413, 'MESSAGE_TOO_LARGE')
        this.sentLog.push(body.content)
        to.mailbox.push({ mode: body.mode, message: { message_id: `m${++this.n}`, sender_ip: me.ip, recipient_ip: to.ip, content_type: 'direct', expires_at: '' }, content: body.content })
        return ok({ message_id: `m${this.n}`, state: 'sent' })
      }
      case '/message/poll': {
        const max = body.max_messages ?? 1
        const messages = me.mailbox.splice(0, max)
        return ok({ messages, count: messages.length })
      }
    }
    return err(404, 'NOT_FOUND')
  }
}
