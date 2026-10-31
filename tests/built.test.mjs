import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'

const require = createRequire(import.meta.url)

test('published Host entry registers and disposes on the current Harness', async () => {
  const plugin = await import('../lib/index.js')
  const ctx = new Context()
  try {
    await ctx.plugin(WebRuntime, { searchProvider: 'firecrawl' })
    const fiber = await ctx.plugin(plugin, { apiKey: 'smoke-key' })
    await fiber.dispose()
    await assert.rejects(ctx.web.search({ query: 'no network expected' }), { code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    const companion = await import('../lib/invariant.js')
    await ctx.plugin(companion)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('browser factory loads only current platform modules and uses Remote settings', async () => {
  let registration
  runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: entry => { registration = entry } } },
  })
  assert.equal(registration.id, '@elves-ai/dsh-web-search-firecrawl')
  const allowed = new Set(['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'])
  const client = registration.factory(specifier => {
    assert.ok(allowed.has(specifier), `unshared browser import: ${specifier}`)
    return specifier === '@deepseek-ai/dsh-client-ui-primitives' ? { Button: 'button', Input: 'input' } : require(specifier)
  })
  assert.deepEqual([...client.inject], ['slots', 'remote', 'remote.settings'])
  let section
  let reads = 0
  const namespace = {
    ns: 'web-search-firecrawl', value: { useFirecrawl: true }, revision: 0,
    autoGenerate: false, schema: {}, applies: 'live', secrets: [],
  }
  client.apply({
    remote: { settings: { describe: async () => {
      reads += 1
      return { ok: true, value: { namespaces: [namespace], writable: true } }
    } } },
    slots: {
      inject: (name, mount) => { assert.equal(name, 'plugins.bundle.config'); mount() },
      register: (options, component) => { section = { options, component }; return () => {} },
    },
  })
  assert.equal(section.options.key, '@elves-ai/dsh-web-search-firecrawl')
  assert.equal(section.options.name, 'plugins.bundle.config')
  assert.equal(section.options.id, undefined)
  assert.equal(typeof section.component, 'function')
  const { renderToStaticMarkup } = require('react-dom/server')
  const summary = renderToStaticMarkup(require('react').createElement(section.component, {
    view: 'summary', ...section.options.inject(),
  }))
  assert.match(summary, /Firecrawl/)
  assert.equal(reads, 0, 'summary must not load or edit settings')
  const view = await section.options.inject().settingsApi.get()
  assert.equal(view.writable, true)
  assert.equal(reads, 1)
})
