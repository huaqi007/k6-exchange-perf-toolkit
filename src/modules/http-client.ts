/**
 * modules/http-client.ts — HTTP 客户端封装
 *
 * 在 k6 http 模块之上提供指数退避重试能力。
 * 所有 HTTP 请求统一经过此模块，便于集中插桩日志与指标。
 */
import http from 'k6/http'
import { sleep } from 'k6'
import { Counter } from 'k6/metrics'
import { safeJsonParse } from '../lib/error-boundary'

/** 重试次数计数器 */
const httpRetryCounter = new Counter('http_retries')

/** 重试配置 */
export interface RetryConfig {
  /** 最大重试次数（不含首次） */
  maxRetries: number
  /** 基础退避延迟 (ms)，实际延迟按指数退避 baseDelay * 2^attempt */
  baseDelay: number
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelay: 100,
}

/** 指数退避 sleep：baseDelay * 2^attempt (ms) + jitter */
function backoff(retryConfig: RetryConfig, attempt: number): void {
  const delay = retryConfig.baseDelay * Math.pow(2, attempt)
  const jitter = Math.random() * retryConfig.baseDelay
  sleep((delay + jitter) / 1000)
}

/**
 * GET 请求（含指数退避重试）。
 *
 * 非 5xx / 429 立即返回；5xx / 429 退避后重试，最大 maxRetries 次。
 */
export function safeGet(
  url: string,
  params?: Record<string, unknown>,
  retryConfig: RetryConfig = DEFAULT_RETRY
): http.Response {
  let lastResponse: http.Response | null = null

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    lastResponse = http.get(url, params)
    if (lastResponse.status < 500 && lastResponse.status !== 429) {
      return lastResponse
    }
    if (attempt < retryConfig.maxRetries) {
      httpRetryCounter.add(1)
      backoff(retryConfig, attempt)
    }
  }
  return lastResponse!
}

/**
 * POST 请求（含指数退避重试）。
 *
 * @param body 请求体（对象，内部序列化为 JSON）
 */
export function safePost(
  url: string,
  body: Record<string, unknown>,
  params?: Record<string, unknown>,
  retryConfig: RetryConfig = DEFAULT_RETRY
): http.Response {
  let lastResponse: http.Response | null = null
  const payload = JSON.stringify(body)
  const mergedParams = {
    ...(params || {}),
    headers: {
      'Content-Type': 'application/json',
      ...(params?.headers as Record<string, string> || {}),
    },
  }

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    lastResponse = http.post(url, payload, mergedParams)
    if (lastResponse.status < 500 && lastResponse.status !== 429) {
      return lastResponse
    }
    if (attempt < retryConfig.maxRetries) {
      httpRetryCounter.add(1)
      backoff(retryConfig, attempt)
    }
  }
  return lastResponse!
}

/**
 * GET 请求，并解析 JSON 响应体。
 */
export function fetchJson(
  url: string,
  params?: Record<string, unknown>
): Record<string, unknown> | null {
  const res = safeGet(url, params)
  if (res.status !== 200) return null
  return safeJsonParse(res.body as string)
}
