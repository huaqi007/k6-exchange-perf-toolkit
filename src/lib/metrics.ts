import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * metrics.ts — 自定义 k6 指标
 * ============================================================================
 * Counter  : 只增不减的累加计数器（适合计数类指标）
 * Trend    : 统计分布（min/avg/max/p90/p95/p99，适合延迟类指标）
 * Rate     : 比率（适合成功率、RPS 达成率等）
 */

export const metrics = {
  // ── 下单相关 ──
  ordersPlaced: new Counter('orders_placed'),       // 成功下单总数
  orderLatency: new Trend('order_latency_ms', true), // 下单延迟（含 p90/p95/p99）
  orderErrors:  new Counter('order_errors'),         // 下单失败总数（业务错误）

  // ── Ticker 轮询相关 ──
  tickerLatency: new Trend('ticker_latency_ms'),     // Ticker 请求延迟
  tickerRequests: new Counter('ticker_requests'),    // Ticker 请求总数（含失败）

  // ── 健康检查相关 ──
  healthLatency: new Trend('health_latency_ms'),     // 健康检查延迟
  healthChecks:  new Counter('health_checks'),       // 健康检查请求总数

  // ── 可观测性 ──
  httpRetries:  new Counter('http_retries'),         // HTTP 重试总次数
  scriptErrors: new Counter('script_errors'),        // 脚本级异常总次数（JS 崩溃）
};
