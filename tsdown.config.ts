/**
 * tsdown build for `@pionai/dsh-web-search-firecrawl`:
 * - host half: lib/index.js + lib/invariant.js (ESM node),
 * - browser half: lib/client.js (CJS closure factory registered through
 *   `window.__ModuleLoader__.load` under the package name).
 *
 * The client bundle replicates the official DSH client-bundle preset:
 * platform modules resolve through the frozen module table at runtime and
 * everything else is inlined. The purity gate rejects any other
 * `@deepseek-ai/*` VALUE import; cross-plugin collaboration goes through
 * cordis services or type-only imports. CSS Modules compile to hashed class
 * maps and inject a `<style data-plugin>` tag at factory execution.
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve as resolvePath, sep } from 'node:path'
import { builtinModules, createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const require = createRequire(import.meta.url)

const PACKAGE_NAME = '@pionai/dsh-web-search-firecrawl'

/** Node builtins must never survive into the browser module-loader factory. */
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map(id => `node:${id}`)])

/** Module specifiers the web shell shares into the frozen module table. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

/** Wire/type layers a client bundle may inline. */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/

const REPOSITORY_ROOT = fileURLToPath(new URL('.', import.meta.url))
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** The style-injection prologue shared by module css loads. */
function injectTag(pluginId: string, fileId: string, cssText: string): string {
  const tagId = `${pluginId}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(cssText)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
    `  const tag = document.createElement('style');`,
    `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
    `  tag.dataset.pluginCss = tagId;`,
    `  tag.textContent = css;`,
    `  document.head.appendChild(tag);`,
    `}`,
  ].join('\n')
}

/** Rebase a physical lib-relative source onto the repository-shaped URL tree. */
function browserSourcePath(source: string, sourcemapPath: string): string {
  if (!source.startsWith('.')) return source
  const physicalSource = resolvePath(dirname(sourcemapPath), source)
  const repositoryPath = relative(REPOSITORY_ROOT, physicalSource).split(sep).join('/')
  return `../../../${repositoryPath}`
}

type BuildPlugin = NonNullable<UserConfig['plugins']>

/** Reject Node builtins and non-platform `@deepseek-ai/*` value imports. */
function purityGatePlugin(): BuildPlugin {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (NODE_BUILTINS.has(source)) {
        throw new Error(
          `client bundle purity: Node builtin "${source}" cannot run in the browser module table`,
        )
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      if (INLINE_SAFE.test(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module and not an inline-safe wire layer`,
      )
    },
  }
}

/** Compile CSS Modules into class maps + injected <style data-plugin> tags. */
function makeCssPlugin(pluginId: string): BuildPlugin {
  return {
    name: 'dsh-css-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.css')) return null
      let abs: string
      if (source.startsWith('.') || source.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source)) {
        abs = importer === undefined ? source : resolvePath(dirname(importer), source)
      } else {
        abs = require.resolve(source)
      }
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: 'firecrawl_[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      return [
        injectTag(pluginId, fileId, code.toString()),
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }
}

export default [
  {
    entry: { index: 'src/index.ts', invariant: 'src/invariant.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    // `clean` stays off: the build script removes lib/ before tsc emits the
    // declaration tree, and tsdown must never wipe `lib/types`.
    clean: false,
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
      'import.meta.resolve': 'undefined',
    },
    inputOptions: {
      resolve: {
        conditionNames: ['browser', 'import', 'require', 'default'],
      },
    },
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [purityGatePlugin(), makeCssPlugin(PACKAGE_NAME)],
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapPathTransform: browserSourcePath,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      codeSplitting: false,
    },
  },
] satisfies UserConfig[]
