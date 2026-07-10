/**
 * scenarios/matching-engine.ts — 撮合引擎压测 [M5]
 *
 * 模拟三种交易策略的并发下单:
 *  - 做市商 (Maker): LIMIT BUY + LIMIT SELL 双边挂单
 *  - 闪电撤单: POST 订单后立即 DELETE 撤销
 *  - Maker-Taker: 先挂 LIMIT 再以 MARKET 成交
 *
 * 入口: k6 run dist/matching-engine.js
 */
import { check, sleep } from 'k6'
import { getEnv } from '../config/environments'
import { generateOrder } from '../modules/order-generator'
import { safePost, safeGet } from '../modules/http-client'
import { orderCounter, orderLatency, orderErrorRate, matchingLatency } from '../lib/metrics'
import { buildThresholds } from '../config/thresholds'
import { safeJsonParse } from '../lib/error-boundary'

const env = getEnv()

export const options = {
  scenarios: {
    maker: {
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 20,
      maxVUs: 50,
      exec: 'makerStrategy',
    },
    flasher: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: 'flasherStrategy',
    },
    makerTaker: {
      executor: 'constant-arrival-rate',
      rate: 15,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 15,
      maxVUs: 40,
      exec: 'makerTakerStrategy',
    },
  },
  thresholds: buildThresholds(['http', 'order']),
}

/** 提交订单并记录指标 */
function submitOrder(order: ReturnType<typeof generateOrder>): string | null {
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
  orderCounter.add(1)
  orderLatency.add(latency)
  matchingLatency.add(latency)
  orderErrorRate.add(res.status >= 400 ? 1 : 0)

  return json ? (json.orderId as string) : null
}

/** 做市商策略: LIMIT BUY + LIMIT SELL */
export function makerStrategy(): void {
  const sym = 'BTCUSDT'

  const buyOrder = generateOrder(sym)
  buyOrder.side = 'BUY'
  buyOrder.type = 'LIMIT'
  submitOrder(buyOrder)

  const sellOrder = generateOrder(sym)
  sellOrder.side = 'SELL'
  sellOrder.type = 'LIMIT'
  submitOrder(sellOrder)

  sleep(0.5)
}

/** 闪电撤单策略: 下单后立即撤销 */
export function flasherStrategy(): void {
  const order = generateOrder()
  order.type = 'LIMIT'

  const orderId = submitOrder(order)
  if (orderId) {
    // 模拟撤单请求
    const res = safePost(`${env.restBaseUrl}/api/v1/order/cancel`, {
      orderId,
      symbol: order.symbol,
    })
    check(res, { 'cancel accepted': (r) => r.status === 200 || r.status === 404 })
  }

  sleep(0.2)
}

/** Maker-Taker 策略: 挂限价单后被市价单吃单 */
export function makerTakerStrategy(): void {
  const sym = 'BTCUSDT'

  // Maker: 挂一张 LIMIT 卖单
  const makerOrder = generateOrder(sym)
  makerOrder.side = 'SELL'
  makerOrder.type = 'LIMIT'
  submitOrder(makerOrder)

  sleep(0.1)

  // Taker: 市价买单吃单
  const takerOrder = generateOrder(sym)
  takerOrder.side = 'BUY'
  takerOrder.type = 'MARKET'
  submitOrder(takerOrder)

  sleep(0.3)
}
