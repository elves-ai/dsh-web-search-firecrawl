/**
 * The "Firecrawl" settings page contributed to the DSH Settings shell.
 *
 * 0.2.0-rc.2 port: the form is resolved in `apply` and handed in through the
 * slot inject face (`useSettings` selector hook + `mutateSettings`), the same
 * pattern as the approved `dsh-web-search-enhanced` plugin. The API key is
 * write-only in the wire direction: the host schema marks it `role('secret')`,
 * so this page never receives the literal — it shows whether a key is
 * configured, accepts a replacement (blank = keep the current key), and
 * offers an explicit clear button. All commits apply live.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the settings shell's SlotMap merge for 'settings.section'.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
} from '../settings-shared.ts'
import type { FirecrawlSettingsOp } from './api.ts'
import css from './FirecrawlSettingsSection.module.css'

/** Props the settings shell binds for this section (plus the inject face). */
export type FirecrawlSettingsSectionProps = PropsRuntime<'settings.section'> & {
  /** Shared entry form handed in by `apply` through the slot inject face. */
  form?: ConfigForm<Record<string, unknown>>
}

/** Local drafts for the three settings controls. */
interface Drafts {
  apiKey: string
  baseURL: string
  limit: string
  maxSnippetChars: string
}

const INITIAL_DRAFTS: Drafts = {
  apiKey: '',
  baseURL: FIRECRAWL_DEFAULT_BASE_URL,
  limit: '',
  maxSnippetChars: String(FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS),
}

/** Read the redacted resolved value into editable draft strings. */
function draftsOf(value: Record<string, unknown> | undefined): Drafts {
  const section = value ?? {}
  return {
    apiKey: '',
    baseURL: typeof section.baseURL === 'string' && section.baseURL.length > 0
      ? section.baseURL
      : FIRECRAWL_DEFAULT_BASE_URL,
    limit: typeof section.limit === 'number' ? String(section.limit) : '',
    maxSnippetChars: typeof section.maxSnippetChars === 'number'
      ? String(section.maxSnippetChars)
      : String(FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS),
  }
}

/** Parse a positive whole number, or return null for an invalid draft. */
function parsePositiveInteger(raw: string): number | null {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : null
}

/**
 * Inline eye icon used by the API-key reveal toggle.
 */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 8s2.1-3.4 6.5-3.4S14.5 8 14.5 8s-2.1 3.4-6.5 3.4S1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.4" />
      {crossed && (
        <path d="M2.5 2.5l11 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      )}
    </svg>
  )
}

/** Human-readable error copy for one settings failure. */
function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/conflict/i.test(message)) {
    return '设置已在其他窗口被修改，已重新载入；请再次保存。'
  }
  return message
}

/**
 * Render the Firecrawl settings page.
 * @param props - the runtime share of a `settings.section` entry plus the form face.
 * @returns the section element tree.
 */
export function FirecrawlSettingsSection(props: FirecrawlSettingsSectionProps) {
  const form = props.form

  // Without the injected form the page cannot read — render the error instead
  // of stalling on "loading".
  if (form === undefined) {
    return (
      <div className={css.section}>
        <p className={css.intro}>Firecrawl 搜索提供方的 API 密钥与请求参数。</p>
        <p className={css.error} role="alert">设置表单未就绪。请重启 DSH 后重试。</p>
      </div>
    )
  }

  return <FirecrawlForm form={form} />
}

function FirecrawlForm({ form }: {
  form: ConfigForm<Record<string, unknown>>
}) {
  // Subscribe to the shared form snapshot; re-renders on every Host commit.
  const snapshot = useSyncExternalStore(
    (notify: () => void) => form.subscribe(notify),
    () => form.getSnapshot(),
  )
  const [drafts, setDrafts] = useState<Drafts>(INITIAL_DRAFTS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const value = snapshot?.value
  const revision = snapshot?.revision
  const writable = snapshot?.writable ?? true
  const status = snapshot?.status ?? 'loading'

  // Adopt the Host value into drafts whenever a fresh snapshot lands (but
  // never clobber the write-only key draft).
  useEffect(() => {
    if (value !== undefined) {
      setDrafts({ ...draftsOf(value) })
    }
    // Adopt on value identity change only; drafts are user-owned otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Secret presence: the wire value never carries the literal, so "configured"
  // is approximated by a non-empty user-layer apiKey OR the shared secret
  // marker. The form value redacts secrets, so track it via local knowledge:
  // after a successful set/unset we know the outcome; before that, presence of
  // any other saved field implies nothing — default to unknown=false and let
  // the placeholder guide. (The Host `available()` is the source of truth.)
  const configured = value !== undefined && typeof (value as Record<string, unknown>).apiKey === 'string'
    && ((value as Record<string, unknown>).apiKey as string).length > 0
  const disabled = writable === false || saving || status !== 'ready'

  const applyOps = async (ops: FirecrawlSettingsOp[]): Promise<void> => {
    if (writable === false) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const ok = await form.mutate(ops, revision)
      if (!ok) {
        setError('保存被拒绝，已重新载入；请再次保存。')
        return
      }
      setDrafts({ ...drafts, apiKey: '' })
      setNotice('已保存，新配置立即用于下一次搜索。')
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setSaving(false)
    }
  }

  const save = (): void => {
    const baseURL = drafts.baseURL.trim()
    const limitRaw = drafts.limit.trim()
    const maxRaw = drafts.maxSnippetChars.trim()
    const limit = limitRaw === '' ? null : parsePositiveInteger(limitRaw)
    const maxSnippetChars = maxRaw === '' ? null : parsePositiveInteger(maxRaw)
    if (limitRaw !== '' && limit === null) {
      setError('limit 必须是正整数。')
      return
    }
    if (maxRaw !== '' && maxSnippetChars === null) {
      setError('maxSnippetChars 必须是正整数。')
      return
    }
    const ops: FirecrawlSettingsOp[] = []
    const apiKey = drafts.apiKey.trim()
    if (apiKey !== '') ops.push({ op: 'set', path: ['apiKey'], value: apiKey })
    if (baseURL !== '') ops.push({ op: 'set', path: ['baseURL'], value: baseURL })
    else ops.push({ op: 'unset', path: ['baseURL'] })
    if (limit === null) ops.push({ op: 'unset', path: ['limit'] })
    else ops.push({ op: 'set', path: ['limit'], value: limit })
    if (maxSnippetChars === null) ops.push({ op: 'unset', path: ['maxSnippetChars'] })
    else ops.push({ op: 'set', path: ['maxSnippetChars'], value: maxSnippetChars })
    if (ops.length === 0) return
    void applyOps(ops)
  }

  const clearKey = (): void => {
    void applyOps([{ op: 'unset', path: ['apiKey'] }])
  }

  if (status === 'loading') {
    return <div className={css.section}><p className={css.hint}>正在加载 Firecrawl 配置…</p></div>
  }
  if (status === 'unavailable') {
    return (
      <div className={css.section}>
        <p className={css.intro}>Firecrawl 搜索提供方的 API 密钥与请求参数。</p>
        <p className={css.error} role="alert">{error ?? '无法读取 Firecrawl 配置。'}</p>
      </div>
    )
  }

  return (
    <div className={css.section}>
      <p className={css.intro}>Firecrawl 搜索提供方的 API 密钥与请求参数。保存后立即生效。</p>

      <div className={css.card}>
        <div className={css.row}>
          <div className={css.rowText}>
            <label className={css.title} htmlFor="firecrawl-api-key">API Key</label>
            <span className={css.desc}>写入设置文档的密钥不会回显；留空保存表示保持当前值，未配置时回退 $FIRECRAWL_API_KEY，本地自托管可留空。</span>
          </div>
          <div className={css.control}>
            <Input
              id="firecrawl-api-key"
              type={showApiKey ? 'text' : 'password'}
              autoComplete="off"
              value={drafts.apiKey}
              placeholder={configured ? '已配置（留空保持不变）' : 'fc-...（本地可留空）'}
              disabled={disabled}
              onChange={event => { setDrafts({ ...drafts, apiKey: event.currentTarget.value }) }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={css.eyeButton}
              icon={<EyeIcon crossed={!showApiKey} />}
              aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
              title={showApiKey ? '隐藏 API Key' : '显示 API Key'}
              disabled={disabled}
              onClick={() => { setShowApiKey(previous => !previous) }}
            />
            <span className={configured ? css.badgeOn : css.badgeOff}>
              {configured ? '已配置' : '未配置'}
            </span>
            {configured && (
              <Button type="button" size="sm" disabled={disabled} onClick={clearKey}>清除</Button>
            )}
          </div>
        </div>

        <div className={css.row}>
          <div className={css.rowText}>
            <label className={css.title} htmlFor="firecrawl-base-url">Base URL</label>
            <span className={css.desc}>端点基址，搜索时追加 /v1/search（404 自动试 /v2/search）。本地自托管填 http://localhost:3002。</span>
          </div>
          <div className={css.control}>
            <Input
              id="firecrawl-base-url"
              type="text"
              value={drafts.baseURL}
              placeholder={FIRECRAWL_DEFAULT_BASE_URL}
              disabled={disabled}
              onChange={event => { setDrafts({ ...drafts, baseURL: event.currentTarget.value }) }}
            />
          </div>
        </div>

        <div className={css.row}>
          <div className={css.rowText}>
            <label className={css.title} htmlFor="firecrawl-limit">limit</label>
            <span className={css.desc}>请求未携带 maxResults 时的默认结果数；留空表示不发送。</span>
          </div>
          <div className={css.control}>
            <Input
              id="firecrawl-limit"
              type="text"
              inputMode="numeric"
              value={drafts.limit}
              placeholder="默认"
              disabled={disabled}
              onChange={event => { setDrafts({ ...drafts, limit: event.currentTarget.value }) }}
            />
          </div>
        </div>

        <div className={css.row}>
          <div className={css.rowText}>
            <label className={css.title} htmlFor="firecrawl-max-snippet-chars">maxSnippetChars</label>
            <span className={css.desc}>单个 description 映射为 snippet 时保留的字符上限。</span>
          </div>
          <div className={css.control}>
            <Input
              id="firecrawl-max-snippet-chars"
              type="text"
              inputMode="numeric"
              value={drafts.maxSnippetChars}
              placeholder={String(FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS)}
              disabled={disabled}
              onChange={event => { setDrafts({ ...drafts, maxSnippetChars: event.currentTarget.value }) }}
            />
          </div>
        </div>
      </div>

      {error !== null && <p className={css.error} role="alert">{error}</p>}
      {notice !== null && <p className={css.notice} role="status">{notice}</p>}

      <div className={css.actions}>
        <Button type="button" variant="primary" size="sm" disabled={disabled} onClick={save}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>
    </div>
  )
}
