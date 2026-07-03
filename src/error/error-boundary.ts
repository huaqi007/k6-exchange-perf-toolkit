/**
 * error-boundary.ts — 指数退避重试 + try-catch 错误边界
 * ============================================================================
 * 职责：
 *   1. 提供 safeGetWithRetry / safePostWithRetry 两个安全的 HTTP 请求封装
 *   2. 对网络异常 + 5xx 自动重试（4xx 不重试，属于业务错误）
 *   3. 指数退避 + 随机抖动（避免惊群效应 / thundering herd）
 *   4. 最外层 try-catch 兜底 —— 确保任何未预期的 JS 异常都不会让整个 VU 崩溃
 *   5. 统一的指标上报：重试次数、脚本错误次数
 *
 * 重试策略：
 *   延迟 = min(baseDelay × 2^attempt + jitter, maxDelayMax)
 *   jitter 范围 = ±25%（随机抖动，分散重试时间点）
 *   attempt 0 = 首次尝试（不延迟）
 *   attempt 1 = ~500ms 后首次重试
 *   attempt 2 = ~1000ms 后二次重试
 *   attempt 3 = ~2000ms 后三次重试（最后一次）
 */

import http, { RefinedResponse, ResponseType } from 'k6/http';
import { sleep } from 'k6';
import { metrics } from '../lib/metrics';

// ============================================================================
// 重试配置常量
// ============================================================================
const RETRY_CONFIG = {
  maxRetries: 3,        // 最大重试次数（不含首次请求，即总共最多 4 次尝试）
  baseDelayMs: 500,     // 基础退避延迟（毫秒）
  maxDelayMs: 10000,    // 退避延迟上限（毫秒），防止无限增长
  // 哪些 HTTP 状态码触发重试：
  //   0   = 网络错误（连接拒绝、DNS 失败、超时等）
  //   429 = 被限流（Too Many Requests）
  //   5xx = 服务端临时故障
  retryOnStatus: [0, 429, 500, 502, 503, 504],
};

// ============================================================================
// 指数退避计算
// ============================================================================

/**
 * 计算第 N 次重试的等待时间（毫秒）
 *
 * 公式：min(baseDelay × 2^attempt × [0.75 ~ 1.25], maxDelayMs)
 *
 * 为什么加抖动（jitter）？
 * - 不加抖动：1000 个 VU 同时失败 → 全部等 500ms → 同时重试 → 再次压垮服务
 * - 加 ±25% 抖动：1000 个 VU 分散在 375ms~625ms 之间 → 负载平滑分散
 *
 * @param attempt - 当前重试次数（0-based，0 = 首次重试）
 * @returns 等待时间（毫秒）
 */
function calcBackoff(attempt: number): number {
  // 指数增长：500 → 1000 → 2000 → 4000（第 4 次会被 maxDelayMs 截断到 10000）
  const exponential = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);

  // 随机抖动系数：0.75 ~ 1.25（即 ±25%）
  // Math.random() 返回 [0, 1)，所以 0.75 + Math.random() * 0.5 返回 [0.75, 1.25)
  const jitterFactor = 0.75 + Math.random() * 0.5;
  const withJitter = exponential * jitterFactor;

  return Math.min(withJitter, RETRY_CONFIG.maxDelayMs);
}

// ============================================================================
// 安全 POST 请求（带指数退避重试 + try-catch 边界）
// ============================================================================

/**
 * 安全的 POST 请求封装
 *
 * 特性：
 * - 网络层异常（catch 捕获）→ 自动重试
 * - HTTP 5xx / 429 / 0 → 自动重试
 * - HTTP 4xx（如 400 参数错误、401 未授权）→ 不重试，直接返回（业务逻辑错误不应重试）
 * - 全部重试耗尽 → 返回 null（调用方检查 null 后跳过后续处理）
 *
 * 使用示例：
 * ```typescript
 * const res = safePostWithRetry(url, body, { headers: { 'X-Key': 'xxx' } });
 * if (!res) return; // 所有重试失败，安全退出
 * // 正常处理 res...
 * ```
 *
 * @param url    - 请求 URL
 * @param body   - 请求体（JSON 字符串或对象）
 * @param params - k6 http 参数对象（headers, tags 等）
 * @returns 响应对象，或 null（全部重试失败/脚本异常）
 */
export function safePostWithRetry(
  url: string,
  body: string | object,
  params?: { headers?: Record<string, string>; tags?: Record<string, string> },
): RefinedResponse<ResponseType> | null {
  // 如果 body 是对象，序列化为 JSON 字符串
  const payload = typeof body === 'string' ? body : JSON.stringify(body);

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      // === 发起 HTTP POST 请求 ===
      const res = http.post(url, payload, params as any);

      // === 判断是否需要重试 ===
      // 只有状态码在重试列表中，且还有剩余重试次数时才重试
      if (
        RETRY_CONFIG.retryOnStatus.indexOf(res.status) !== -1 &&
        attempt < RETRY_CONFIG.maxRetries
      ) {
        metrics.httpRetries.add(1); // 记录重试次数指标
        const delayMs = calcBackoff(attempt);
        console.warn(
          `[safePostWithRetry] HTTP ${res.status}，第 ${attempt + 1}/${RETRY_CONFIG.maxRetries} 次重试，等待 ${Math.round(delayMs)}ms`,
        );
        sleep(delayMs / 1000); // k6 sleep 单位是秒
        continue; // 进入下一次重试循环
      }

      // 成功（2xx）或不可重试的错误（4xx），直接返回
      return res;
    } catch (e) {
      // === try-catch 错误边界：捕获 JS 层面的任何崩溃 ===
      // 可能的原因：网络超时、DNS 解析失败、TLS 握手失败等
      metrics.scriptErrors.add(1); // 记录脚本异常指标

      if (attempt < RETRY_CONFIG.maxRetries) {
        metrics.httpRetries.add(1);
        const delayMs = calcBackoff(attempt);
        console.warn(
          `[safePostWithRetry] 请求异常: ${e}，第 ${attempt + 1}/${RETRY_CONFIG.maxRetries} 次重试，等待 ${Math.round(delayMs)}ms`,
        );
        sleep(delayMs / 1000);
        // 继续重试
      } else {
        // 所有重试都已耗尽 —— 这是最后一道防线，确保不崩 VU
        console.error(
          `[safePostWithRetry] 所有 ${RETRY_CONFIG.maxRetries} 次重试已耗尽，放弃请求: ${e}`,
        );
        return null; // 安全返回 null，让调用方跳过本次迭代
      }
    }
  }

  // 理论上不会走到这里（循环内已处理所有分支），但作为兜底
  return null;
}

// ============================================================================
// 安全 GET 请求（带指数退避重试 + try-catch 边界）
// ============================================================================

/**
 * 安全的 GET 请求封装
 *
 * 与 safePostWithRetry 使用相同的重试策略和错误边界。
 * 适用于 ticker 轮询、健康检查等读操作。
 *
 * @param url    - 请求 URL
 * @param params - k6 http 参数对象（headers, tags 等）
 * @returns 响应对象，或 null（全部重试失败/脚本异常）
 */
export function safeGetWithRetry(
  url: string,
  params?: { headers?: Record<string, string>; tags?: Record<string, string> },
): RefinedResponse<ResponseType> | null {
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const res = http.get(url, params as any);

      // 判断是否需要重试
      if (
        RETRY_CONFIG.retryOnStatus.indexOf(res.status) !== -1 &&
        attempt < RETRY_CONFIG.maxRetries
      ) {
        metrics.httpRetries.add(1);
        const delayMs = calcBackoff(attempt);
        console.warn(
          `[safeGetWithRetry] HTTP ${res.status}，第 ${attempt + 1}/${RETRY_CONFIG.maxRetries} 次重试，等待 ${Math.round(delayMs)}ms`,
        );
        sleep(delayMs / 1000);
        continue;
      }

      return res;
    } catch (e) {
      // try-catch 错误边界：防止脚本崩溃
      metrics.scriptErrors.add(1);

      if (attempt < RETRY_CONFIG.maxRetries) {
        metrics.httpRetries.add(1);
        const delayMs = calcBackoff(attempt);
        console.warn(
          `[safeGetWithRetry] 请求异常: ${e}，第 ${attempt + 1}/${RETRY_CONFIG.maxRetries} 次重试，等待 ${Math.round(delayMs)}ms`,
        );
        sleep(delayMs / 1000);
      } else {
        console.error(
          `[safeGetWithRetry] 所有 ${RETRY_CONFIG.maxRetries} 次重试已耗尽，放弃请求: ${e}`,
        );
        return null;
      }
    }
  }

  return null;
}
