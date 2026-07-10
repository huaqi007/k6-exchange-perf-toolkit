/**
 * scenarios/e2e-trading.ts — 全链路端到端交易压测 [整合]
 *
 * 模拟完整的交易流程:
 *   1. WebSocket 看盘 (订阅深度数据)
 *   2. HTTP 下单 (POST /api/v1/order)
 *   3. gRPC 上链 (PlaceOrder + SubscribeOrders)
 *
 * 三个子场景在同一个测试中并发执行。
 *
 * 入口: k6 run dist/e2e-trading.js
 */
import grpc from 'k6/net/grpc'
import { check, sleep } from 'k6'
import { getEnv } from '../config/environments'
import { generateOrder } from '../modules/order-generator'
import { safePost } from '../modules/http-client'
import { connectWithRetry } from '../modules/ws-reconnect'
import { buildThresholds } from '../config/thresholds'
import { safeJsonParse } from '../lib/error-boundary'
import {
  orderCounter,
  orderLatency,
  orderErrorRate,
  grpcCallCounter,
  grpcLatency,
} from '../lib/metrics'

const env = getEnv()

export const options = {
  scenarios: {
    http_orders: {
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 10,
      maxVUs: 50,
      exec: 'httpOrderStep',
    },
    ws_depth: {
      executor: 'constant-vus',
      vus: 100,
      duration: '60s',
      exec: 'wsDepthStep',
    },
    grpc_flow: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 5,
      maxVUs: 30,
      exec: 'grpcOrderStep',
    },
  },
  thresholds: buildThresholds(['http', 'grpc', 'order']),
}

/** Step 1: HTTP 下单 */
export function httpOrderStep(): void {
  const order = generateOrder()
  const start = Date.now()

  const res = safePost(`${env.restBaseUrl}/api/v1/order`, {
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    price: order.price,
    quantity: order.quantity,
  })

  const latency = Date.now() - start
  const json = safeJsonParse(res.body as string)

  check(res, {
    'order 200': (r) => r.status === 200,
    'has orderId': () => !!(json && json.orderId),
  })

  orderCounter.add(1)
  orderLatency.add(latency)
  orderErrorRate.add(res.status >= 400 ? 1 : 0)

  sleep(0.3)
}

/** Step 2: WebSocket 看盘 */
export function wsDepthStep(): void {
  connectWithRetry({
    url: env.wsUrl,
    maxReconnects: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    onOpen: (socket) => {
      socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['btcusdt@depth'] }))
      socket.setInterval(() => socket.ping(), 30000)
    },
  })
}

/** Step 3: gRPC 订单上链 */
export function grpcOrderStep(): void {
  const client = new grpc.Client()
  client.load(['./proto'], 'exchange.proto')

  const order = generateOrder()

  try {
    client.connect(env.grpcUrl, { plaintext: true })

    const start = Date.now()
    const response = client.invoke('exchange.OrderService/PlaceOrder', {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      price: order.price,
      quantity: order.quantity,
    }, { timeout: '5s' })
    const latency = Date.now() - start

    grpcCallCounter.add(1)
    grpcLatency.add(latency)

    check(response, {
      'grpc PlaceOrder OK': (r) => r.status === grpc.StatusOK,
    })
    client.close()
  } catch (e) {
    console.error(`[E2E gRPC] Error: ${e}`)
    grpcCallCounter.add(1)
    try { client.close() } catch { /* ignore */ }
  }

  sleep(0.5)
}
