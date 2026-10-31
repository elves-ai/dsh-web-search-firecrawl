/** Embedded official DeepSeek search implementation used when Firecrawl is disabled. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import {
  DeepSeekSearchProvider,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
  type Config as DeepSeekConfig,
  type DeepSeekSearchProviderOptions,
} from '@deepseek-ai/dsh-web-search-deepseek'

/** Plain values projected by the official provider's volatile Config schema. */
type DeepSeekSettings = { [K in keyof DeepSeekConfig]?: ReturnType<DeepSeekConfig[K]['get']> }

/** Read the current official provider entry, without redacting its in-process credentials. */
function readDeepSeekConfig(ctx: Context): DeepSeekSettings {
  const section = ctx.get('settings')?.describe().find(row => row.ns === 'web-search-deepseek')?.value
  return section === undefined ? {} : section as DeepSeekSettings
}

/** Resolve credentials, account routing, and current official provider settings per operation. */
function resolveDeepSeekOptions(ctx: Context): DeepSeekSearchProviderOptions {
  const config = readDeepSeekConfig(ctx)
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? 'DEEPSEEK_API_KEY')
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveAccountToken: async (endpoint) => {
      const provider = ctx.get('agents')?.currentInitiator()?.session.requestContext()?.provider
      if (provider !== 'deepseek-account') return undefined
      return ctx.get('deepseekAccount')?.resolveToken(endpoint)
    },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get('DEEPSEEK_SEARCH_BASE_URL')?.value
      ?? DEEPSEEK_DEFAULT_BASE_URL,
    model: config.model ?? DEEPSEEK_DEFAULT_MODEL,
    apiVersion: config.apiVersion ?? DEEPSEEK_DEFAULT_API_VERSION,
    maxTokens: config.maxTokens ?? DEEPSEEK_DEFAULT_MAX_TOKENS,
    maxUses: config.maxUses ?? DEEPSEEK_DEFAULT_MAX_USES,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append('web/deepseek-search-llm-request', request)
    },
  }
}

/**
 * Create the fallback with the official account authentication and request logging hooks.
 * @param ctx - Plugin context supplying settings, credentials, and the initiating Session.
 * @returns A DeepSeek-backed search provider resolving options for each operation.
 */
export function createDeepSeekSearchProvider(ctx: Context): DeepSeekSearchProvider {
  return new DeepSeekSearchProvider(() => resolveDeepSeekOptions(ctx))
}
