/**
 * modules/order-generator.ts — 加权随机订单生成器
 *
 * 根据交易对权重比例生成随机订单，支持可配置的 base price 映射，
 * 用于 HTTP 下单场景与撮合引擎压测。
 */
import type { Order } from '../types/order'

/** 交易对权重配置（权重越大的交易对被选中的概率越高） */
const SYMBOL_WEIGHTS: Array<{ symbol: string; weight: number }> = [
  { symbol: 'BTCUSDT', weight: 40 },
  { symbol: 'ETHUSDT', weight: 30 },
  { symbol: 'BNBUSDT', weight: 15 },
  { symbol: 'SOLUSDT', weight: 10 },
  { symbol: 'ADAUSDT', weight: 5 },
]

/** 各交易对基准价格（用于生成合理随机价格） */
const BASE_PRICES: Record<string, number> = {
  BTCUSDT: 50000,
  ETHUSDT: 3000,
  BNBUSDT: 400,
  SOLUSDT: 100,
  ADAUSDT: 0.5,
}

/**
 * 按权重随机选取交易对。
 */
export function weightedRandomSymbol(): string {
  const totalWeight = SYMBOL_WEIGHTS.reduce((sum, s) => sum + s.weight, 0)
  let random = Math.random() * totalWeight

  const lastIndex = SYMBOL_WEIGHTS.length - 1
  for (let i = 0; i < SYMBOL_WEIGHTS.length; i++) {
    const entry = SYMBOL_WEIGHTS[i]
    random -= entry.weight
    if (random <= 0 || i === lastIndex) return entry.symbol
  }
  return SYMBOL_WEIGHTS[0].symbol
}

/**
 * 生成一条随机订单。
 *
 * - symbol: 按权重随机选取（也可显式传入）
 * - side:   BUY / SELL 各 50%
 * - type:   LIMIT (70%) / MARKET (30%)
 * - price:  基准价 ±0.5% 随机浮动
 * - quantity: 0.001 ~ 2 随机
 *
 * @param symbol 可选，指定交易对
 */
export function generateOrder(symbol?: string): Order {
  const sym = symbol || weightedRandomSymbol()
  const basePrice = BASE_PRICES[sym] || 1000
  const price = +(basePrice + (Math.random() - 0.5) * basePrice * 0.01).toFixed(2)
  const quantity = +(Math.random() * 2 + 0.001).toFixed(4)

  return {
    symbol: sym,
    side: Math.random() > 0.5 ? 'BUY' : 'SELL',
    type: Math.random() > 0.3 ? 'LIMIT' : 'MARKET',
    price,
    quantity,
    timestamp: Date.now(),
  }
}

/**
 * 从 SharedArray 或静态列表加载预生成交易对列表。
 */
export function loadSymbols(): string[] {
  return SYMBOL_WEIGHTS.map((s) => s.symbol)
}
