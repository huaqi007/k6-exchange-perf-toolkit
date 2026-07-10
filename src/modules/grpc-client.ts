/**
 * modules/grpc-client.ts — gRPC 连接复用封装
 *
 * k6 内置 gRPC 模块 (k6/net/grpc) 的二次封装：
 *  - init 阶段统一加载 proto 定义
 *  - VU 阶段按需 connect，支持 Unary 与 Server Streaming
 *
 * 注意:
 *  - grpc.Client 实例不可跨 VU 共享，需在 VU 代码中每次 new Client()
 *  - proto 文件在 init 阶段 load，编译后缓存于 VU 内存
 */
import grpc from 'k6/net/grpc'
import { sleep } from 'k6'
import { grpcCallCounter, grpcLatency, grpcStreamMsgCounter } from '../lib/metrics'
import { safeJsonParse } from '../lib/error-boundary'

/** 默认 proto 加载配置 */
const DEFAULT_PROTO_PATHS = ['./proto']
const DEFAULT_PROTO_FILES = ['exchange.proto']

/** gRPC 连接参数 */
export interface GrpcConnectParams {
  /** 是否使用明文连接（本地/local 测试为 true） */
  plaintext?: boolean
  /** 调用超时（如 "5s"） */
  timeout?: string
  /** 自定义 metadata */
  metadata?: Record<string, string>
  /** proto 文件所在目录列表（默认 ['./proto']） */
  protoPaths?: string[]
  /** proto 文件名列表（默认 ['exchange.proto']） */
  protoFiles?: string[]
}

/** gRPC Unary 调用参数 */
export interface GrpcInvokeParams {
  /** 方法完整路径，如 "exchange.OrderService/PlaceOrder" */
  method: string
  /** 请求消息体 */
  request: Record<string, unknown>
  /** 连接与超时参数 */
  options?: GrpcConnectParams
}

/**
 * 执行 gRPC Unary 调用。
 *
 * 每次调用在 VU 内部创建独立的 Client 实例并 load / connect / invoke / close。
 * proto 定义可通过 params.options.protoPaths / protoFiles 覆盖，默认加载
 * ./proto/exchange.proto。
 *
 * @param addr   gRPC 服务地址 (host:port)
 * @param params 调用参数
 * @returns 响应 JSON 对象；失败返回 null
 */
export function grpcUnaryInvoke(
  addr: string,
  params: GrpcInvokeParams
): Record<string, unknown> | null {
  const client = new grpc.Client()
  const protoPaths = params.options?.protoPaths ?? DEFAULT_PROTO_PATHS
  const protoFiles = params.options?.protoFiles ?? DEFAULT_PROTO_FILES
  client.load(protoPaths, ...protoFiles)

  const connectParams = {
    plaintext: params.options?.plaintext ?? true,
    timeout: params.options?.timeout ?? '5s',
  }

  try {
    client.connect(addr, connectParams)
    const start = Date.now()
    const response = client.invoke(params.method, params.request, {
      timeout: params.options?.timeout ?? '5s',
      metadata: params.options?.metadata || {},
    })
    const latency = Date.now() - start

    grpcCallCounter.add(1)
    grpcLatency.add(latency)

    client.close()
    return safeJsonParse(JSON.stringify(response.message))
  } catch (e) {
    console.error(`[gRPC] Invoke error (${params.method}): ${e}`)
    grpcCallCounter.add(1)
    try { client.close() } catch { /* ignore */ }
    return null
  }
}

/**
 * 执行 gRPC Server Streaming 订阅。
 *
 * 连接后持续接收服务器推送的消息，直到 durationMs 超时或主动断开。
 *
 * @param addr         gRPC 服务地址
 * @param method       方法完整路径
 * @param request      订阅请求
 * @param onData       每条消息的回调
 * @param durationMs   订阅持续时间 (ms)
 * @param options      连接与 proto 加载参数
 */
export function grpcStreamSubscribe(
  addr: string,
  method: string,
  request: Record<string, unknown>,
  onData: (msg: Record<string, unknown>) => void,
  durationMs: number = 10000,
  options?: GrpcConnectParams
): void {
  const client = new grpc.Client()
  const protoPaths = options?.protoPaths ?? DEFAULT_PROTO_PATHS
  const protoFiles = options?.protoFiles ?? DEFAULT_PROTO_FILES
  client.load(protoPaths, ...protoFiles)

  try {
    client.connect(addr, { plaintext: options?.plaintext ?? true })

    const stream = new grpc.Stream(client, method)
    stream.on('data', (data) => {
      grpcStreamMsgCounter.add(1)
      onData(data as Record<string, unknown>)
    })
    stream.on('error', (e) => {
      console.error(`[gRPC Stream] Error: ${JSON.stringify(e)}`)
    })
    stream.on('end', () => {
      console.log(`[gRPC Stream] Stream ended`)
    })

    stream.write(request)

    // 保持连接 durationMs 毫秒，通过 sleep 让出事件循环，
    // 使 stream 的 data/error/end 回调得以被调度处理。
    sleep(durationMs / 1000)

    stream.end()
    client.close()
  } catch (e) {
    console.error(`[gRPC Stream] Error: ${e}`)
    try { client.close() } catch { /* ignore */ }
  }
}

