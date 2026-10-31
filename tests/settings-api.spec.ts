import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  createFirecrawlSettingsApi,
  isApiKeyConfigured,
  type FirecrawlSettingsRemote,
} from '../src/client/api.ts'

const namespace: SettingsNamespaceView = {
  ns: 'web-search-firecrawl', autoGenerate: false, schema: {},
  value: { useFirecrawl: true }, revision: 3, applies: 'live',
  secrets: [{ path: ['apiKey'], set: true }],
}

function remoteFixture() {
  const describeSettings = vi.fn<FirecrawlSettingsRemote['describe']>(async () => ({
    ok: true, value: { writable: true, hasDocument: true, namespaces: [namespace] },
  }))
  const mutate = vi.fn<FirecrawlSettingsRemote['mutate']>(async () => ({
    ok: true, value: { ...namespace, revision: 4, secrets: [{ path: ['apiKey'], set: false }] },
  }))
  return { remote: { describe: describeSettings, mutate }, describeSettings, mutate }
}

describe('authenticated Remote settings adapter', () => {
  it('reads the plugin entry and its redacted key status', async () => {
    const { remote } = remoteFixture()
    const view = await createFirecrawlSettingsApi(remote).get()
    expect(view.writable).toBe(true)
    expect(view.value).not.toHaveProperty('apiKey')
    expect(isApiKeyConfigured(view)).toBe(true)
  })

  it('writes only named fields with the read revision and uses the mutation answer', async () => {
    const { remote, mutate, describeSettings } = remoteFixture()
    const api = createFirecrawlSettingsApi(remote)
    const initial = await api.get()
    const ops = [{ op: 'unset' as const, path: ['apiKey'] }]
    const next = await api.mutate(ops, initial.revision)
    expect(mutate).toHaveBeenCalledWith('web-search-firecrawl', ops, 3)
    expect(describeSettings).toHaveBeenCalledOnce()
    expect(next.revision).toBe(4)
    expect(isApiKeyConfigured(next)).toBe(false)
  })

  it('preserves a read-only deployment', async () => {
    const { remote, describeSettings } = remoteFixture()
    describeSettings.mockResolvedValue({ ok: true, value: { writable: false, hasDocument: true, namespaces: [namespace] } })
    expect((await createFirecrawlSettingsApi(remote).get()).writable).toBe(false)
  })

  it('reports an absent plugin entry rather than requesting a legacy HTTP route', async () => {
    const { remote, describeSettings } = remoteFixture()
    describeSettings.mockResolvedValue({ ok: true, value: { writable: true, hasDocument: true, namespaces: [] } })
    await expect(createFirecrawlSettingsApi(remote).get()).rejects.toMatchObject({ code: 'settings-unavailable' })
  })

  it('preserves the standard stale-revision error code for the page recovery path', async () => {
    const { remote, mutate } = remoteFixture()
    mutate.mockResolvedValue({ ok: false, error: new RemoteError('settings/conflict', 'changed elsewhere', { ns: namespace.ns, expected: 3, actual: 4 }) })
    await expect(createFirecrawlSettingsApi(remote).mutate([], 3)).rejects.toMatchObject({ code: 'settings/conflict' })
  })

  it('surfaces authenticated Remote read failures and transport failures', async () => {
    const { remote, describeSettings } = remoteFixture()
    describeSettings.mockResolvedValue({ ok: false, error: new RemoteError('gateway/internal', 'settings unavailable', {}) })
    await expect(createFirecrawlSettingsApi(remote).get()).rejects.toThrow('settings unavailable')
    describeSettings.mockRejectedValue(new Error('disconnected'))
    await expect(createFirecrawlSettingsApi(remote).get()).rejects.toThrow('disconnected')
  })
})
