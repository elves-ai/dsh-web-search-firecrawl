/** Settings presentation policy; transport is owned by Harness's authenticated Remote API. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'

/**
 * Suppress the generated form because the browser plugin supplies a custom page.
 * No standalone HTTP route is registered: settings.describe/mutate now serve plugin entries.
 * @param ctx - The provider's owning plugin context.
 */
export function configureFirecrawlSettings(ctx: Context): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
