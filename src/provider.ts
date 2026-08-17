/**
 * `FirecrawlSearchProvider`: a `WebSearchProvider` backed by the Firecrawl search API
 * (`POST /v1/search`). It maps `title` to `title` and the `description` excerpt (bounded by
 * `maxSnippetChars`) to `snippet`, keeps citeable URL-only entries when no description is
 * present, and omits `content` because Firecrawl returns no generated answer.
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
  /** Firecrawl API key. Empty/absent makes the provider unavailable. */
  apiKey: string
  /** Endpoint base; `/v1/search` is appended. */
  baseURL: string
  /** Default result count when a request carries no `maxResults`. */
  limit?: number
  /** Upper bound on characters kept from one `description` when mapping `snippet`. */
  maxSnippetChars: number
  /** Route searches through Firecrawl; false delegates to {@link fallback}. */
  useFirecrawl?: boolean
  /** Original web-search provider used when `useFirecrawl` is false. */
  fallback?: WebSearchProvider
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
 * Map a Firecrawl response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /v1/search` response body.
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
  const sources = (response.data ?? [])
    .map(item => mapFirecrawlResult(item, maxSnippetChars))
  // Firecrawl returns no generated answer, so `content` is omitted. The web service owns the
  // final `maxResults` truncation, so this provider reports `truncated: false`.
  return { sources, truncated: false }
}

/** The Firecrawl-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class FirecrawlSearchProvider implements WebSearchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  constructor(private options: FirecrawlSearchProviderOptions) {}

  /**
   * Replace the options used by the next `available()` / `search()` call.
   * The plugin host calls this when a settings-page commit resolves, so a
   * key or endpoint change reaches the already-registered provider without a
   * re-registration or a restart.
   */
  setOptions(options: FirecrawlSearchProviderOptions): void {
    this.options = options
  }

  available(): boolean {
    const options = this.options
    if (options.useFirecrawl === false) {
      return options.fallback?.available() ?? false
    }
    return options.apiKey.length > 0
      && isValidBaseUrl(options.baseURL)
      && isPositiveInteger(options.maxSnippetChars)
      && (options.limit === undefined || isPositiveInteger(options.limit))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.options
    if (options.useFirecrawl === false) {
      const fallback = options.fallback
      if (fallback === undefined) {
        throw new WebError('Firecrawl search is disabled and no fallback web-search provider is configured', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
      }
      return fallback.search(request, signal)
    }
    // A per-request bound wins over the configured default; either may be absent.
    const limit = request.maxResults ?? options.limit
    let response: Response
    try {
      response = await fetch(`${options.baseURL}/v1/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          query: request.query,
          ...limit !== undefined ? { limit } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Firecrawl search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Firecrawl search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
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
}

/* jscpd:ignore-start */
/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
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
