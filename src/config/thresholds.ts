/**
 * config/thresholds.ts — 性能门禁阈值配置（集中管理）
 *
 * 所有场景的阈值统一在此定义，场景文件通过 import 组合所需的阈值分组，
 * 避免阈值分散在各 scenario 文件中导致修改遗漏。
 *
 * k6 阈值表达式语法:
 *   p(95)<300     — 95 分位小于 300ms
 *   rate<0.01     — 失败率小于 1%
 *   count>0       — 至少有一次通过
 *
 * 用法示例:
 *   import { buildThresholds } from '../config/thresholds'
 *   export const options = {
 *     thresholds: buildThresholds(['http', 'order']),
 *   }
 *
 * 严格模式（发版审批）通过 __ENV.STRICT=1 启用。
 */

/** k6 阈值映射（metric 名 -> 表达式数组） */
export type Thresholds = Record<string, string[]>

/** 可组合的阈值分组名 */
export type ThresholdGroup = 'http' | 'ws' | 'grpc' | 'order' | 'rpc' | 'custom'

/** 常规门禁：适用于日常回归测试 */
const defaultGroups: Record<ThresholdGroup, Thresholds> = {
  http: {
    http_req_duration: ['p(95)<300', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
  },
  ws: {
    ws_connect_latency: ['p(95)<200'],
  },
  grpc: {
    grpc_req_duration: ['p(95)<300'],
    grpc_latency_ms: ['p(95)<300'],
  },
  order: {
    order_latency_ms: ['p(95)<300'],
    order_error_rate: ['rate<0.05'],
  },
  rpc: {
    rpc_latency_ms: ['p(95)<300'],
  },
  custom: {
    custom_errors: ['rate<0.05'],
  },
}

/** 严格门禁：适用于发版前的性能审批 */
const strictGroups: Record<ThresholdGroup, Thresholds> = {
  http: {
    http_req_duration: ['p(95)<200', 'p(99)<350'],
    http_req_failed: ['rate<0.005'],
  },
  ws: {
    ws_connect_latency: ['p(95)<150'],
  },
  grpc: {
    grpc_req_duration: ['p(95)<200'],
    grpc_latency_ms: ['p(95)<200'],
  },
  order: {
    order_latency_ms: ['p(95)<200'],
    order_error_rate: ['rate<0.02'],
  },
  rpc: {
    rpc_latency_ms: ['p(95)<200'],
  },
  custom: {
    custom_errors: ['rate<0.02'],
  },
}

/**
 * 组合指定分组的阈值。
 *
 * @param groups 需要的阈值分组
 * @param strict 是否使用严格门禁（默认读取 __ENV.STRICT）
 */
export function buildThresholds(groups: ThresholdGroup[], strict?: boolean): Thresholds {
  const useStrict = strict ?? (typeof __ENV !== 'undefined' && __ENV.STRICT === '1')
  const source = useStrict ? strictGroups : defaultGroups
  const result: Thresholds = {}
  for (const group of groups) {
    Object.assign(result, source[group])
  }
  return result
}

/** 常规完整门禁（所有分组） */
export const defaultThresholds: Thresholds = buildThresholds(
  ['http', 'ws', 'grpc', 'order', 'rpc', 'custom'],
  false
)

/** 严格完整门禁（所有分组） */
export const strictThresholds: Thresholds = buildThresholds(
  ['http', 'ws', 'grpc', 'order', 'rpc', 'custom'],
  true
)
