/**
 * Client wire face for the Firecrawl settings form.
 *
 * 0.2.0-rc.2 port: the old fenced `/firecrawl/api` route is gone. The page
 * reads and writes through the shared `configForms` service, addressed by
 * this plugin's profile entry id. Secret detection reads the shared describe
 * mirror instead of a custom route envelope.
 */

import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-settings/types'

/** One path-addressed settings edit sent through `ConfigForm.mutate`. */
export type FirecrawlSettingsOp =
  | { op: 'set'; path: [string]; value: unknown }
  | { op: 'unset'; path: [string] }

/** Redacted settings snapshot the page renders from. */
export type FirecrawlSettingsView = ConfigFormSnapshot<Record<string, unknown>>

/** True when the write-only `apiKey` slot currently holds a value. */
export function isApiKeyConfigured(
  view: FirecrawlSettingsView,
  mirror: { namespace(ns: string): SettingsNamespaceView | undefined },
  entryId: string,
): boolean {
  const row = mirror.namespace(entryId)
  return (row?.secrets ?? []).some(secret => secret.path.length === 1 && secret.path[0] === 'apiKey' && secret.set)
}
