/**
 * Firecrawl configuration rendered inside its plugin detail page.
 *
 * The API key is write-only in the wire direction: the host schema marks it
 * `role('secret')`, so this page never receives the literal. It shows
 * whether a key is configured, accepts a replacement (blank = keep the
 * current key), and offers an explicit clear button. All commits apply live:
 * the host provider starts using the new values on the next search.
 */

import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the plugin manager owns the bundle configuration slot.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS,
} from '../settings-shared.ts'
import {
  FirecrawlSettingsApiError,
  isApiKeyConfigured,
  type FirecrawlSettingsApi,
  type FirecrawlSettingsOp,
  type FirecrawlSettingsView,
} from './api.ts'
import css from './FirecrawlSettingsSection.module.css'

/** Props the plugin manager binds for the bundle configuration. */
export type FirecrawlSettingsSectionProps = PropsRuntime<'plugins.bundle.config'> & { settingsApi: FirecrawlSettingsApi }

/** Local drafts for the four settings controls. */
interface Drafts {
  useFirecrawl: boolean
  apiKey: string
  baseURL: string
  limit: string
  maxSnippetChars: string
}

const INITIAL_DRAFTS: Drafts = {
  useFirecrawl: true,
  apiKey: '',
  baseURL: FIRECRAWL_DEFAULT_BASE_URL,
  limit: '',
  maxSnippetChars: String(FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS),
}

/** Read the redacted resolved value into editable draft strings. */
function draftsOf(view: FirecrawlSettingsView): Drafts {
  const value = view.value !== null && typeof view.value === 'object' ? view.value as Record<string, unknown> : {}
  return {
    useFirecrawl: typeof value.useFirecrawl === 'boolean' ? value.useFirecrawl : true,
    apiKey: '',
    baseURL: typeof value.baseURL === 'string' && value.baseURL.length > 0
      ? value.baseURL
      : FIRECRAWL_DEFAULT_BASE_URL,
    limit: typeof value.limit === 'number' ? String(value.limit) : '',
    maxSnippetChars: typeof value.maxSnippetChars === 'number'
      ? String(value.maxSnippetChars)
      : String(FIRECRAWL_DEFAULT_MAX_SNIPPET_CHARS),
  }
}

/** Parse a positive whole number, or return null for an invalid draft. */
function parsePositiveInteger(raw: string): number | null {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : null
}

/** Inline eye icon used by the API-key reveal toggle. */
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

/** Human-readable error copy for one settings-route failure. */
function messageOf(error: unknown): string {
  if (error instanceof FirecrawlSettingsApiError && error.code === 'settings/conflict') {
    return '设置已在其他窗口被修改，已重新载入；请再次保存。'
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * Render a summary or the Firecrawl configuration form.
 * @param props - the runtime share of a `plugins.bundle.config` entry.
 * @returns the section element tree.
 */
export function FirecrawlSettingsSection({ view, settingsApi }: FirecrawlSettingsSectionProps) {
  if (view === 'summary') return 'Firecrawl 搜索提供方的 API 密钥与请求参数。'
  return <FirecrawlSettingsForm settingsApi={settingsApi} />
}

/** Editable detail content; summary rendering never starts a settings read. */
function FirecrawlSettingsForm({ settingsApi }: { settingsApi: FirecrawlSettingsApi }) {
  const [view, setView] = useState<FirecrawlSettingsView | null>(null)
  const [drafts, setDrafts] = useState<Drafts>(INITIAL_DRAFTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await settingsApi.get()
      setView(next)
      setDrafts(draftsOf(next))
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setLoading(false)
    }
  }, [settingsApi])

  useEffect(() => {
    let cancelled = false
    void settingsApi.get().then((next) => {
      if (cancelled) return
      setView(next)
      setDrafts(draftsOf(next))
      setLoading(false)
    }).catch((caught) => {
      if (cancelled) return
      setError(messageOf(caught))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [settingsApi])

  const applyOps = async (ops: FirecrawlSettingsOp[]): Promise<void> => {
    if (view === null || view.writable === false) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const next = await settingsApi.mutate(ops, view.revision)
      setView(next)
      setDrafts({ ...draftsOf(next), apiKey: '' })
      setNotice('已保存，新配置立即用于下一次搜索。')
    } catch (caught) {
      setError(messageOf(caught))
      // A conflict means another surface committed since this page read the
      // revision; adopt the fresh redacted view so the next save can proceed.
      if (caught instanceof FirecrawlSettingsApiError && caught.code === 'settings/conflict') {
        try {
          const next = await settingsApi.get()
          setView(next)
          setDrafts(draftsOf(next))
        } catch (reloadError) {
          setError(messageOf(reloadError))
          setView(null)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  /** Persist the master switch immediately (the provider reads it live). */
  const toggleUseFirecrawl = (next: boolean): void => {
    setDrafts({ ...drafts, useFirecrawl: next })
    setError(null)
    setNotice(null)
    void applyOps([{ op: 'set', path: ['useFirecrawl'], value: next }])
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
    ops.push({ op: 'set', path: ['useFirecrawl'], value: drafts.useFirecrawl })
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

  const configured = view !== null && isApiKeyConfigured(view)
  const disabled = view === null || view.writable === false || saving

  if (loading) {
    return <div className={css.section}><p className={css.hint}>正在加载 Firecrawl 配置…</p></div>
  }
  if (view === null) {
    return (
      <div className={css.section}>
        <p className={css.intro}>Firecrawl 搜索提供方的 API 密钥与请求参数。</p>
        <p className={css.error} role="alert">{error ?? '无法读取 Firecrawl 配置。'}</p>
        <Button type="button" variant="primary" size="sm" onClick={() => { void load() }}>重试</Button>
      </div>
    )
  }

  return (
    <div className={css.section}>
      <p className={css.intro}>Firecrawl 搜索提供方的 API 密钥与请求参数。保存后立即生效。</p>

      <div className={css.card}>
        <div className={`${css.row} ${css.toggleRow}`}>
          <div className={css.rowText}>
            <span className={css.title}>使用 Firecrawl</span>
            <span className={css.desc}>关闭后切换到原版 DeepSeek 网页搜索，立即生效。</span>
          </div>
          <div className={css.control}>
            <Switch
              checked={drafts.useFirecrawl}
              disabled={disabled}
              label="使用 Firecrawl"
              onChange={toggleUseFirecrawl}
            />
          </div>
        </div>

        <div className={css.row}>
          <div className={css.rowText}>
            <label className={css.title} htmlFor="firecrawl-api-key">API Key</label>
            <span className={css.desc}>写入 profile 配置的密钥不会回显；留空保存表示保持当前值，未配置时回退 $FIRECRAWL_API_KEY。</span>
          </div>
          <div className={`${css.control} ${css.keyControl}`}>
            <Input
              className={css.input}
              id="firecrawl-api-key"
              type={showApiKey ? 'text' : 'password'}
              autoComplete="off"
              value={drafts.apiKey}
              placeholder={configured ? '已配置（留空保持不变）' : 'fc-...'}
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
            <span className={css.desc}>端点基址，搜索时追加 /v1/search。</span>
          </div>
          <div className={css.control}>
            <Input
              className={css.input}
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
              className={css.input}
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
              className={css.input}
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
