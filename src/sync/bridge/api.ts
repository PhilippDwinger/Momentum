/**
 * Thin client for the Bridge 3 HTTP API (see Bridge README). Only the endpoints Momentum needs.
 * In the browser the base URL is the same-origin proxy of the Momentum-Host (`./bridge`),
 * because Bridge does not send CORS headers.
 */

export class BridgeError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'BridgeError'
    this.status = status
    this.code = code
  }
}

export interface PolledMessage {
  mode: string
  message: { message_id: string; sender_ip: string; content_type: string; expires_at: string }
  content?: unknown
  pending_id?: string
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class BridgeApi {
  readonly base: string
  private readonly fetchImpl: FetchLike

  constructor(base: string, fetchImpl?: FetchLike) {
    this.base = base.replace(/\/+$/, '')
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init))
  }

  private async call<T>(path: string, body?: Record<string, unknown>, timeoutMs = 40_000): Promise<T> {
    let res: Response
    try {
      res = await this.fetchImpl(this.base + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      throw new BridgeError(0, 'NETWORK', e instanceof Error ? e.message : String(e))
    }
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const d = (data as { detail?: { error?: string; message?: string } } | null)?.detail
      throw new BridgeError(res.status, d?.error ?? `HTTP_${res.status}`, d?.message ?? res.statusText)
    }
    return data as T
  }

  status() {
    return this.call<{ status: string; ready: boolean; url: string; public_realm_address?: string }>('/server/status')
  }
  register(name: string, password: string, identitySecret: string) {
    return this.call<{ client_ip: string }>('/client/register', { name, password, identity_secret: identitySecret })
  }
  login(clientIp: string, password: string) {
    return this.call<{ session_token: string; expires_at: string }>('/client/login', { client_ip: clientIp, password })
  }
  publicRealm() {
    return this.call<{ realm_address: string }>('/realm/public')
  }
  join(token: string, realm: string) {
    return this.call('/realm/join', { session_token: token, realm_address: realm })
  }
  subscribe(token: string, realm: string, topic: string) {
    return this.call('/realm/topic/subscribe', { session_token: token, realm_address: realm, topic })
  }
  publish(token: string, realm: string, topic: string, content: unknown) {
    return this.call('/realm/topic/publish', { session_token: token, realm_address: realm, topic, content, include_self: false })
  }
  send(token: string, recipientIp: string, content: unknown, lifetimeSeconds: number) {
    return this.call<{ message_id: string; state: string }>('/message/send', {
      session_token: token,
      recipient_ip: recipientIp,
      content,
      mode: 'temporary',
      expires_in_seconds: Math.max(60, Math.min(7 * 24 * 3600, Math.round(lifetimeSeconds))),
    })
  }
  async poll(token: string, waitSeconds: number, maxMessages = 50): Promise<PolledMessage[]> {
    const r = await this.call<{ messages?: PolledMessage[] }>(
      '/message/poll',
      { session_token: token, wait_seconds: waitSeconds, max_messages: maxMessages, content_types: ['event', 'direct'] },
      (waitSeconds + 20) * 1000,
    )
    return r.messages ?? []
  }
}
