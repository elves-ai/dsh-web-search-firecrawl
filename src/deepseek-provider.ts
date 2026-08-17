/**
 * Embedded fallback to the original DeepSeek web-search provider.
 *
 * The Firecrawl plugin is mounted as the configured `web.searchProvider`
 * (`firecrawl`). A settings-page switch can turn Firecrawl off; instead of
 * making the configured provider unavailable (which would fail every search),
 * the Firecrawl provider delegates to this DeepSeekSearchProvider instance —
 * the same implementation the shipped `web-search-deepseek` row registers.
 * Its endpoint/model/limits resolve from the official `web-search-deepseek`
 * settings namespace when that row is mounted, so the switch behaves like the
 * original provider, not a simplified copy.
 * @module @elves-ai/dsh-web-search-firecrawl/deepseek-provider
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
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

const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
const SEARCH_BASE_URL_ENV = 'DEEPSEEK_SEARCH_BASE_URL'
const DEEPSEEK_SETTINGS_NAMESPACE: SettingsNamespace = settingsNamespace('web-search-deepseek')

/** Credential-resolution face of `ctx.credentials` (the seam itself is optional). */
interface CredentialFace {
  resolve(ref: CredentialRef): Promise<{ value: string } | undefined>
}

/** Read the original provider's resolved settings section, when it is mounted. */
function readDeepSeekConfig(ctx: Context): DeepSeekConfig | undefined {
  const settings = ctx.get('settings') as { get(ns: SettingsNamespace): unknown } | undefined
  const section = settings?.get(DEEPSEEK_SETTINGS_NAMESPACE)
  return section !== null && typeof section === 'object' ? section as DeepSeekConfig : undefined
}

/** Resolve options for the original DeepSeek search provider. */
function resolveDeepSeekOptions(ctx: Context): DeepSeekSearchProviderOptions {
  const config = readDeepSeekConfig(ctx) ?? {}
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = typeof config.apiKey === 'string' && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  const credentials = ctx.get('credentials') as CredentialFace | undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      if (credentials !== undefined) {
        const resolved = await credentials.resolve(apiKeyEnv)
        if (resolved !== undefined && resolved.value.length > 0) return resolved.value
      }
      // Without the credentials seam the environment is the credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value
      ?? DEEPSEEK_DEFAULT_BASE_URL,
    model: config.model ?? DEEPSEEK_DEFAULT_MODEL,
    apiVersion: config.apiVersion ?? DEEPSEEK_DEFAULT_API_VERSION,
    maxTokens: config.maxTokens ?? DEEPSEEK_DEFAULT_MAX_TOKENS,
    maxUses: config.maxUses ?? DEEPSEEK_DEFAULT_MAX_USES,
  }
}

/**
 * Create the fallback provider used while the settings-page switch is off.
 * @param ctx - plugin context (resolves settings/credentials/env per search).
 * @returns a DeepSeek-backed `WebSearchProvider`.
 */
export function createDeepSeekSearchProvider(ctx: Context): DeepSeekSearchProvider {
  return new DeepSeekSearchProvider(() => resolveDeepSeekOptions(ctx))
}
