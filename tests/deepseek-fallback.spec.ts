import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { DeepSeekSearchLlmRequest } from '@deepseek-ai/dsh-web-search-deepseek'
import { createDeepSeekSearchProvider } from '../src/deepseek-provider.ts'

function context() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  return ctx
}

function searchResponse() {
  return new Response(JSON.stringify({ content: [{
    type: 'web_search_tool_result',
    content: [{ type: 'web_search_result', url: 'https://result.test', title: 'Result' }],
  }] }), { headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('official DeepSeek fallback', () => {
  it('reads current plain settings descriptors rather than removed settings.get', async () => {
    const ctx = context()
    let value = { apiKey: 'first-key', baseURL: 'https://first.test/v1', model: 'first', maxTokens: 32, maxUses: 2 }
    ctx.provide('settings', { describe: () => [{ ns: 'web-search-deepseek', value }] })
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => searchResponse())
    vi.stubGlobal('fetch', fetchMock)
    const provider = createDeepSeekSearchProvider(ctx)
    await provider.search({ query: 'before' })
    value = { ...value, apiKey: 'next-key', baseURL: 'https://next.test/v1', model: 'next' }
    await provider.search({ query: 'after' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://first.test/v1/messages', 'https://next.test/v1/messages'])
    const init = fetchMock.mock.calls[1][1]!
    expect(init.headers).toMatchObject({ 'x-api-key': 'next-key' })
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'next', max_tokens: 32, tools: [{ max_uses: 2 }] })
  })

  it('uses account authentication only for an account-initiated Session and logs before dispatch', async () => {
    const ctx = context()
    const order: string[] = []
    let provider = 'deepseek-account'
    const append = vi.fn((_event: string, _request: DeepSeekSearchLlmRequest) => { order.push('record') })
    ctx.provide('agents', { currentInitiator: () => ({ session: { requestContext: () => ({ provider }), append } }) })
    const resolveToken = vi.fn(async () => 'account-token')
    ctx.provide('deepseekAccount', { resolveToken })
    ctx.provide('settings', { describe: () => [{ ns: 'web-search-deepseek', value: { apiKey: 'literal-key' } }] })
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      order.push('fetch')
      return searchResponse()
    })
    vi.stubGlobal('fetch', fetchMock)
    const fallback = createDeepSeekSearchProvider(ctx)
    await fallback.search({ query: 'account query' })
    expect(resolveToken).toHaveBeenCalledWith('https://api.deepseek.com/anthropic/v1/messages')
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'x-dsh-auth-token': 'account-token' })
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('x-api-key')
    expect(order).toEqual(['record', 'fetch'])
    const [event, request] = append.mock.calls[0]
    expect(event).toBe('web/deepseek-search-llm-request')
    expect(request).toEqual({
      endpoint: 'https://api.deepseek.com/anthropic/v1/messages',
      apiVersion: '2023-06-01', body: JSON.parse(String(fetchMock.mock.calls[0][1]?.body)),
    })
    expect(JSON.stringify(request)).not.toContain('account-token')
    provider = 'other'
    await fallback.search({ query: 'api key query' })
    expect(resolveToken).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ 'x-api-key': 'literal-key' })
  })

  it('does not bypass an authoritative credentials provider with an ambient key', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'ambient-key')
    const ctx = context()
    ctx.provide('credentials', { resolve: async () => undefined })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(createDeepSeekSearchProvider(ctx).search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prevents dispatch when the Session request log cannot be written', async () => {
    const ctx = context()
    ctx.provide('settings', { describe: () => [{ ns: 'web-search-deepseek', value: { apiKey: 'key' } }] })
    ctx.provide('agents', { currentInitiator: () => ({ session: {
      requestContext: () => undefined,
      append: () => { throw new Error('log unavailable') },
    } }) })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(createDeepSeekSearchProvider(ctx).search({ query: 'q' })).rejects.toThrow('log unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
