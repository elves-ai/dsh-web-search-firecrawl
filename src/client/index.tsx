/** Browser plugin contributing Firecrawl configuration to its plugin details. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { FirecrawlSettingsSection } from './FirecrawlSettingsSection.tsx'
import { createFirecrawlSettingsApi } from './api.ts'

/** Required services before mounting. */
export const inject = ['slots', 'remote', 'remote.settings']

/**
 * Register configuration inside the Firecrawl bundle detail page.
 * @param ctx - Browser plugin context supplying the renderer and Remote settings.
 */
export function apply(ctx: Context): void {
  const settingsApi = createFirecrawlSettingsApi(ctx.remote.settings)
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: '@elves-ai/dsh-web-search-firecrawl',
    inject: () => ({ settingsApi }),
  }, FirecrawlSettingsSection))
}
