/**
 * pre-signer.ts — 预签名订单模块（优化版）
 * ============================================================================
 * 关键优化：
 *   1. 时间戳间隔从 1000ms → 50ms，1000 条订单仅覆盖 50 秒窗口
 *      （避免因 timestamp 离当前时间太远被服务端拒绝）
 *   2. 新增 ordersBySymbol 索引映射 → getOrderBySymbol() O(1) 查找
 *   3. 路径统一为 /api/v1/order（与 scenarios 中一致）
 */

import { SharedArray } from 'k6/data';
import crypto from 'k6/crypto';

// ============================================================================
// 类型
// ============================================================================
export interface PreSignedOrder {
  apiKey: string;
  timestamp: number;
  signature: string;
  body: string;
}

// ============================================================================
// 预签名订单 SharedArray
// ============================================================================
export const preSignedOrders = new SharedArray<PreSignedOrder>(
  'preSigned',
  (): PreSignedOrder[] => {
    const orders = JSON.parse(open('./data/orders.json'));
    const startTime = Date.now();

    return orders.map((order: any, i: number) => {
      const body = JSON.stringify(order);

      // ✅ 优化：每条时间戳偏移 50ms（而非 1000ms）
      // 1000 条 × 50ms = 50 秒覆盖窗口，远小于典型服务端 2~5 分钟的时间戳容差
      const timestamp = startTime + i * 50;

      // 签名 payload 格式：timestamp + METHOD + path + body
      // 路径必须与实际请求路径一致！
      const signPayload = timestamp + 'POST/api/v1/order' + body;
      const signature = crypto.hmac('sha256', 'test-secret', signPayload, 'hex');

      return { apiKey: 'test-key', timestamp, signature, body };
    });
  },
);

// ============================================================================
// 按交易对索引（init context 预计算）
// ============================================================================
export const ordersBySymbol: Record<string, number[]> = (() => {
  const map: Record<string, number[]> = {};

  for (let i = 0; i < preSignedOrders.length; i++) {
    try {
      const parsed = JSON.parse(preSignedOrders[i].body);
      const sym: string = parsed.symbol;
      if (!map[sym]) map[sym] = [];
      map[sym].push(i);
    } catch (_) { /* body 格式异常时跳过 */ }
  }

  return map;
})();

/**
 * 根据交易对获取一条随机预签名订单
 * 用于配合 weightedRandomSymbol() 实现精确的 40%/30%/... 权重分布
 */
export function getOrderBySymbol(symbol: string): PreSignedOrder | null {
  const indices = ordersBySymbol[symbol];
  if (!indices || indices.length === 0) return null;
  const idx = indices[Math.floor(Math.random() * indices.length)];
  return preSignedOrders[idx];
}
