import { describe, expect, it } from 'vitest'
import { TRUNCATED_MESSAGE } from '../src/support.ts'
import { formatDirectoryListing, formatFileView, parseViewRange } from '../src/peek.ts'

describe('parseViewRange', () => {
  it('returns undefined when omitted', () => {
    expect(parseViewRange(undefined, 10)).toBeUndefined()
  })

  it('slices a normal window', () => {
    expect(parseViewRange([3, 7], 10)).toEqual({ start: 3, end: 7 })
  })

  it('maps [start, -1] to the last line', () => {
    expect(parseViewRange([5, -1], 12)).toEqual({ start: 5, end: 12 })
  })

  it('rejects non-pair or non-integer ranges', () => {
    expect(() => parseViewRange([1], 10)).toThrow(/two integers/)
    expect(() => parseViewRange([1, 2, 3], 10)).toThrow(/two integers/)
    expect(() => parseViewRange([1.5, 3], 10)).toThrow(/two integers/)
  })

  it('rejects an out-of-range start', () => {
    expect(() => parseViewRange([0, 5], 10)).toThrow(/within the range/)
    expect(() => parseViewRange([11, 12], 10)).toThrow(/within the range/)
  })

  it('rejects an end beyond the file or before the start', () => {
    expect(() => parseViewRange([1, 11], 10)).toThrow(/smaller than the number of lines/)
    expect(() => parseViewRange([5, 4], 10)).toThrow(/larger or equal/)
  })
})

describe('formatFileView', () => {
  const content = 'one\ntwo\nthree\nfour'

  it('renders numbered lines with a total-line header', () => {
    const view = formatFileView('/repo/a.txt', content, 16000)
    expect(view.startLine).toBe(1)
    expect(view.endLine).toBe(4)
    expect(view.totalLines).toBe(4)
    expect(view.truncated).toBe(false)
    expect(view.content).toContain(`Here's the content of /repo/a.txt with line numbers (which has a total of 4 lines)`)
    expect(view.content).toContain('     1  one')
    expect(view.content).toContain('     4  four')
  })

  it('honors view_range and renumbers from the window start', () => {
    const view = formatFileView('/repo/a.txt', content, 16000, [2, 3])
    expect(view.startLine).toBe(2)
    expect(view.endLine).toBe(3)
    expect(view.totalLines).toBe(4)
    expect(view.content).toContain('     2  two')
    expect(view.content).toContain('     3  three')
    expect(view.content).not.toContain('one')
  })

  it('keeps leading zeros and padding for wide files', () => {
    const view = formatFileView('/repo/a.txt', 'x'.repeat(5000).split('').join('\n'), 200_000)
    expect(view.content).toContain(`${String(5000).padStart(6, ' ')}  x`)
  })

  it('clips long views with the standard notice', () => {
    const long = 'abcdefghij\n'.repeat(1000)
    const view = formatFileView('/repo/big.txt', long, 200)
    expect(view.truncated).toBe(true)
    expect(view.content.length).toBeLessThan(long.length)
    expect(view.content).toContain(TRUNCATED_MESSAGE)
  })
})

describe('formatDirectoryListing', () => {
  const entries = [
    { name: 'b.ts', type: 'file' as const, displayPath: 'f\t/repo/b.ts' },
    { name: 'a.ts', type: 'file' as const, displayPath: 'f\t/repo/a.ts' },
    { name: 'src', type: 'directory' as const, displayPath: 'd\t/repo/src' },
  ]

  it('sorts rows by path after the root row', () => {
    const { content } = formatDirectoryListing('/repo', [entries], 16000)
    const lines = content.split('\n')
    expect(lines[0]).toBe(`Here're the files and directories up to 2 levels deep in /repo, excluding hidden items, node_modules, and Python cache directories:`)
    const rows = content.slice(content.indexOf(':\n') + 2).trim().split('\n')
    expect(rows[0]).toBe('d\t/repo')
    expect(rows[1]).toBe('f\t/repo/a.ts')
    expect(rows[2]).toBe('f\t/repo/b.ts')
    expect(rows[3]).toBe('d\t/repo/src')
  })

  it('clips long listings with the standard notice', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      name: `f${i}.txt`,
      type: 'file' as const,
      displayPath: `f\t/repo/f${i}.txt`,
    }))
    const { content, truncated } = formatDirectoryListing('/repo', [many], 300)
    expect(truncated).toBe(true)
    expect(content).toContain(TRUNCATED_MESSAGE)
  })
})
