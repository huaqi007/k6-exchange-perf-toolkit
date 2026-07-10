/**
 * lib/metrics.ts — 自定义 k6 指标统一定义
 *
 * 所有场景共用的 Counter / Trend / Rate 指标集中声明于此，
 * 避免各模块重复创建同名的 k6 指标对象。
 *
 * 指标命名规范: 遵循 snake_case，前缀按协议/模块划分。
 */
import { Counter, Trend, Rate } from 'k6/metrics'

/* ---- HTTP / Order ---- */
/** 已下单总数 (Counter 单调递增) */
export const orderCounter = new Counter('orders_placed')
/** 订单请求延迟 (ms) */
export const orderLatency = new Trend('order_latency_ms')
/** 订单请求失败率 (5xx / 超时) */
export const orderErrorRate = new Rate('order_error_rate')

/* ---- WebSocket ---- */
/** 收到的 WS 消息总数 */
export const wsMessageCounter = new Counter('ws_messages_received')
/** WS 重连次数 */
export const wsReconnectCounter = new Counter('ws_reconnects')
/** WS 建连延迟 (ms) */
export const wsConnectLatency = new Trend('ws_connect_latency')

/* ---- gRPC ---- */
/** gRPC 调用次数 */
export const grpcCallCounter = new Counter('grpc_calls')
/** gRPC 调用延迟 (ms) */
export const grpcLatency = new Trend('grpc_latency_ms')
/** gRPC 流式消息接收总数 */
export const grpcStreamMsgCounter = new Counter('grpc_stream_msgs')

/* ---- JSON-RPC ---- */
/** RPC 调用次数 */
export const rpcCallCounter = new Counter('rpc_calls')
/** RPC 调用延迟 (ms) */
export const rpcLatency = new Trend('rpc_latency_ms')

/* ---- 横切 ---- */
/** 自定义错误率 (业务异常 / 断言失败) */
export const customErrors = new Rate('custom_errors')
/** 匹配引擎处理延迟 (ms) */
export const matchingLatency = new Trend('matching_latency_ms')
