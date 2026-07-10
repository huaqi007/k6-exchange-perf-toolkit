/**
 * lib/rate-limiter.ts — 客户端限频器
 *
 * 基于滑动窗口的本地令牌桶实现。
 * 在 VU 发起请求前调用 allow()，返回 false 时跳过本次请求，
 * 避免客户端侧超频被远端 429 误判为系统瓶颈。
 */
export class RateLimiter {
  /** 当前令牌数 */
  private tokens: number
  /** 上次补充令牌的时间戳 (ms) */
  private lastRefill: number

  /**
   * @param maxTokens      令牌桶容量
   * @param refillRate     每次补充的令牌数
   * @param refillIntervalMs 补充间隔 (ms)，默认 1000ms
   */
  constructor(
    private readonly maxTokens: number,
    private readonly refillRate: number,
    private readonly refillIntervalMs: number = 1000
  ) {
    this.tokens = maxTokens
    this.lastRefill = Date.now()
  }

  /** 检查并消耗一个令牌。有令牌返回 true，否则返回 false。 */
  allow(): boolean {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens -= 1
      return true
    }
    return false
  }

  /** 根据经过的时间自动补充令牌 */
  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const cycles = Math.floor(elapsed / this.refillIntervalMs)
    if (cycles > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + cycles * this.refillRate)
      this.lastRefill += cycles * this.refillIntervalMs
    }
  }
}
