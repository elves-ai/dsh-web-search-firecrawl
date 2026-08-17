/**
 * `@elves-ai/dsh-web-search-firecrawl`: registers a Firecrawl-backed `WebSearchProvider`
 * with `ctx.web`. A function/namespace plugin (NOT a default-export service):
 * a search provider does not own the `ctx.web` key — it registers INTO the
 * seam's provider registry, exactly as `@deepseek-ai/dsh-llm-deepseek`
 * registers an adapter into `ctx.llm`. The key is owned by `@deepseek-ai/dsh-web`.
 *
 * The provider's user-facing configuration lives in the DSH Settings page
 * ("Firecrawl" section). The host registers the `web-search-firecrawl`
 * settings namespace with the settings seam; the browser half edits it
 * through the plugin's own fenced `/firecrawl/api` route. Environment and
 * bundle-entry values remain available as fallback/composition layers.
 *
 * @module @elves-ai/dsh-web-search-firecrawl
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { createDeepSeekSearchProvider } from './deepseek-provider.ts'
import {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
  FirecrawlSearchProvider,
  type FirecrawlSearchProviderOptions,
} from './provider.ts'
import { registerFirecrawlSettingsRoutes } from './settings-routes.ts'
import {
  FIRECRAWL_SETTINGS_NAMESPACE,
  type FirecrawlSettings,
} from './settings-shared.ts'

export {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
  FIRECRAWL_PROVIDER_ID,
  FirecrawlSearchProvider,
} from './provider.ts'
export type { FirecrawlSearchProviderOptions } from './provider.ts'
export { FIRECRAWL_SETTINGS_NAMESPACE } from './settings-shared.ts'
export type { FirecrawlSettings } from './settings-shared.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-firecrawl'

/** The web seam this provider registers into. */
export const inject = ['web']

/**
 * Plugin config (all optional — `apply` fills env-var and constant defaults).
 * This same shape is registered as the `web-search-firecrawl` settings
 * namespace, so these values are also the composition/base layer under the
 * Firecrawl settings page.
 */
export type Config = FirecrawlSettings

export const Config: z<Config> = z.object({
  // Settings-page master switch: off delegates the configured `firecrawl`
  // provider to the original DeepSeek search route.
  useFirecrawl: z.boolean().default(true),
  // The settings page edits this write-only: `role('secret')` keeps the
  // literal out of every settings response. `describe({ redactSecrets: true })`
  // reports only whether a value is configured.
  apiKey: z.string().role('secret'),
  baseURL: z.string().default(FIRECRAWL_DEFAULT_BASE_URL),
  limit: z.number().step(1).min(1),
  maxSnippetChars: z.number().step(1).min(1).default(FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS),
})

/**
 * Resolve one settings section into the options the already-registered
 * provider serves its next search with. A non-empty settings `apiKey` wins;
 * otherwise the provider keeps its historical `$FIRECRAWL_API_KEY` fallback.
 */
export function resolveFirecrawlOptions(ctx: Context, config: Config): FirecrawlSearchProviderOptions {
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
    useFirecrawl: config.useFirecrawl ?? true,
    ...config.limit !== undefined ? { limit: config.limit } : {},
  }
}

/** Register the Firecrawl search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config = {}): void {
  let current: () => Config = () => config

  // The provider object is registered once; settings commits mutate its
  // options in place, so `ctx.web` selection never flickers or needs a
  // re-registration when the user saves the settings page.
  // The fallback carries the ORIGINAL DeepSeek search implementation. While
  // `useFirecrawl` is off, the registered `firecrawl` provider delegates to
  // it, so the model continues using the shipped search route and the
  // settings-page switch works live (no restart or bundle re-composition).
  const deepSeekProvider = createDeepSeekSearchProvider(ctx)
  const providerOptions = (): FirecrawlSearchProviderOptions => ({
    ...resolveFirecrawlOptions(ctx, current()),
    fallback: deepSeekProvider,
  })
  const provider = new FirecrawlSearchProvider(providerOptions())
  ctx.web.registerSearchProvider(provider)

  // Canonical optional-settings wiring: while the settings service is
  // mounted, register the namespace with the bundle/profile entry as its
  // base layer and point the source thunk at the resolved scope. A settings
  // commit reaches the next search; without the service the composition
  // entry keeps working exactly as before.
  installSettingsSection(ctx, settingsNamespace(FIRECRAWL_SETTINGS_NAMESPACE), Config, config, {
    setSource: (source) => { current = source },
    onChange: () => { provider.setOptions(providerOptions()) },
  })

  // The browser settings page reaches this namespace through the plugin's
  // own fenced route (the settings RPC domain only serves allowlisted
  // namespaces). Optional: the provider stays available in webless
  // deployments, where the settings page has no route to call.
  registerFirecrawlSettingsRoutes(ctx)
}
