import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

describe('bundle composition', () => {
  it('replaces the web config without dropping the base HTTP fetch provider', () => {
    const patch = parse(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))
    expect(patch).toEqual([
      { insert: [{ id: 'web-search-firecrawl', name: '@elves-ai/dsh-web-search-firecrawl' }] },
      { id: 'web', name: '@deepseek-ai/dsh-web', config: { searchProvider: 'firecrawl', fetchProvider: 'http' } },
    ])
  })
})
