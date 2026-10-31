import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type z from '@deepseek-ai/schemastery'
import { redactSecrets } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import { FirecrawlSearchProvider, FIRECRAWL_PROVIDER_ID } from '../src/index.ts'
import * as firecrawlPlugin from '../src/index.ts'
import { mapFirecrawlResponse, mapFirecrawlResult, truncateTo } from '../src/provider.ts'

/** Mount through the real Loader so live updates exercise stable Config references. */
async function loadedPlugin(config: Record<string, unknown> = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
  await ctx.plugin(Loader)
  ctx.loader.builtins.firecrawl = firecrawlPlugin
  const id = await ctx.loader.create({ name: 'cordis:firecrawl', config })
  const fiber = ctx.loader.resolve(id).fiber!
  await fiber.await()
  const update = async (next: Record<string, unknown>) => {
    await fiber.entry!.update({ config: next })
    await fiber.await()
  }
  return { ctx, fiber, update }
}

const options = { apiKey: 'firecrawl-key', baseURL: 'https://api.firecrawl.test', maxSnippetChars: 600 }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Firecrawl result mapping', () => {
  it('bounds a snippet to maxSnippetChars', () => {
    expect(truncateTo('short', 600)).toBe('short')
    expect(truncateTo('a'.repeat(700), 600)).toBe('a'.repeat(600))
  })

  it('maps a full result entry', () => {
    expect(mapFirecrawlResult({ url: 'https://a.test', title: 'A', description: 'the excerpt' }, 600))
      .toEqual({ url: 'https://a.test', title: 'A', snippet: 'the excerpt' })
  })

  it('trims and bounds the description before mapping', () => {
    expect(mapFirecrawlResult({ url: 'https://a.test', description: '  ' + 'x'.repeat(700) + '  ' }, 600))
      .toEqual({ url: 'https://a.test', snippet: 'x'.repeat(600) })
  })

  it('keeps a citeable URL-only source when no description is present', () => {
    expect(mapFirecrawlResult({ url: 'https://a.test' }, 600)).toEqual({ url: 'https://a.test' })
    expect(mapFirecrawlResult({ url: 'https://a.test', description: null }, 600)).toEqual({ url: 'https://a.test' })
    expect(mapFirecrawlResult({ url: 'https://a.test', description: '   ' }, 600)).toEqual({ url: 'https://a.test' })
  })

  it('omits null/empty optional fields rather than emitting them', () => {
    expect(mapFirecrawlResult({ url: 'https://a.test', title: null, description: 'hi' }, 600))
      .toEqual({ url: 'https://a.test', snippet: 'hi' })
    expect(mapFirecrawlResult({ url: 'https://a.test', title: '', description: 'hi' }, 600))
      .toEqual({ url: 'https://a.test', snippet: 'hi' })
  })

  it('maps a response to a result with no content', () => {
    const result = mapFirecrawlResponse({
      success: true,
      data: [
        { url: 'https://a.test', description: 'one' },
        { url: 'https://b.test' },
        { url: 'https://c.test', title: 'C', description: 'three' },
      ],
    }, 600)
    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', snippet: 'one' },
        { url: 'https://b.test' },
        { url: 'https://c.test', title: 'C', snippet: 'three' },
      ],
      truncated: false,
    })
    expect(result.content).toBeUndefined()
  })

  it('tolerates a missing data array', () => {
    expect(mapFirecrawlResponse({ success: true }, 600).sources).toEqual([])
  })

  it('throws WEB_PROVIDER_ERROR with the detail when the envelope reports failure', () => {
    expect(() => mapFirecrawlResponse({ success: false, error: 'search failed' }, 600))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'search failed' }))
    expect(() => mapFirecrawlResponse({ success: false }, 600))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    expect(() => mapFirecrawlResponse({}, 600))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('FirecrawlSearchProvider availability', () => {
  it('is unavailable without a key', () => {
    expect(new FirecrawlSearchProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is available with a key', () => {
    expect(new FirecrawlSearchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new FirecrawlSearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured when maxSnippetChars is not a positive integer', () => {
    expect(new FirecrawlSearchProvider({ ...options, maxSnippetChars: 0 }).available()).toBe(false)
    expect(new FirecrawlSearchProvider({ ...options, maxSnippetChars: 1.5 }).available()).toBe(false)
  })

  it('is misconfigured when limit is set but not a positive integer', () => {
    expect(new FirecrawlSearchProvider({ ...options, limit: -1 }).available()).toBe(false)
  })
})

describe('FirecrawlSearchProvider request mapping', () => {
  it('sends query, limit and bearer auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [{ url: 'https://a.test' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new FirecrawlSearchProvider({ ...options, limit: 9 })
    await provider.search({ query: 'hello', maxResults: 5 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.test/v1/search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer firecrawl-key')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'hello', limit: 5 })
  })

  it('falls back to the configured limit when a request omits maxResults', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlSearchProvider({ ...options, limit: 7 }).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ limit: 7 })
  })

  it('lets a request maxResults win over the configured limit', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlSearchProvider({ ...options, limit: 7 }).search({ query: 'q', maxResults: 2 })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ limit: 2 })
  })

  it('omits limit when neither maxResults nor a configured default is set', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlSearchProvider(options).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).not.toHaveProperty('limit')
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new FirecrawlSearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('FirecrawlSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, error: 'bad key' }, { status: 401 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'bad key' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Firecrawl API error (HTTP 502)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Firecrawl API error (HTTP 500)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps a success:false envelope to WEB_PROVIDER_ERROR with its detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, error: 'envelope failure' }, { status: 200 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'envelope failure' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: {} }, { status: 200 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('FirecrawlSearchProvider dynamic options', () => {
  it('uses options supplied through setOptions on the next request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new FirecrawlSearchProvider(options)
    provider.setOptions({ apiKey: 'next-key', baseURL: 'https://next.firecrawl.test', limit: 11, maxSnippetChars: 60 })
    await provider.search({ query: 'q' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://next.firecrawl.test/v1/search')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer next-key')
    expect(JSON.parse(init.body as string)).toMatchObject({ query: 'q', limit: 11 })
  })
})

describe('FirecrawlSearchProvider original-provider fallback', () => {
  it('delegates to the fallback provider when useFirecrawl is false', async () => {
    const search = vi.fn(async () => ({ sources: [{ url: 'https://deepseek.test' }], truncated: false }))
    const fallback = {
      id: 'deepseek-official',
      available: vi.fn(() => true),
      search,
    }
    const provider = new FirecrawlSearchProvider({ ...options, useFirecrawl: false, fallback })
    expect(provider.available()).toBe(true)
    await expect(provider.search({ query: 'q' })).resolves.toMatchObject({ sources: [{ url: 'https://deepseek.test' }] })
    expect(fallback.available).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledWith({ query: 'q' }, undefined)
  })

  it('is unavailable when disabled without a fallback', () => {
    const provider = new FirecrawlSearchProvider({ ...options, useFirecrawl: false })
    expect(provider.available()).toBe(false)
  })
})

describe('web-search-firecrawl live configuration', () => {
  it('updates credentials, endpoint and limits without remounting the provider', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [{ url: 'https://a.test', description: 'abcdef' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { ctx, fiber, update } = await loadedPlugin({ apiKey: 'first-key' })
    const initial = fiber.config
    await ctx.web.search({ query: 'before' })
    await update({ apiKey: 'next-key', baseURL: 'https://next.test', limit: 4, maxSnippetChars: 3 })
    expect(fiber.config).toBe(initial)
    const result = await ctx.web.search({ query: 'after' })
    expect(fetchMock.mock.calls[1]).toEqual(['https://next.test/v1/search', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer next-key' }),
      body: JSON.stringify({ query: 'after', limit: 4 }),
    })])
    expect(result.sources[0]?.snippet).toBe('abc')
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'disposed' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })

  it('switches to official DeepSeek search and back through volatile configuration', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'deepseek-key')
    const fetchMock = vi.fn(async (url: string | URL | Request) => String(url).includes('deepseek.com')
      ? jsonResponse({ content: [{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://deepseek.test', title: 'DeepSeek' }] }] })
      : jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const { ctx, fiber, update } = await loadedPlugin({ apiKey: 'firecrawl-key' })
    const initial = fiber.config
    await update({ apiKey: 'firecrawl-key', useFirecrawl: false })
    await ctx.web.search({ query: 'deepseek' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/anthropic/v1/messages')
    await update({ apiKey: 'firecrawl-key', useFirecrawl: true })
    await ctx.web.search({ query: 'firecrawl' })
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.firecrawl.dev/v1/search')
    expect(fiber.config).toBe(initial)
  })

  it('keeps every editable field volatile and hides the saved key in settings views', () => {
    for (const field of Object.values(firecrawlPlugin.Config.dict!)) expect(field.meta.volatile).toBe(true)
    const redacted = redactSecrets(firecrawlPlugin.Config as z<never>, { apiKey: 'private', useFirecrawl: false })
    expect(redacted.value).not.toHaveProperty('apiKey')
    expect(redacted.secrets).toContainEqual({ path: ['apiKey'], set: true })
  })

  it('uses the optional settings presentation policy and releases it on disposal', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const dispose = vi.fn()
    const configure = vi.fn(() => dispose)
    ctx.provide('settings', { configure })
    await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
    const fiber = await ctx.plugin(firecrawlPlugin, { apiKey: 'key' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(configure).toHaveBeenCalledWith({ auto: false }, fiber)
    await fiber.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

describe('web-search-firecrawl plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
    const fiber = await ctx.plugin(firecrawlPlugin, { apiKey: 'firecrawl-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in firecrawlPlugin).toBe(false)
  })

  it('threads limit and maxSnippetChars config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
    const fiber = await ctx.plugin(firecrawlPlugin, { apiKey: 'firecrawl-key', limit: 9, maxSnippetChars: 100 })
    await ctx.web.search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ limit: 9 })
    await fiber.dispose()
  })

  it('falls back to $FIRECRAWL_API_KEY and the default base URL when config omits them', async () => {
    const prev = process.env.FIRECRAWL_API_KEY
    process.env.FIRECRAWL_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
      const fiber = await ctx.plugin(firecrawlPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).toBe('https://api.firecrawl.dev/v1/search')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.FIRECRAWL_API_KEY
      else process.env.FIRECRAWL_API_KEY = prev
    }
  })

  it('falls back to the env key and defaults when config omits them (direct apply)', async () => {
    const prev = process.env.FIRECRAWL_API_KEY
    process.env.FIRECRAWL_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [{ url: 'https://a.test', description: 'x'.repeat(900) }] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
      firecrawlPlugin.apply(ctx, firecrawlPlugin.Config({}))
      const result = await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).toBe('https://api.firecrawl.dev/v1/search')
      expect(result.sources[0]?.snippet).toBe('x'.repeat(600))
      await ctx.fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.FIRECRAWL_API_KEY
      else process.env.FIRECRAWL_API_KEY = prev
    }
  })

  it('is unavailable when neither config nor env supplies a key', async () => {
    const prev = process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
      await ctx.plugin(firecrawlPlugin, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    } finally {
      if (prev !== undefined) process.env.FIRECRAWL_API_KEY = prev
    }
  })
})
