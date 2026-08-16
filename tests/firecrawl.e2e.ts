import { describe, expect, it } from 'vitest'
import { FirecrawlSearchProvider, FIRECRAWL_DEFAULT_BASE_URL, FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS } from '../src/index.ts'

/**
 * Real-API smoke for the Firecrawl search provider. Self-skips without
 * `$FIRECRAWL_API_KEY` (CI has no secrets), per the with-key e2e policy in
 * docs/testing.md.
 */
const apiKey = process.env.FIRECRAWL_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('FirecrawlSearchProvider real API', () => {
  it('returns sources for a live query', async () => {
    const provider = new FirecrawlSearchProvider({
      apiKey: apiKey!,
      baseURL: process.env.FIRECRAWL_BASE_URL ?? FIRECRAWL_DEFAULT_BASE_URL,
      maxSnippetChars: FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
    })
    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})
