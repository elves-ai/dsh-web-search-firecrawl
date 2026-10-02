/**
 * Client half of `@elves-ai/dsh-web-search-firecrawl`: contributes the
 * "Firecrawl" page to the DSH Settings shell.
 *
 * 0.2.0-rc.2 port: the old fenced `/firecrawl/api` route is gone. The shared
 * entry form is resolved in `apply` and handed to the section through the
 * slot inject face as the `form` prop — the component subscribes with
 * `useSyncExternalStore`, so the page renders as soon as the mirror answers
 * instead of stalling on "loading".
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { FirecrawlSettingsSection } from './FirecrawlSettingsSection.tsx'

/** Host plugin entry id owning this form (the profile row id). */
export const FIRECRAWL_ENTRY_ID = 'web-search-firecrawl'

/** Required services before mounting. */
export const inject = ['slots', 'configForms']

/**
 * Register the Firecrawl settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context & {
  slots: {
    register(options: object, component: unknown): () => void
  }
  configForms: {
    get<T>(entryId: string): ConfigForm<T>
    whileServed: (namespaces: readonly string[], register: () => () => void) => () => void
  }
}): void {
  // Resolve the shared entry form once; the section subscribes to its
  // snapshot and writes through its queue. `whileServed` keeps the page
  // hidden when the Host does not serve this entry.
  const form = ctx.configForms.get<Record<string, unknown>>(FIRECRAWL_ENTRY_ID)
  ctx.effect(() => ctx.configForms.whileServed([FIRECRAWL_ENTRY_ID], () => ctx.slots.register({
    name: 'settings.section',
    id: 'firecrawl',
    order: 80,
    label: () => 'Firecrawl',
    inject: () => ({ form }),
  }, FirecrawlSettingsSection)), 'web-search-firecrawl: settings section')
}
