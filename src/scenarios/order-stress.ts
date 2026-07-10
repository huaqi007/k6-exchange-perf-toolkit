/**
 * scenarios/order-stress.ts — HTTP 下单压测 [M1/M2]
 *
 * 使用 ramping-arrival-rate 执行器模拟阶梯式递增的订单请求负载。
 * 每个 VU 生成随机订单并调用 POST /api/v1/order。
 *
 * 入口: k6 run dist/order-stress.js
 */
import { check } from 'k6'
import { getEnv } from '../config/environments'
import { generateOrder } from '../modules/order-generator'
import { safePost } from '../modules/http-client'
import { orderCounter, orderLatency, orderErrorRate } from '../lib/metrics'
import { buildThresholds } from '../config/thresholds'
import { safeJsonParse } from '../lib/error-boundary'

const env = getEnv()

export const options = {
  scenarios: {
    order_stress: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: 200,
      stages: [
        { target: 50, duration: '30s' },
        { target: 100, duration: '30s' },
        { target: 200, duration: '30s' },
        { target: 50, duration: '30s' },
        { target: 0, duration: '10s' },
      ],
    },
  },
  thresholds: buildThresholds(['http', 'order']),
}

export default function (): void {
  const order = generateOrder()
  const startTime = Date.now()

  const res = safePost(`${env.restBaseUrl}/api/v1/order`, {
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    price: order.price,
    quantity: order.quantity,
  })

  const latency = Date.now() - startTime
  const json = safeJsonParse(res.body as string)

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has orderId': () => !!(json && json.orderId),
  })

  orderCounter.add(1)
  orderLatency.add(latency)
  orderErrorRate.add(res.status >= 400 ? 1 : 0)
}
