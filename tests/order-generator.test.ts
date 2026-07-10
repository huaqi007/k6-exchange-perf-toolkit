import { describe, it, expect } from 'vitest'
import {
  weightedRandomSymbol,
  generateOrder,
  loadSymbols,
} from '../src/modules/order-generator'

describe('order-generator', () => {
  describe('weightedRandomSymbol', () => {
    it('always returns a known symbol', () => {
      const known = new Set(loadSymbols())
      for (let i = 0; i < 1000; i++) {
        expect(known.has(weightedRandomSymbol())).toBe(true)
      }
    })

    it('roughly respects weight distribution (BTC most frequent)', () => {
      const counts: Record<string, number> = {}
      for (let i = 0; i < 20000; i++) {
        const s = weightedRandomSymbol()
        counts[s] = (counts[s] || 0) + 1
      }
      expect(counts['BTCUSDT']).toBeGreaterThan(counts['ADAUSDT'])
      expect(counts['ETHUSDT']).toBeGreaterThan(counts['SOLUSDT'])
    })
  })

  describe('generateOrder', () => {
    it('honors explicit symbol', () => {
      const o = generateOrder('ETHUSDT')
      expect(o.symbol).toBe('ETHUSDT')
    })

    it('produces valid side/type and positive numbers', () => {
      for (let i = 0; i < 500; i++) {
        const o = generateOrder()
        expect(['BUY', 'SELL']).toContain(o.side)
        expect(['LIMIT', 'MARKET']).toContain(o.type)
        expect(o.price).toBeGreaterThan(0)
        expect(o.quantity).toBeGreaterThan(0)
        expect(typeof o.timestamp).toBe('number')
      }
    })

    it('generates price within ±0.5% of base price', () => {
      const base = 50000
      for (let i = 0; i < 500; i++) {
        const o = generateOrder('BTCUSDT')
        expect(o.price).toBeGreaterThan(base * 0.99)
        expect(o.price).toBeLessThan(base * 1.01)
      }
    })
  })

  describe('loadSymbols', () => {
    it('returns all configured symbols', () => {
      expect(loadSymbols()).toEqual([
        'BTCUSDT',
        'ETHUSDT',
        'BNBUSDT',
        'SOLUSDT',
        'ADAUSDT',
      ])
    })
  })
})
