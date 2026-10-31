import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transform } from 'lightningcss'

const css = readFileSync(new URL('../src/client/FirecrawlSettingsSection.module.css', import.meta.url), 'utf8')

describe('plugin detail theme styling', () => {
  it('uses semantic theme colors for text, backgrounds, borders and feedback', () => {
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i)
    expect(css).not.toMatch(/--dsw-(?:text|line|brand)\b/)
    for (const token of [
      'label-primary', 'label-secondary', 'bg-layer-2', 'bg-layer-3',
      'border-l2', 'border-l4', 'state-success-primary',
      'state-success-tertiary', 'state-error-primary',
    ]) expect(css).toContain(`var(--dsw-alias-${token})`)
  })

  // Harness 0.2.1-rc.5 design-platform.css palettes, kept in both schemes.
  it.each([
    { mode: 'light', label: [15, 17, 21], surface: [255, 255, 255], successFill: [230, 250, 237] },
    { mode: 'dark', label: [249, 250, 251], surface: [44, 44, 46], successFill: [35, 60, 44] },
  ])('keeps success text readable in $mode mode', ({ label, surface, successFill }) => {
    const mix = css.match(/state-success-primary\) (\d+)%/)
    expect(mix).not.toBeNull()
    const weight = Number(mix![1]) / 100
    const green = [34, 197, 94]
    const text = green.map((value, index) => value * weight + label[index] * (1 - weight))
    const luminance = (rgb: readonly number[]) => rgb.reduce((sum, value, index) => {
      const channel = value / 255
      const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      return sum + linear * [0.2126, 0.7152, 0.0722][index]
    }, 0)
    for (const background of [surface, successFill]) {
      const levels = [luminance(text), luminance(background)].sort((a, b) => b - a)
      expect((levels[0] + 0.05) / (levels[1] + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('compiles scoped styles and stacks controls for narrow detail panes', () => {
    const result = transform({
      filename: 'FirecrawlSettingsSection.module.css', code: Buffer.from(css),
      cssModules: true, minify: true,
    })
    expect(result.warnings).toEqual([])
    expect(result.exports).toHaveProperty('keyControl')
    expect(result.exports).toHaveProperty('toggleRow')
    expect(css).toContain('container-type: inline-size')
    expect(css).toContain('@container (max-width: 560px)')
    expect(css).not.toMatch(/min-width:\s*260px/)
  })
})
