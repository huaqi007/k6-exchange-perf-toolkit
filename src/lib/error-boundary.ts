/**
 * lib/error-boundary.ts — 错误边界
 *
 * 包装一段可能抛出异常的执行逻辑，确保任何异常都不会导致 k6 VU 崩溃退出。
 * 异常发生时自动记录到 customErrors 指标中。
 */
import { customErrors } from './metrics'

/**
 * 安全执行同步函数。
 *
 * @param fn      要执行的函数
 * @param fallback 异常时返回的默认值
 * @param context 用于日志的上下文标签
 * @returns 正常时返回 fn() 的结果，异常时返回 fallback
 */
export function safeExec<T>(fn: () => T, fallback: T, context: string): T {
  try {
    return fn()
  } catch (e) {
    console.error(`[ERROR] ${context}: ${e}`)
    customErrors.add(1)
    return fallback
  }
}

/**
 * 安全解析 JSON 字符串。
 *
 * k6 中无原生 Promise/async，所有 JSON 解析走此函数统一兜底。
 *
 * @param raw 原始 JSON 字符串
 * @returns 解析后的对象；解析失败返回 null
 */
export function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    customErrors.add(1)
    return null
  }
}
