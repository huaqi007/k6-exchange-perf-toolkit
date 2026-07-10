import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RateLimiter } from '../src/lib/rate-limiter'

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows up to maxTokens immediately then blocks', () => {
    const rl = new RateLimiter(3, 3, 1000)
    expect(rl.allow()).toBe(true)
    expect(rl.allow()).toBe(true)
    expect(rl.allow()).toBe(true)
    expect(rl.allow()).toBe(false)
  })

  it('refills tokens after the interval elapses', () => {
    const rl = new RateLimiter(2, 2, 1000)
    expect(rl.allow()).toBe(true)
    expect(rl.allow()).toBe(true)
    expect(rl.allow()).toBe(false)

    vi.advanceTimersByTime(1000)
    expect(rl.allow()).toBe(true)
    expect(rl.allow()).toBe(true)
    expect(rl.allow()).toBe(false)
  })

  it('does not exceed maxTokens on refill', () => {
    const rl = new RateLimiter(2, 5, 1000)
    rl.allow()
    vi.advanceTimersByTime(5000)
    let allowed = 0
    while (rl.allow()) allowed++
    expect(allowed).toBe(2)
  })
})
