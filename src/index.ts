/**
 * `@elves-ai/dsh-web-search-firecrawl`: registers a Firecrawl-backed `WebSearchProvider`
 * with `ctx.web`. A function/namespace plugin (NOT a default-export service):
 * a search provider does not own the `ctx.web` key — it registers INTO the
 * seam's provider registry.
 *
 * 0.2.0-rc.2 port: the Host settings surface is now `SettingsForms`
 * (volatile `Config` + `configForms.get(entryId)` on the client), so this
 * plugin no longer ships its own fenced `/firecrawl/api` route and no longer
 * embeds a DeepSeek fallback — it is a pure Firecrawl provider.
 *
 * @module @elves-ai/dsh-web-search-firecrawl
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
  FirecrawlSearchProvider,
  type FirecrawlSearchProviderOptions,
} from './provider.ts'

export {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
  FIRECRAWL_PROVIDER_ID,
  FirecrawlSearchProvider,
} from './provider.ts'
export type { FirecrawlSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-firecrawl'

/** The web seam this provider registers into. */
export const inject = ['web']

/**
 * Plugin config. Every field is `.volatile()`: the 0.2.0-rc.2 settings seam
 * projects volatile fields into live forms addressed by the profile entry id,
 * so the Settings page edits this entry directly — no custom namespace, no
 * custom route. The interface names the Volatile refs cordis resolves; the
 * schema below is the source of truth for optionality.
 */
export interface Config {
  /** Firecrawl API key literal; blank falls back to `$FIRECRAWL_API_KEY`. */
  apiKey: Volatile<string | undefined>
  /** Endpoint base; `/v1/search` is appended. */
  baseURL: Volatile<string | undefined>
  /** Default result count when a request carries no `maxResults`. */
  limit: Volatile<number | undefined>
  /** Upper bound on characters kept from one `description` when mapping `snippet`. */
  maxSnippetChars: Volatile<number>
}

export const Config = z.object({
  // `role('secret')` keeps the literal out of every settings response; the
  // page only learns whether a value is set.
  apiKey: z.string().role('secret').volatile(),
  baseURL: z.string().default(FIRECRAWL_DEFAULT_BASE_URL).volatile(),
  limit: z.number().step(1).min(1).volatile(),
  maxSnippetChars: z.number().step(1).min(1).default(FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS).volatile(),
})

/**
 * Resolve one live config snapshot into the options the already-registered
 * provider serves its next search with. A non-empty literal `apiKey` wins;
 * otherwise the provider keeps its `$FIRECRAWL_API_KEY` fallback.
 */
export function resolveFirecrawlOptions(
  ctx: Context,
  config: { apiKey?: string; baseURL?: string; limit?: number; maxSnippetChars?: number },
): FirecrawlSearchProviderOptions {
  const literalApiKey = typeof config.apiKey === 'string' && config.apiKey.trim().length > 0
    ? config.apiKey.trim()
    : ''
  const envApiKey = launchEnvironmentOf(ctx).get('FIRECRAWL_API_KEY')?.value ?? ''
  const baseURL = typeof config.baseURL === 'string' && config.baseURL.trim().length > 0
    ? config.baseURL.trim()
    : FIRECRAWL_DEFAULT_BASE_URL
  return {
    apiKey: literalApiKey.length > 0 ? literalApiKey : envApiKey,
    baseURL,
    maxSnippetChars: config.maxSnippetChars ?? FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
    ...config.limit !== undefined ? { limit: config.limit } : {},
  }
}

/** Register the Firecrawl search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  // The provider object is registered once; the thunk snapshots the volatile
  // refs per operation so a settings commit reaches the next search without a
  // re-registration or a restart.
  const provider = new FirecrawlSearchProvider(() => resolveFirecrawlOptions(ctx, {
    apiKey: config.apiKey.get(),
    baseURL: config.baseURL.get(),
    limit: config.limit.get(),
    maxSnippetChars: config.maxSnippetChars.get(),
  }))
  ctx.web.registerSearchProvider(provider)
}
