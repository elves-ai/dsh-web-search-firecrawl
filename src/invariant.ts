/** Deprecated companion entry retained for profiles created before Harness removed runtime invariants. */
import type { Context } from '@deepseek-ai/cordis'

/** Cordis companion plugin name. */
export const name = 'web-search-firecrawl-invariant'
/** No invariant service is required on current Harness releases. */
export const inject: string[] = []

/**
 * Keep legacy companion mounts loadable without the removed dsh-invariants package.
 * @param _ctx - Legacy companion context.
 * @returns An inert disposer.
 * @deprecated Remove this companion from the profile; the provider needs no companion.
 */
export const apply = (_ctx: Context): Promise<() => void> => Promise.resolve(() => {})
