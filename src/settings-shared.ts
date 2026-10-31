/** Shared Firecrawl configuration literals; no Host runtime dependencies. */

/** User-settings namespace carrying the Firecrawl provider configuration. */
export const FIRECRAWL_SETTINGS_NAMESPACE = 'web-search-firecrawl'

/** Settings fields editable from the Firecrawl settings page. */
export const FIRECRAWL_SETTINGS_FIELDS = ['useFirecrawl', 'apiKey', 'baseURL', 'limit', 'maxSnippetChars'] as const

/** One editable Firecrawl settings field. */
export type FirecrawlSettingsField = typeof FIRECRAWL_SETTINGS_FIELDS[number]

/** Default Firecrawl API base; `/v1/search` is the operation. */
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev'

/** Default bound on one mapped `snippet`. */
export const FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS = 600

/**
 * User-facing Firecrawl provider settings. All fields are optional in the
 * composition entry; the host schema fills the defaults below.
 */
export interface FirecrawlSettings {
  /**
   * Route web searches through Firecrawl. When false, the already-registered
   * Firecrawl provider delegates to the original DeepSeek web-search provider
   * so the model keeps using the shipped search route.
   */
  useFirecrawl?: boolean
  /**
   * Firecrawl API key literal. Stored in the settings namespace with
   * `role('secret')`: it never rides a settings response; the settings page
   * only learns whether a value is set. Empty falls back to `$FIRECRAWL_API_KEY`.
   */
  apiKey?: string
  /** Endpoint base; `/v1/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  limit?: number
  /** Upper bound on characters kept from one `description` when mapping `snippet`. */
  maxSnippetChars?: number
}

/** Schema-default fallbacks used by the client before settings have loaded. */
export const FIRECRAWL_SETTINGS_DEFAULTS = {
  useFirecrawl: true,
  apiKey: '',
  baseURL: FIRECRAWL_DEFAULT_BASE_URL,
  maxSnippetChars: FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
} as const
