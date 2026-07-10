/**
 * modules/json-rpc-client.ts — JSON-RPC 2.0 客户端
 *
 * 封装 HTTP POST 形式的 JSON-RPC 单条与批量调用，
 * 用于 M5 撮合引擎与 RPC 节点压测场景。
 */
import http from 'k6/http'
import { safeJsonParse } from '../lib/error-boundary'
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcBatchItem } from '../types/rpc'

/** 默认请求头 */
const JSON_RPC_HEADERS = { 'Content-Type': 'application/json' }

/**
 * 发送单条 JSON-RPC 2.0 请求。
 *
 * @param url    RPC 端点 URL
 * @param method RPC 方法名（如 "eth_call"）
 * @param params 方法参数数组
 * @param id     请求 ID（默认递增）
 * @returns k6 HTTP Response
 */
export function rpcCall(
  url: string,
  method: string,
  params: unknown[],
  id?: number
): http.Response {
  const requestId = id ?? Math.floor(Math.random() * 1000000)
  const body: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
    params,
    id: requestId,
  }
  return http.post(url, JSON.stringify(body), { headers: JSON_RPC_HEADERS })
}

/**
 * 发送批量 JSON-RPC 2.0 请求。
 *
 * 将多条 RPC 调用合并为一个 HTTP POST，减少网络往返。
 *
 * @param url   RPC 端点 URL
 * @param calls 批量调用条目数组
 * @returns k6 HTTP Response
 */
export function rpcBatchCall(
  url: string,
  calls: JsonRpcBatchItem[]
): http.Response {
  const body = calls.map((c, i) => ({
    jsonrpc: '2.0',
    method: c.method,
    params: c.params,
    id: i + 1,
  }))
  return http.post(url, JSON.stringify(body), { headers: JSON_RPC_HEADERS })
}

/**
 * 发送 RPC 调用并解析响应为通用对象。
 *
 * @returns 解析后的 RPC 响应对象，失败返回 null
 */
export function rpcCallJson(
  url: string,
  method: string,
  params: unknown[]
): JsonRpcResponse | null {
  const res = rpcCall(url, method, params)
  if (res.status !== 200) return null
  const json = safeJsonParse(res.body as string)
  return json as unknown as JsonRpcResponse | null
}
