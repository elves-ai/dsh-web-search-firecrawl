import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { FirecrawlSearchProvider, FIRECRAWL_PROVIDER_ID } from '../src/index.ts'
import * as firecrawlPlugin from '../src/index.ts'
import { mapFirecrawlResponse, mapFirecrawlResult, truncateTo } from '../src/provider.ts'
import type { FirecrawlSearchProviderOptions } from '../src/provider.ts'

const options: FirecrawlSearchProviderOptions = { apiKey: 'firecrawl-key', baseURL: 'https://api.firecrawl.test', maxSnippetChars: 600 }

function providerOf(overrides: Partial<FirecrawlSearchProviderOptions> = {}): FirecrawlSearchProvider {
  const merged = { ...options, ...overrides }
  return new FirecrawlSearchProvider(() => ({ ...merged }))
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
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

  it('maps a v2 data.web[] response', () => {
    const result = mapFirecrawlResponse({
      success: true,
      data: { web: [{ url: 'https://a.test', description: 'one' }] },
    }, 600)
    expect(result).toEqual({
      sources: [{ url: 'https://a.test', snippet: 'one' }],
      truncated: false,
    })
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
  it('is unavailable without a key on a remote endpoint', () => {
    expect(providerOf({ apiKey: '' }).available()).toBe(false)
  })

  it('is available keyless on a loopback self-hosted endpoint', () => {
    expect(providerOf({ apiKey: '', baseURL: 'http://localhost:3002' }).available()).toBe(true)
    expect(providerOf({ apiKey: '', baseURL: 'http://127.0.0.1:3002' }).available()).toBe(true)
  })

  it('is available with a key', () => {
    expect(providerOf().available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(providerOf({ baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured when maxSnippetChars is not a positive integer', () => {
    expect(providerOf({ maxSnippetChars: 0 }).available()).toBe(false)
    expect(providerOf({ maxSnippetChars: 1.5 }).available()).toBe(false)
  })

  it('is misconfigured when limit is set but not a positive integer', () => {
    expect(providerOf({ limit: -1 }).available()).toBe(false)
  })
})

describe('FirecrawlSearchProvider request mapping', () => {
  it('sends query, limit and bearer auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [{ url: 'https://a.test' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = providerOf({ limit: 9 })
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
    await providerOf({ limit: 7 }).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ limit: 7 })
  })

  it('lets a request maxResults win over the configured limit', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await providerOf({ limit: 7 }).search({ query: 'q', maxResults: 2 })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ limit: 2 })
  })

  it('omits limit when neither maxResults nor a configured default is set', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await providerOf().search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).not.toHaveProperty('limit')
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await providerOf().search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
  it('retries /v2/search when /v1/search answers 404 (self-hosted)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/search')) return new Response('not found', { status: 404 })
      return jsonResponse({ success: true, data: { web: [{ url: 'https://a.test', description: 'v2 excerpt' }] } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await providerOf({ apiKey: '', baseURL: 'http://localhost:3002' }).search({ query: 'q' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(secondUrl).toBe('http://localhost:3002/v2/search')
    expect(secondInit.headers).not.toHaveProperty('authorization')
    expect(result).toEqual({
      sources: [{ url: 'https://a.test', snippet: 'v2 excerpt' }],
      truncated: false,
    })
  })

  it('omits the auth header for keyless loopback requests', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await providerOf({ apiKey: '', baseURL: 'http://localhost:3002' }).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).not.toHaveProperty('authorization')
  })
})

describe('FirecrawlSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, error: 'bad key' }, { status: 401 })))
    await expect(providerOf().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'bad key' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(providerOf().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Firecrawl API error (HTTP 502)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(providerOf().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Firecrawl API error (HTTP 500)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(providerOf().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(providerOf().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps a success:false envelope to WEB_PROVIDER_ERROR with its detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, error: 'envelope failure' }, { status: 200 })))
    await expect(providerOf().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'envelope failure' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(providerOf().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: {} }, { status: 200 })))
    await expect(providerOf().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(providerOf().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(providerOf().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('FirecrawlSearchProvider dynamic options', () => {
  it('reads the latest thunk options on the next request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    let current: FirecrawlSearchProviderOptions = { ...options }
    const provider = new FirecrawlSearchProvider(() => ({ ...current }))
    current = { apiKey: 'next-key', baseURL: 'https://next.firecrawl.test', limit: 11, maxSnippetChars: 60 }
    await provider.search({ query: 'q' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://next.firecrawl.test/v1/search')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer next-key')
    expect(JSON.parse(init.body as string)).toMatchObject({ query: 'q', limit: 11 })
  })
})

describe('web-search-firecrawl plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
    // 0.2.0-rc.2 volatile config: plain values are resolved to Volatile refs by cordis.
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
      // Direct apply bypasses cordis config resolution: emulate volatile refs.
      const volatileOf = <T>(value: T) => ({ get: () => value })
      firecrawlPlugin.apply(ctx, {
        apiKey: volatileOf(undefined),
        baseURL: volatileOf(undefined),
        limit: volatileOf(undefined),
        maxSnippetChars: volatileOf(600),
      } as never)
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

  it('is unavailable keyless on a non-loopback endpoint', async () => {
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

  it('is available keyless when the base URL is loopback', async () => {
    const prevKey = process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_KEY
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
      const fiber = await ctx.plugin(firecrawlPlugin, { baseURL: 'http://localhost:3002' })
      await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('http://localhost:3002/v1/search')
      expect(init.headers).not.toHaveProperty('authorization')
      await fiber.dispose()
    } finally {
      if (prevKey !== undefined) process.env.FIRECRAWL_API_KEY = prevKey
    }
  })
})
