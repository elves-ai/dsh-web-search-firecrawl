/**
 * Wire types for the Firecrawl search API (`POST https://api.firecrawl.dev/v1/search`). Types
 * only — no runtime code. Firecrawl returns a flat `data[]`; each entry carries a URL, an
 * optional title, and an optional `description` (often a page-markdown excerpt rather than a
 * short sentence, so the provider bounds it before mapping to `snippet`).
 *
 * @module @pionai/dsh-web-search-firecrawl/types
 */

/** Request body sent to Firecrawl's search endpoint. */
export interface FirecrawlSearchRequest {
  query: string
  /** Firecrawl's result-count control; the seam still enforces the bound on return. */
  limit?: number
}

/** One entry of Firecrawl's flat `data[]`. */
export interface FirecrawlSearchDataItem {
  url: string
  title?: string | null
  description?: string | null
}

/** Firecrawl's search response envelope. */
export interface FirecrawlSearchResponse {
  /** Envelope outcome; absent or false is treated as failure by the provider. */
  success?: boolean
  data?: FirecrawlSearchDataItem[]
  /** Non-fatal warning text; ignored by the provider. */
  warning?: string | null
  /** Error detail present when `success` is false. */
  error?: string | null
}

/** Firecrawl's error response envelope (best-effort; fields vary by failure). */
export interface FirecrawlError {
  error?: string
  message?: string
}
