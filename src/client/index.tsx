/**
 * Client half of `@elves-ai/dsh-web-search-firecrawl`: contributes the
 * "Firecrawl" page to the DSH Settings shell. The page reads and writes the
 * plugin's settings namespace through the host-owned `/firecrawl/api` route
 * (the settings RPC allowlist does not serve third-party namespaces).
 */

// Type-only: the settings shell's SlotMap merge for 'settings.section'.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { FirecrawlSettingsSection } from './FirecrawlSettingsSection.tsx'

/** Required services before mounting. */
export const inject = ['slots']

/**
 * Register the Firecrawl settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'firecrawl',
    order: 80,
    label: () => 'Firecrawl',
  }, FirecrawlSettingsSection))
}
