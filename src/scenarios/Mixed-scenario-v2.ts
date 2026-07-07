/**
 * Mixed-scenario-v2.ts — 混合场景压测脚本（优化版）
 * ============================================================================
 * 场景：
 *   ticker_poll  — constant-arrival-rate 200 RPS（加权随机轮询多个交易对）
 *   order_flow   — ramping-arrival-rate 20→100→200 RPS（预签名下单）
 *   health_check — constant-vus 10 并发（健康检查）
 *
 * 优化点（相比旧版）：
 *   ✅ pollTicker 不再硬编码 BTC-USDT，改用 weightedRandomSymbol()
 *   ✅ isSuccess = false 时正确跳过后续 JSON 解析
 *   ✅ 每个场景统一记录请求计数 + 延迟
 *   ✅ ticker 新增 try-catch 解析 price 字段
 *   ✅ healthCheck 也走 safeGetWithRetry 重试链路
 */

import { sleep, check } from 'k6';
import { getBaseUrl } from '../config/env';
import { metrics } from '../lib/metrics';
import { safeGetWithRetry, safePostWithRetry } from '../error/error-boundary';
import { weightedRandomSymbol } from '../modules/order-generator';
import { preSignedOrders, getOrderBySymbol } from '../modules/pre-signer';

const BASE_URL = getBaseUrl();

// ============================================================================
// k6 场景配置
// ============================================================================
export const options = {
  scenarios: {
    ticker_poll: {
      executor: 'constant-arrival-rate',
      rate: 200,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 50,
      maxVUs: 100,
      exec: 'pollTicker',
    },
    order_flow: {
      executor: 'ramping-arrival-rate',
      startRate: 20,
      timeUnit: '1s',
      preAllocatedVUs: 30,
      maxVUs: 200,
      stages: [
        { target: 100, duration: '1m' },
        { target: 200, duration: '1m' },
        { target: 200, duration: '1m' },
      ],
      exec: 'placeOrder',
    },
    health_check: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      exec: 'healthCheck',
    },
  },

  // ============================================================================
  // ⚠️ k6 内置 thresholds 已移除，性能门禁统一由 CI workflow 的 Performance Gate 步骤执行
  // 避免 k6 内置阈值先触发退出码 99，导致 CI 门禁步骤被跳过
};

// ============================================================================
// 场景 A：Ticker 轮询（加权随机交易对）
// ============================================================================
export function pollTicker(): void {
  // ✅ 优化：按权重随机选交易对轮询（而非只查 BTC-USDT）
  const symbol = weightedRandomSymbol();

  // 🛡️ 第 1 层：安全 GET（指数退避重试 + try-catch）
  const res = safeGetWithRetry(`${BASE_URL}/api/v1/ticker/${symbol}`);

  // 重试耗尽 → 安全退出
  if (!res) return;

  // ✅ 无论成功失败都记录请求计数和延迟
  metrics.tickerRequests.add(1);
  metrics.tickerLatency.add(res.timings.duration);

  // 🛡️ 第 2 层：业务校验
  const isSuccess = check(res, {
    'Status is 200': (r) => r.status === 200,
    'No business error': (r) => {
      if (
        r.status === 400 &&
        r.body != null &&
        typeof r.body === 'string' &&
        r.body.includes('INSUFFICIENT_FUNDS')
      ) {
        metrics.orderErrors.add(1);
        return false;
      }
      return r.status === 200;
    },
  });

  // ✅ 优化：check 失败时不再继续解析 JSON（旧版会继续执行）
  if (!isSuccess) return;

  // 🛡️ 第 3 层：业务数据解析（try-catch 兜底）
  try {
    const price = res.json('price');
    // price 可用于自定义阈值判断等
    void price;
  } catch (e) {
    metrics.scriptErrors.add(1);
    console.error(`[pollTicker] JSON 解析失败: ${e}`);
  }
}

// ============================================================================
// 场景 B：下单（预签名 + 加权随机 + 安全 POST）
// ============================================================================
export function placeOrder(): void {
  // ── 1. 加权随机选交易对（BTC 40% / ETH 30% / 其余均分）──
  const symbol = weightedRandomSymbol();

  // ── 2. 从预签名池按 symbol 取订单 ──
  let signed = getOrderBySymbol(symbol);
  if (!signed) {
    // 降级：该 symbol 无预签名订单 → 全局随机取
    signed = preSignedOrders[Math.floor(Math.random() * preSignedOrders.length)];
  }

  // ── 3. 组装签名头 ──
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key':    signed.apiKey,
    'X-Timestamp':  String(signed.timestamp),
    'X-Signature':  signed.signature,
  };

  // ── 4. 安全 POST（指数退避 + try-catch）──
  const res = safePostWithRetry(
    `${BASE_URL}/api/v1/order`,
    signed.body,
    { headers },
  );

  if (!res) return;

  // ── 5. 业务校验 ──
  const isSuccess = check(res, {
    'Order status 2xx': (r) => r.status === 200 || r.status === 201,
    'No business error': (r) => {
      if (r.status === 400) {
        try {
          const body = r.json();
          if (
            body &&
            typeof body === 'object' &&
            'code' in body &&
            (body as any).code === 'INSUFFICIENT_FUNDS'
          ) {
            metrics.orderErrors.add(1);
            return false;
          }
        } catch (_) { /* JSON 解析失败，继续正常判断 */ }
      }
      return r.status === 200 || r.status === 201;
    },
  });

  // ── 6. 指标 ──
  if (isSuccess) {
    metrics.ordersPlaced.add(1);
  } else {
    metrics.orderErrors.add(1);
  }
  metrics.orderLatency.add(res.timings.duration);

  // ── 7. 响应解析（try-catch 兜底）──
  try {
    const _body = res.json(); // { orderId, status, filledQty }
    void _body;
  } catch (e) {
    metrics.scriptErrors.add(1);
    console.error(`[placeOrder] JSON 解析失败: ${e}`);
  }
}

// ============================================================================
// 场景 C：健康检查
// ============================================================================
export function healthCheck(): void {
  const res = safeGetWithRetry(`${BASE_URL}/api/v1/health`);

  if (!res) return;

  metrics.healthChecks.add(1);
  metrics.healthLatency.add(res.timings.duration);

  check(res, { 'Health check 200': (r) => r.status === 200 });
}
