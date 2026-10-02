/**
 * `FirecrawlSearchProvider`: a `WebSearchProvider` backed by the Firecrawl search API
 * (`POST /v1/search`, with a `POST /v2/search` fallback for self-hosted
 * instances that only serve v2). It maps `title` to `title` and the
 * `description` excerpt (bounded by `maxSnippetChars`) to `snippet`, keeps
 * citeable URL-only entries when no description is present, and omits
 * `content` because Firecrawl returns no generated answer.
 * @module @elves-ai/dsh-web-search-firecrawl/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
} from './settings-shared.ts'
import type { FirecrawlError, FirecrawlSearchDataItem, FirecrawlSearchResponse } from './types.ts'

export {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
} from './settings-shared.ts'

/** Stable id this provider registers under. */
export const FIRECRAWL_PROVIDER_ID = 'firecrawl'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'dsh-web-search-firecrawl/0.1.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface FirecrawlSearchProviderOptions {
  /**
   * Firecrawl API key. Empty/absent is allowed: self-hosted instances running
   * with `USE_DB_AUTHENTICATION=false` accept keyless requests. The cloud API
   * still needs a key, so `available()` stays false without one unless the
   * base URL points at a loopback host.
   */
  apiKey: string
  /**
   * Endpoint base. `/v1/search` is tried first; a self-hosted instance that
   * answers 404 there is retried at `/v2/search` (whose `data.web[]` is also
   * accepted).
   */
  baseURL: string
  /** Default result count when a request carries no `maxResults`. */
  limit?: number
  /** Upper bound on characters kept from one `description` when mapping `snippet`. */
  maxSnippetChars: number
}

/**
 * Bound `text` to `max` characters. Firecrawl's `description` is frequently a long
 * page-markdown excerpt; the bound keeps one source's snippet from flooding model context
 * while preserving the excerpt's head.
 *
 * @param text - the excerpt to bound.
 * @param max - upper bound on the kept length.
 * @returns `text` unchanged when within the bound, else its first `max` characters.
 */
export function truncateTo(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

/**
 * Map one Firecrawl `data[]` entry to a normalized source. `description` is trimmed,
 * blank-checked, and bounded by `maxSnippetChars`; an entry without a non-blank description
 * still maps to a citeable URL-only source (the seam supports sources without snippets, as
 * Perplexity citations may be URL-only).
 *
 * @param item - one entry of Firecrawl's `data[]`.
 * @param maxSnippetChars - bound on the mapped snippet length.
 * @returns the normalized source.
 */
export function mapFirecrawlResult(item: FirecrawlSearchDataItem, maxSnippetChars: number): WebSearchSource {
  const description = item.description?.trim() ?? ''
  return {
    url: item.url,
    ...item.title != null && item.title.length > 0 ? { title: item.title } : {},
    ...description.length > 0 ? { snippet: truncateTo(description, maxSnippetChars) } : {},
  }
}

/**
 * Map a Firecrawl response envelope to a normalized search result. Accepts
 * both the v1 flat `data[]` and the v2 `data.web[]` shape.
 *
 * @param response - the parsed search response body.
 * @param maxSnippetChars - bound on one mapped snippet length.
 * @returns the normalized result.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when the envelope reports failure.
 */
export function mapFirecrawlResponse(response: FirecrawlSearchResponse, maxSnippetChars: number): WebSearchResult {
  if (!response.success) {
    const detail = response.error
    throw new WebError(
      detail != null && detail.length > 0 ? detail : 'Firecrawl search failed',
      'WEB_PROVIDER_ERROR',
    )
  }
  const data = response.data
  // Absent data = empty result (tolerated); a present-but-misshapen data is a
  // provider error rather than a silent empty.
  const items = data === undefined
    ? []
    : Array.isArray(data) ? data : (data != null && Array.isArray(data.web) ? data.web : undefined)
  if (items === undefined) {
    throw new WebError('Firecrawl returned an unprocessable response body: unexpected data shape', 'WEB_PROVIDER_ERROR')
  }
  const sources = items
    .map(item => mapFirecrawlResult(item, maxSnippetChars))
  // Firecrawl returns no generated answer, so `content` is omitted. The web service owns the
  // final `maxResults` truncation, so this provider reports `truncated: false`.
  return { sources, truncated: false }
}

/** The Firecrawl-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class FirecrawlSearchProvider implements WebSearchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two sections. A
   * thunk rather than a value because the plugin's volatile config can change
   * between searches, and re-registering the provider to carry a new endpoint
   * would make the seam's selection observable to the user as a flicker.
   */
  constructor(private readonly resolveOptions: () => FirecrawlSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    // Keyless loopback instances (self-hosted, USE_DB_AUTHENTICATION=false)
    // are usable without a key; anywhere else still requires one.
    const hasKey = options.apiKey.length > 0 || isLoopbackBaseUrl(options.baseURL)
    return hasKey
      && isValidBaseUrl(options.baseURL)
      && isPositiveInteger(options.maxSnippetChars)
      && (options.limit === undefined || isPositiveInteger(options.limit))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    // A per-request bound wins over the configured default; either may be absent.
    const limit = request.maxResults ?? options.limit
    const body = JSON.stringify({
      query: request.query,
      ...limit !== undefined ? { limit } : {},
    })
    // v1 first (cloud + self-hosted both serve it today); a 404 falls through
    // to v2 for self-hosted instances that only serve the new route.
    let response = await this.postSearch(options, '/v1/search', body, signal)
    if (response.status === 404) {
      response = await this.postSearch(options, '/v2/search', body, signal)
    }

    if (!response.ok) {
      const status = response.status
      let message = `Firecrawl API error (HTTP ${status})`
      try {
        const parsed = await response.json() as FirecrawlError
        const detail = parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('Firecrawl search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as FirecrawlSearchResponse
      return mapFirecrawlResponse(payload, options.maxSnippetChars)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Firecrawl search aborted', 'WEB_ABORTED', { cause: error })
      if (error instanceof WebError) throw error
      throw new WebError(`Firecrawl returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * POST one search operation. A keyless loopback instance sends no auth
   * header at all (self-hosted, `USE_DB_AUTHENTICATION=false`).
   */
  private async postSearch(
    options: FirecrawlSearchProviderOptions,
    path: '/v1/search' | '/v2/search',
    body: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      return await fetch(`${options.baseURL}${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          ...options.apiKey.length > 0 ? { 'authorization': `Bearer ${options.apiKey}` } : {},
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body,
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Firecrawl search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Firecrawl search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/* jscpd:ignore-start */
/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True when `baseURL` points at a loopback host (self-hosted, keyless use allowed). */
function isLoopbackBaseUrl(baseURL: string): boolean {
  let hostname = ''
  try {
    hostname = new URL(baseURL).hostname.toLowerCase()
  } catch {
    return false
  }
  if (hostname === 'localhost') return true
  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1)
  if (hostname === '::1') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** True for a request limit that can be sent to Firecrawl (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
/* jscpd:ignore-end */
