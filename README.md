# dsh-web-search-firecrawl

English | [中文](README.zh.md)

A [Firecrawl](https://firecrawl.dev)-backed search provider for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web capability seam (`ctx.web`): it makes the built-in `web_search` tool run on Firecrawl's search API instead of the shipped DeepSeek route.

The plugin is a Cordis function plugin that registers a `WebSearchProvider` (`id: firecrawl`) into the seam — it does not own `ctx.web` and does not register a model-facing tool (the tool schema stays with `@deepseek-ai/dsh-tool-web`). It calls Firecrawl's `POST /v1/search` endpoint and maps the flat `data[]` into the seam's normalized `WebSearchResult`.

The API key is configured from the **Firecrawl page in DSH Settings**; `$FIRECRAWL_API_KEY` remains available as a compatibility fallback.

## Requirements

- A DeepSeek Harness installation on the `0.1.0-rc.6` line of the official packages (the plugin peers on `@deepseek-ai/dsh-web ^0.1.0-rc.6` and friends — the current release line). On an older line, pnpm nests a second copy of the seam into the profile and error classification degrades (cross-copy `WebError`); check from the profile directory with `npm ls @deepseek-ai/dsh-web`.
- A Firecrawl API key. Get one at [firecrawl.dev](https://firecrawl.dev).

## Install

Choose **one** of the following:

**Option 1 — global `dsh` CLI**

```sh
dsh plugin --profile web add @pionai/dsh-web-search-firecrawl
```

**Option 2 — `deepseek-harness` source checkout** (there `dsh` is a pnpm workspace script, not a global binary; run it from the workspace root):

```sh
pnpm dsh plugin --profile web add @pionai/dsh-web-search-firecrawl
```

`dsh plugin` forwards to pnpm inside the profile directory and appends the bundle to the profile's layer stack automatically. The bundle patch inserts the `web-search-firecrawl` plugin row and switches the `web` seam row to `searchProvider: firecrawl` (replacing the base bundle's `deepseek-official`).

After installing, **restart `dsh web`**, then hard-refresh the page (Cmd/Ctrl+Shift+R) so the browser half and its settings page load:

```sh
dsh web
```

Verify: the Settings dialog should show the **Firecrawl** page, and asking the agent for a web search should route through Firecrawl. Without a key, a search fails with `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.

To keep DeepSeek search as the default and enable Firecrawl per instance instead, restate the `web` row in your profile's own `cordis.patch.yml` afterwards — the last write wins per row. The base bundle pins `searchProvider: deepseek-official`, so `$DSH_WEB_SEARCH_PROVIDER` selects the provider only when the `web` row sets no `searchProvider`: restate `web` with an empty config (`- id: web` + `config: {}`) for env selection, or with `searchProvider: deepseek-official` to pin DeepSeek.

## Update

Global `dsh` CLI:

```sh
dsh plugin --profile web update --latest @pionai/dsh-web-search-firecrawl
```

`deepseek-harness` source checkout — run from the workspace root:

```sh
pnpm dsh plugin --profile web update --latest @pionai/dsh-web-search-firecrawl
```

`dsh plugin update` forwards to pnpm inside the profile directory; `--latest` upgrades to the latest published version regardless of the currently installed range. After updating, **restart `dsh web`**, then hard-refresh the page (Cmd/Ctrl+Shift+R). If the plugin is installed in another profile, replace `web` with that profile name.

## Uninstall

Global `dsh` CLI:

```sh
dsh plugin --profile web remove @pionai/dsh-web-search-firecrawl
```

`deepseek-harness` source checkout — run from the workspace root:

```sh
pnpm dsh plugin --profile web remove @pionai/dsh-web-search-firecrawl
```

`dsh plugin remove` forwards to pnpm inside the profile directory and also removes the package from `dsh.profile.bundles`. Once the bundle layer is gone, the `web` seam row reverts to the base bundle's `deepseek-official` provider. Restart `dsh web` for the removal to take effect in the running process.

The command removes the package and its mount, but not settings-page values. If you also want to delete the saved API key, clear it on the **Firecrawl** page before uninstalling. If the plugin was installed into another profile, replace `web` with that profile name.

## Switching search providers

Installing the plugin switches the `web` seam's `searchProvider` to `firecrawl`, so Firecrawl replaces the original web search by default. In **DSH Settings → Firecrawl**, the **Use Firecrawl** switch at the top selects between the two providers live:

- **On (default)**: Firecrawl `POST /v1/search` is used.
- **Off**: the registered `firecrawl` provider delegates to the original DeepSeek search implementation, so the model keeps using the shipped DeepSeek search route; DeepSeek's endpoint/model still resolve from the original `web-search-deepseek` settings section.

The switch applies immediately without a restart. Firecrawl credentials and request settings are preserved while off.

## Configuring the API key

Open **DSH Settings → Firecrawl**:

1. Paste `fc-...` into the **API Key** field and save. The eye button beside the field toggles plain-text visibility for the current draft.
2. The key is written with `role('secret')`: the saved literal never rides a response; the page only shows whether a key is configured.
3. **Saving with the field blank keeps the current key**; use **Clear** to remove it.
4. Changes apply **immediately** — the registered provider uses the new values on the next search, no restart required.

If the settings-page key is blank, the provider still falls back to `$FIRECRAWL_API_KEY`:

```sh
export FIRECRAWL_API_KEY=fc-...
dsh --profile web
```

## Config

| Key | Default | Meaning |
|---|---|---|
| `useFirecrawl` | `true` | Whether to use Firecrawl; `false` switches back to the original DeepSeek web search. |
| `apiKey` | (blank) → `$FIRECRAWL_API_KEY` | Firecrawl API key. Written as a secret by the settings page and never echoed back. Blank falls back to the env var; with neither present the provider is unavailable. |
| `baseURL` | `https://api.firecrawl.dev` | Endpoint base; `/v1/search` is appended. An unparseable value makes the provider unavailable. |
| `limit` | (unset) | Default result count when a request carries no `maxResults`. Unset sends no default. Must be a positive integer. |
| `maxSnippetChars` | `600` | Upper bound on characters kept from one `description` when mapping `snippet`. Must be a positive integer. |

Every field is editable from the settings page. Bundle config remains the composition `base` layer under that user section, so a profile can pin only the fields it needs:

```yaml
# profile cordis.patch.yml (optional; usually not needed)
- id: web-search-firecrawl
  name: '@pionai/dsh-web-search-firecrawl'
  config:
    limit: 10
```

## Mapping

Firecrawl returns a flat `data[]` and no generated answer, so `content` is omitted. Each entry maps to a `WebSearchSource`: `url` ← `url`, `title` ← `title`, `snippet` ← `description` trimmed and bounded to `maxSnippetChars` (an entry without a non-blank description keeps its citeable URL-only source). A request's `maxResults` wins over the configured `limit` default and is sent as Firecrawl's `limit` for a cost/latency optimization; the final bound is enforced by the seam. Provider failures (HTTP errors, network failure, unparseable or wrong-shape bodies, a `success: false` envelope) surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted.

## Model Experience

Indirect, through `@deepseek-ai/dsh-tool-web`: the model sees the `maxResults`-bounded URLs, titles, and bounded descriptions, plus the consumer's error wrapper around `Firecrawl search aborted`, `Firecrawl search request failed: <error>`, and `Firecrawl returned an unprocessable response body: <error>`. Generated answers and provider-private fields stay out of context.

## Known Limitations

- **A snippet is Firecrawl's `description` excerpt, not a search-engine summary** — it can be long page markdown, so the provider bounds it to `maxSnippetChars`; entries without a description carry no snippet at all (URL-only).
- **Only `limit`/`maxSnippetChars` are exposed** — Firecrawl's other controls (language, country, recency, location, targeting, scrape options) wait on provider-neutral Service Definition fields in `@deepseek-ai/dsh-web`.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason surfaces as `WEB_PROVIDER_ERROR`.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test                            # unit suite (no network)
FIRECRAWL_API_KEY=... pnpm run test:e2e  # live-API smoke, self-skips without the key
pnpm run build                       # emits lib/ (ESM host) + lib/client.js (browser) + lib/types/ (d.ts)
```

## License

MIT
