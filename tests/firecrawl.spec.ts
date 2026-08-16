import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import { FirecrawlSearchProvider, FIRECRAWL_PROVIDER_ID } from '../src/index.ts'
import * as firecrawlPlugin from '../src/index.ts'
import { mapFirecrawlResponse, mapFirecrawlResult, truncateTo } from '../src/provider.ts'
import type { FirecrawlWebServer } from '../src/settings-routes.ts'
import { FIRECRAWL_SETTINGS_NAMESPACE } from '../src/settings-shared.ts'

/** In-memory settings provider for exercising the optional settings seam. */
class MemorySettingsProvider extends SettingsProvider {
  writable = true

  async load(): Promise<Record<string, unknown>> {
    return {}
  }

  async persist(): Promise<void> {}
}

const options = { apiKey: 'firecrawl-key', baseURL: 'https://api.firecrawl.test', maxSnippetChars: 600 }

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

describe('web-search-firecrawl settings route', () => {
  it('serves a redacted settings view through the fenced route', async () => {
    const ctx = new Context()
    // The route is registered by the plugin owner, but the webServer service is
    // only present in web compositions; provide structural fakes for the test.
    let capturedRoute: NonNullable<Parameters<FirecrawlWebServer['register']>[0]> | undefined
    const server: FirecrawlWebServer = {
      register: vi.fn((route) => {
        capturedRoute = route
        return () => {}
      }),
    }
    ctx.provide('webServer', server)
    ctx.provide('webRuntime', { trustedHosts: [] })
    await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
    await ctx.plugin(MemorySettingsProvider)
    await ctx.plugin(firecrawlPlugin, {})
    await ctx.settings.update(settingsNamespace(FIRECRAWL_SETTINGS_NAMESPACE), {
      apiKey: 'route-key',
      baseURL: 'https://route.firecrawl.test',
    })
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(server.register).toHaveBeenCalledOnce()
    const handler = capturedRoute!.handler
    let responseBody = ''
    const req = {
      method: 'POST',
      headers: { host: '127.0.0.1:4567' },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ method: 'settings.get', payload: {} }))
      },
    }
    const res = {
      writeHead: (status: number, headers: Record<string, string>) => { responseStatus = status },
      end: (body: string) => { responseBody = body },
    }
    let responseStatus = 200
    await handler(req as never, res as never)
    expect(responseStatus).toBe(200)
    const parsed = JSON.parse(responseBody) as { ok: boolean; value: { value: Record<string, unknown>; revision: number; secrets: Array<{ path: string[]; set: boolean }> } }
    expect(parsed.ok).toBe(true)
    expect(parsed.value.value).not.toHaveProperty('apiKey')
    expect(parsed.value.secrets).toContainEqual({ path: ['apiKey'], set: true })

    // The mutate path applies a path op with revision fencing and returns the
    // fresh redacted view (secret still never rides a response).
    const mutateReq = {
      method: 'POST',
      headers: { host: '127.0.0.1:4567' },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({
          method: 'settings.mutate',
          payload: {
            ops: [{ op: 'unset', path: ['apiKey'] }],
            expectedRevision: parsed.value.revision,
          },
        }))
      },
    }
    let mutateStatus = 200
    let mutateBody = ''
    await handler(mutateReq as never, {
      writeHead: (status: number) => { mutateStatus = status },
      end: (body: string) => { mutateBody = body },
    } as never)
    expect(mutateStatus).toBe(200)
    const mutated = JSON.parse(mutateBody) as { ok: boolean; value: { secrets: Array<{ path: string[]; set: boolean }> } }
    expect(mutated.ok).toBe(true)
    expect(mutated.value.secrets).toContainEqual({ path: ['apiKey'], set: false })
    await ctx.fiber.dispose()
  })
})

describe('web-search-firecrawl settings namespace', () => {
  it('switches to the original DeepSeek provider when useFirecrawl is turned off', async () => {
    const prevDeepseekKey = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'deepseek-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({
        content: [{
          type: 'web_search_tool_result',
          content: [{ type: 'web_search_result', url: 'https://deepseek.test', title: 'DeepSeek' }],
        }],
      }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
      await ctx.plugin(MemorySettingsProvider)
      const fiber = await ctx.plugin(firecrawlPlugin, {})
      await ctx.settings.update(settingsNamespace(FIRECRAWL_SETTINGS_NAMESPACE), { useFirecrawl: false })
      await new Promise(resolve => { setTimeout(resolve, 0) })
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).toBe('https://api.deepseek.com/anthropic/v1/messages')
      await fiber.dispose()
    } finally {
      if (prevDeepseekKey === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = prevDeepseekKey
    }
  })

  it('reconfigures the registered provider when a settings commit resolves', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
    await ctx.plugin(MemorySettingsProvider)
    const fiber = await ctx.plugin(firecrawlPlugin, {})
    const before = ctx.settings.describe({ redactSecrets: true })
      .find(candidate => candidate.ns === settingsNamespace(FIRECRAWL_SETTINGS_NAMESPACE))
    expect(before?.secrets).toContainEqual({ path: ['apiKey'], set: false })
    await ctx.settings.update(settingsNamespace(FIRECRAWL_SETTINGS_NAMESPACE), {
      apiKey: 'settings-key',
      baseURL: 'https://settings.firecrawl.test',
      limit: 4,
    })
    // Watcher notification is queued asynchronously by the settings seam.
    await new Promise(resolve => { setTimeout(resolve, 0) })
    await ctx.web.search({ query: 'q' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://settings.firecrawl.test/v1/search')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer settings-key')
    expect(JSON.parse(init.body as string)).toMatchObject({ query: 'q', limit: 4 })
    await fiber.dispose()
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
      firecrawlPlugin.apply(ctx, {})
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
