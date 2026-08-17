/**
 * Fenced `/firecrawl/api` route for the Firecrawl settings page. The DSH
 * settings RPC domain only serves an allowlist of product-owned namespaces,
 * so a third-party plugin cannot read or write its own namespace through
 * `ctx.settingsScope`. This route reaches the settings seam in-process from
 * the plugin's own webserver route, gated by the same browser-trust fence as
 * the /api gateway (Host-header loopback or a configured trusted host; no
 * cross-site browser markers).
 * @module @elves-ai/dsh-web-search-firecrawl/settings-routes
 */

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  SettingsConflictError,
  settingsNamespace,
  type SettingsNamespace,
  type SettingsPathOp,
  type SettingsProvider,
} from '@deepseek-ai/dsh-settings'
import {
  FIRECRAWL_SETTINGS_FIELDS,
  FIRECRAWL_SETTINGS_NAMESPACE,
} from './settings-shared.ts'

/** Structural webServer face (mirror of `@deepseek-ai/dsh-host-webserver`). */
export interface FirecrawlWebServer {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Structural webRuntime face (the bind-derived trusted host list). */
export interface FirecrawlWebRuntime {
  trustedHosts: readonly string[]
}

/** One redacted secret slot as returned by `settings.describe({ redactSecrets: true })`. */
export interface FirecrawlSettingsSecretView {
  path: string[]
  set: boolean
}

/** Redacted settings view served to the Firecrawl settings page. */
export interface FirecrawlSettingsView {
  value: unknown
  revision: number
  base?: unknown
  user?: unknown
  applies: 'live' | 'restart'
  secrets: FirecrawlSettingsSecretView[]
  writable: boolean
}

/** One path-addressed settings edit accepted by `settings.mutate`. */
export type FirecrawlSettingsOp = SettingsPathOp

/** Wire failure envelope of the Firecrawl settings route. */
export interface FirecrawlSettingsRouteErrorBody {
  code: 'bad-request' | 'method-error' | 'not-found' | 'forbidden' | 'settings-rejected' | 'settings-conflict' | 'internal'
  message: string
}

/** Route-level error with an HTTP status and a stable machine code. */
export class FirecrawlSettingsRouteError extends Error {
  constructor(
    readonly code: FirecrawlSettingsRouteErrorBody['code'],
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

const NAMESPACE: SettingsNamespace = settingsNamespace(FIRECRAWL_SETTINGS_NAMESPACE)
const ALLOWED_FIELDS = new Set<string>(FIRECRAWL_SETTINGS_FIELDS)
const MAX_BODY_BYTES = 1 << 20
const ROUTE_PATH = '/firecrawl/api'

/** Read and parse a bounded JSON request body. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) {
      throw new FirecrawlSettingsRouteError('bad-request', 'request body too large')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new FirecrawlSettingsRouteError('bad-request', 'request body is not valid JSON')
  }
}

/** Write one JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** Write the success envelope. */
function writeOk(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

/** Write a failure envelope for any thrown value. */
function writeError(res: ServerResponse, error: unknown): void {
  if (error instanceof FirecrawlSettingsRouteError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message } })
}

/** True for a plain object patch/payload. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** True for a positive whole number (request limit / snippet bound). */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** Validate one top-level settings path op against the Firecrawl schema. */
function validateOp(op: unknown): asserts op is SettingsPathOp {
  if (!isPlainObject(op) || op.op !== 'set' && op.op !== 'unset') {
    throw new FirecrawlSettingsRouteError('bad-request', 'each op must be { op: "set" | "unset", path: [field] }')
  }
  const path = op.path
  if (!Array.isArray(path) || path.length !== 1 || typeof path[0] !== 'string' || !ALLOWED_FIELDS.has(path[0])) {
    throw new FirecrawlSettingsRouteError('bad-request', `settings field must be one of: ${FIRECRAWL_SETTINGS_FIELDS.join(', ')}`)
  }
  if (op.op === 'set') {
    const field = path[0] as typeof FIRECRAWL_SETTINGS_FIELDS[number]
    const value = op.value
    if (field === 'useFirecrawl') {
      if (typeof value !== 'boolean') throw new FirecrawlSettingsRouteError('bad-request', '"useFirecrawl" must be a boolean')
    } else if (field === 'apiKey' || field === 'baseURL') {
      if (typeof value !== 'string') throw new FirecrawlSettingsRouteError('bad-request', `"${field}" must be a string`)
    } else if (!isPositiveInteger(value)) {
      throw new FirecrawlSettingsRouteError('bad-request', `"${field}" must be a positive integer`)
    }
  }
}

/** The current redacted view of the Firecrawl settings namespace. */
function viewOf(settings: SettingsProvider): FirecrawlSettingsView | undefined {
  const descriptor = settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === NAMESPACE)
  if (descriptor === undefined) return undefined
  return {
    value: descriptor.value,
    revision: descriptor.revision,
    ...descriptor.base === undefined ? {} : { base: descriptor.base },
    ...descriptor.user === undefined ? {} : { user: descriptor.user },
    applies: descriptor.applies,
    secrets: descriptor.secrets ?? [],
    writable: settings.writable,
  }
}

/** Require the settings service and the registered namespace, then return the view. */
function requireView(ctx: Context): FirecrawlSettingsView {
  const settings = ctx.get('settings') as SettingsProvider | undefined
  if (settings === undefined) {
    throw new FirecrawlSettingsRouteError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
  }
  const view = viewOf(settings)
  if (view === undefined) {
    throw new FirecrawlSettingsRouteError('settings-rejected', 'the Firecrawl settings namespace is not registered', 503)
  }
  return view
}

/** Dispatch one API method. */
async function dispatch(ctx: Context, method: unknown, payload: unknown): Promise<unknown> {
  switch (method) {
    case 'settings.get': return requireView(ctx)
    case 'settings.mutate': {
      if (!isPlainObject(payload)) throw new FirecrawlSettingsRouteError('bad-request', 'payload must be an object')
      const ops = payload.ops
      if (!Array.isArray(ops) || ops.length === 0) {
        throw new FirecrawlSettingsRouteError('bad-request', 'ops must be a non-empty array')
      }
      for (const op of ops) validateOp(op)
      const expectedRevision = typeof payload.expectedRevision === 'number' ? payload.expectedRevision : undefined
      const settings = ctx.get('settings') as SettingsProvider | undefined
      if (settings === undefined) {
        throw new FirecrawlSettingsRouteError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      try {
        await settings.mutate(NAMESPACE, ops as SettingsPathOp[], expectedRevision)
      } catch (error) {
        if (isSettingsConflict(error)) {
          throw new FirecrawlSettingsRouteError('settings-conflict', error.message, 409)
        }
        throw new FirecrawlSettingsRouteError('settings-rejected', error instanceof Error ? error.message : String(error))
      }
      const view = viewOf(settings)
      if (view === undefined) throw new FirecrawlSettingsRouteError('settings-rejected', 'the Firecrawl settings namespace was disposed after the write', 503)
      return view
    }
    default:
      throw new FirecrawlSettingsRouteError('not-found', `unknown Firecrawl settings method "${String(method)}"`, 404)
  }
}

/** True for the settings seam's stale-revision refusal. */
function isSettingsConflict(error: unknown): error is SettingsConflictError {
  return error instanceof SettingsConflictError
    || (error !== null && typeof error === 'object' && (error as { code?: unknown }).code === 'SETTINGS_CONFLICT')
}

/**
 * Register `/firecrawl/api` while `webServer` and `webRuntime` are mounted.
 * The optional-inject shape keeps the search provider usable in deployments
 * without a web server (the settings page simply cannot reach its route).
 */
export function registerFirecrawlSettingsRoutes(ctx: Context): void {
  ctx.inject(['webServer', 'webRuntime'], (routeCtx) => {
    const webServer = routeCtx.get('webServer') as FirecrawlWebServer
    const webRuntime = routeCtx.get('webRuntime') as FirecrawlWebRuntime
    routeCtx.effect(() => webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req, res) => {
        if (!isTrustedApiRequest(req.headers, webRuntime.trustedHosts)) {
          writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
          return
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
          return
        }
        try {
          const payload = await readJsonBody(req)
          const record = isPlainObject(payload) ? payload : {}
          writeOk(res, await dispatch(ctx, record.method, record.payload))
        } catch (error) {
          writeError(res, error)
        }
      },
    }), 'web-search-firecrawl: /firecrawl/api settings route')
  })
}

// ── Browser-trust fence (same policy as the /api gateway) ──────────────────

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/** Whether a normalized URL hostname names the local loopback authority. */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/** True when the browser request comes from the DSH host itself. */
export function isTrustedApiRequest(headers: IncomingHttpHeaders, trustedHosts: readonly string[]): boolean {
  const host = header(headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
