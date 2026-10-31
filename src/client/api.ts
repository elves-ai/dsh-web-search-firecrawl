/** Firecrawl settings adapter over Harness's authenticated, typed Remote transport. */
import type { Context } from '@deepseek-ai/cordis'
import type {
  SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { FIRECRAWL_SETTINGS_NAMESPACE } from '../settings-shared.ts'

/** Redacted settings plus deployment writability. */
export type FirecrawlSettingsView = SettingsNamespaceView & { writable: boolean }
/** One path-addressed settings edit. */
export type FirecrawlSettingsOp = SettingsPathOpView
/** Only the supported settings operations are exposed to the page. */
export type FirecrawlSettingsRemote = Pick<Context['remote']['settings'], 'describe' | 'mutate'>
/** Page-facing adapter, supplied through slot injection. */
export interface FirecrawlSettingsApi {
  get(): Promise<FirecrawlSettingsView>
  mutate(ops: readonly FirecrawlSettingsOp[], expectedRevision?: number): Promise<FirecrawlSettingsView>
}

/** Typed Remote refusal mapped to page-level error handling. */
export class FirecrawlSettingsApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/**
 * Bind the settings Remote to the plugin's profile entry, without a separate HTTP endpoint.
 * @param remote - Authenticated settings namespace supplied by ctx.remote.
 * @returns Settings reader and revision-fenced writer for the custom page.
 */
export function createFirecrawlSettingsApi(remote: FirecrawlSettingsRemote): FirecrawlSettingsApi {
  let writable = false
  const get = async (): Promise<FirecrawlSettingsView> => {
    const result = await remote.describe()
    if (!result.ok) throw new FirecrawlSettingsApiError(result.error.code, result.error.message)
    const view = result.value.namespaces.find(row => row.ns === FIRECRAWL_SETTINGS_NAMESPACE)
    if (view === undefined) throw new FirecrawlSettingsApiError('settings-unavailable', 'Firecrawl 插件配置不可用。')
    writable = result.value.writable
    return { ...view, writable }
  }
  return {
    get,
    async mutate(ops, expectedRevision) {
      const result = await remote.mutate(FIRECRAWL_SETTINGS_NAMESPACE, [...ops], expectedRevision)
      if (!result.ok) throw new FirecrawlSettingsApiError(result.error.code, result.error.message)
      return { ...result.value, writable }
    },
  }
}

/**
 * Check whether the write-only API key is configured.
 * @param view - Redacted settings view.
 * @returns Whether the Host reports a configured key.
 */
export function isApiKeyConfigured(view: FirecrawlSettingsView): boolean {
  return view.secrets.some(secret => secret.path.length === 1 && secret.path[0] === 'apiKey' && secret.set)
}
