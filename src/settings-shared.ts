/**
 * Shared "Firecrawl configuration" vocabulary (types + constants), consumed by
 * BOTH halves: the host registers a settings namespace with a schemastery
 * schema over these values, and the settings page in the browser edits them
 * through the plugin's own fenced `/firecrawl/api` route. Kept free of
 * schemastery and `@deepseek-ai/dsh-settings` so the browser bundle never
 * pulls the host-only settings runtime in.
 * @module @elves-ai/dsh-web-search-firecrawl/settings-shared
 */

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

/** Schema-default fallbacks used by the client while the settings route is unavailable. */
export const FIRECRAWL_SETTINGS_DEFAULTS = {
  useFirecrawl: true,
  apiKey: '',
  baseURL: FIRECRAWL_DEFAULT_BASE_URL,
  maxSnippetChars: FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
} as const
