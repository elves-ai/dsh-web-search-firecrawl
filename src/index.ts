/** Firecrawl search provider and its live, schema-derived Harness settings. */
import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { createDeepSeekSearchProvider } from './deepseek-provider.ts'
import {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
  FirecrawlSearchProvider,
  type FirecrawlSearchProviderOptions,
} from './provider.ts'
import { configureFirecrawlSettings } from './settings-routes.ts'
import type { FirecrawlSettings } from './settings-shared.ts'

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
/** The web service this provider registers into. */
export const inject = ['web']

/** Editable fields are volatile so profile edits update the running provider. */
export const Config = z.object({
  useFirecrawl: z.boolean().default(true).volatile(),
  apiKey: z.string().role('secret').volatile(),
  baseURL: z.string().default(FIRECRAWL_DEFAULT_BASE_URL).volatile(),
  limit: z.number().step(1).min(1).volatile(),
  maxSnippetChars: z.number().step(1).min(1).default(FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS).volatile(),
})

/** Resolved Cordis configuration, containing live references rather than literals. */
export type Config = ReturnType<typeof Config>

/**
 * Resolve settings literals into one operation's options.
 * @param ctx - Context supplying the launch environment.
 * @param config - Current settings values; a non-blank key overrides the environment.
 * @returns Defaulted provider options.
 */
export function resolveFirecrawlOptions(ctx: Context, config: FirecrawlSettings): FirecrawlSearchProviderOptions {
  const literalApiKey = config.apiKey?.trim() ?? ''
  const envApiKey = launchEnvironmentOf(ctx).get('FIRECRAWL_API_KEY')?.value ?? ''
  return {
    apiKey: literalApiKey.length > 0 ? literalApiKey : envApiKey,
    baseURL: config.baseURL?.trim() || FIRECRAWL_DEFAULT_BASE_URL,
    maxSnippetChars: config.maxSnippetChars ?? FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
    useFirecrawl: config.useFirecrawl ?? true,
    ...config.limit !== undefined ? { limit: config.limit } : {},
  }
}

/**
 * Register the provider once; each operation reads the latest volatile values.
 * @param ctx - Plugin context with the web service.
 * @param config - Schema-resolved live configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const fallback = createDeepSeekSearchProvider(ctx)
  ctx.web.registerSearchProvider(new FirecrawlSearchProvider(() => ({
    ...resolveFirecrawlOptions(ctx, {
      useFirecrawl: config.useFirecrawl.get(),
      apiKey: config.apiKey.get(),
      baseURL: config.baseURL.get(),
      limit: config.limit.get(),
      maxSnippetChars: config.maxSnippetChars.get(),
    }),
    fallback,
  })))
  configureFirecrawlSettings(ctx)
}
