import { describe, it, expect } from 'vitest'
import { safeJsonParse, safeExec } from '../src/lib/error-boundary'

describe('error-boundary', () => {
  describe('safeJsonParse', () => {
    it('parses valid JSON', () => {
      expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 })
    })

    it('returns null on invalid JSON', () => {
      expect(safeJsonParse('not json')).toBeNull()
      expect(safeJsonParse('')).toBeNull()
    })
  })

  describe('safeExec', () => {
    it('returns fn result when no error', () => {
      expect(safeExec(() => 42, -1, 'test')).toBe(42)
    })

    it('returns fallback when fn throws', () => {
      expect(
        safeExec(
          () => {
            throw new Error('boom')
          },
          -1,
          'test'
        )
      ).toBe(-1)
    })
  })
})
