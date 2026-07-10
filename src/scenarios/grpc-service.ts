/**
 * scenarios/grpc-service.ts — gRPC 服务压测 [M6]
 *
 * 同时测试 gRPC Unary (PlaceOrder) 与 Server Streaming (SubscribeOrders)。
 * 使用 k6 内置 grpc 模块。
 *
 * 入口: k6 run dist/grpc-service.js
 */
import grpc from 'k6/net/grpc'
import { check, sleep } from 'k6'
import { getEnv } from '../config/environments'
import { generateOrder } from '../modules/order-generator'
import { buildThresholds } from '../config/thresholds'
import {
  grpcCallCounter,
  grpcLatency,
  grpcStreamMsgCounter,
} from '../lib/metrics'

const env = getEnv()

// proto 定义在 init 阶段由 webpack copy 时保证 dist/proto 存在，k6 运行目录 = dist/
// 这里假设 k6 在项目根目录运行，proto 文件位于 ./proto/exchange.proto
const PROTO_PATHS = ['./proto']
const PROTO_FILES = ['exchange.proto']

export const options = {
  scenarios: {
    unary_order: {
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 15,
      maxVUs: 60,
      exec: 'placeOrderUnary',
    },
    stream_orders: {
      executor: 'constant-vus',
      vus: 10,
      duration: '60s',
      exec: 'subscribeOrdersStream',
    },
  },
  thresholds: buildThresholds(['grpc']),
}

/** gRPC PlaceOrder Unary 调用 */
export function placeOrderUnary(): void {
  const client = new grpc.Client()
  client.load(PROTO_PATHS, ...PROTO_FILES)

  const order = generateOrder()
  const request = {
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    price: order.price,
    quantity: order.quantity,
  }

  try {
    client.connect(env.grpcUrl, { plaintext: true })
    const start = Date.now()
    const response = client.invoke(
      'exchange.OrderService/PlaceOrder',
      request,
      { timeout: '5s' }
    )
    const latency = Date.now() - start

    grpcCallCounter.add(1)
    grpcLatency.add(latency)

    check(response, {
      'PlaceOrder success': (r) => r.status === grpc.StatusOK,
    })
    client.close()
  } catch (e) {
    console.error(`[gRPC PlaceOrder] Error: ${e}`)
    grpcCallCounter.add(1)
    try { client.close() } catch { /* ignore */ }
  }
}

/** gRPC SubscribeOrders Server Streaming 订阅 */
export function subscribeOrdersStream(): void {
  const client = new grpc.Client()
  client.load(PROTO_PATHS, ...PROTO_FILES)

  try {
    client.connect(env.grpcUrl, { plaintext: true })

    const stream = new grpc.Stream(client, 'exchange.OrderService/SubscribeOrders')
    stream.on('data', () => {
      grpcStreamMsgCounter.add(1)
    })
    stream.on('error', (e: unknown) => {
      console.error(`[gRPC Stream] Error: ${JSON.stringify(e)}`)
    })
    stream.on('end', () => {
      console.log('[gRPC Stream] Stream ended')
    })

    stream.write({ symbol: 'BTCUSDT' })

    // 保持订阅 30 秒
    sleep(30)

    stream.end()
    client.close()
  } catch (e) {
    console.error(`[gRPC Stream] Error: ${e}`)
    try { client.close() } catch { /* ignore */ }
  }
}
