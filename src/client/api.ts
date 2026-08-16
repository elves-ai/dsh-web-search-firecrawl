/**
 * Client wire face for the plugin's own `/firecrawl/api` route. The host
 * calls the settings seam in-process, so the browser never depends on the
 * api-proxy allowlist that would otherwise keep third-party namespaces out.
 * @module @pionai/dsh-web-search-firecrawl/client/api
 */

/** One redacted secret slot (`set` tells whether a value is configured). */
export interface FirecrawlSettingsSecretView {
  path: string[]
  set: boolean
}

/** Redacted settings view returned by `settings.get` / `settings.mutate`. */
export interface FirecrawlSettingsView {
  value: unknown
  revision: number
  base?: unknown
  user?: unknown
  applies: 'live' | 'restart'
  secrets?: FirecrawlSettingsSecretView[]
  writable: boolean
}

/** One path-addressed settings edit sent to the host route. */
export type FirecrawlSettingsOp =
  | { op: 'set'; path: [string]; value: unknown }
  | { op: 'unset'; path: [string] }

/** Success envelope of the Firecrawl settings route. */
interface FirecrawlSettingsEnvelope {
  ok: true
  value: FirecrawlSettingsView
}

/** Failure envelope of the Firecrawl settings route. */
interface FirecrawlSettingsFailure {
  ok: false
  error: { code: string; message: string }
}

/** Wire error with the route's machine code. */
export class FirecrawlSettingsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** POST one method to `/firecrawl/api` and unwrap the success envelope. */
async function post<T>(method: string, payload?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch('/firecrawl/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, payload: payload ?? {} }),
    })
  } catch (error) {
    throw new FirecrawlSettingsApiError('unreachable', `无法连接 Firecrawl 设置接口：${error instanceof Error ? error.message : String(error)}`)
  }
  let body: FirecrawlSettingsEnvelope | FirecrawlSettingsFailure
  try {
    body = await response.json() as FirecrawlSettingsEnvelope | FirecrawlSettingsFailure
  } catch {
    throw new FirecrawlSettingsApiError('unreachable', `Firecrawl 设置接口返回了无法解析的响应（HTTP ${response.status}）`)
  }
  if (!response.ok || !body.ok) {
    const failure = body as FirecrawlSettingsFailure
    throw new FirecrawlSettingsApiError(failure.error?.code ?? 'unreachable', failure.error?.message ?? `HTTP ${response.status}`)
  }
  return (body as FirecrawlSettingsEnvelope).value as T
}

/** Read the current redacted Firecrawl settings view. */
export function getFirecrawlSettings(): Promise<FirecrawlSettingsView> {
  return post<FirecrawlSettingsView>('settings.get')
}

/** Apply path ops and return the fresh redacted view. */
export function mutateFirecrawlSettings(
  ops: readonly FirecrawlSettingsOp[],
  expectedRevision?: number,
): Promise<FirecrawlSettingsView> {
  return post<FirecrawlSettingsView>('settings.mutate', {
    ops,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  })
}

/** True when the write-only `apiKey` slot currently holds a value. */
export function isApiKeyConfigured(view: FirecrawlSettingsView): boolean {
  return (view.secrets ?? []).some(secret => secret.path.length === 1 && secret.path[0] === 'apiKey' && secret.set)
}
