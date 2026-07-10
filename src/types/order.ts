/**
 * types/order.ts — 订单 / 交易对 / 签名 结构定义
 *
 * 用于 k6 场景脚本与模块间的类型约束，确保下单、签名等操作的数据结构一致。
 */

export interface Order {
  /** 交易对符号，如 "BTCUSDT" */
  symbol: string
  /** 买卖方向 */
  side: 'BUY' | 'SELL'
  /** 订单类型：限价 / 市价 */
  type: 'LIMIT' | 'MARKET'
  /** 限价单价格（市价单可传 0） */
  price: number
  /** 委托数量 */
  quantity: number
  /** 服务器返回的订单 ID（可选） */
  orderId?: string
  /** 订单状态 */
  status?: 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'REJECTED'
  /** 已成交数量 */
  filledQty?: number
  /** 请求时间戳（毫秒） */
  timestamp?: number
}

export interface OrderResponse {
  orderId: string
  status: string
  filledQty: number
}

export interface SymbolConfig {
  /** 交易对符号 */
  symbol: string
  /** 基础资产（如 BTC） */
  baseAsset: string
  /** 计价资产（如 USDT） */
  quoteAsset: string
  /** 价格精度（小数位数） */
  pricePrecision: number
  /** 数量精度（小数位数） */
  quantityPrecision: number
  /** 最小下单数量 */
  minQty: number
}

export interface TickerData {
  symbol: string
  price: string
  change: string
  high: string
  low: string
  volume: string
}

export interface DepthSnapshot {
  symbol: string
  bids: [string, number][]
  asks: [string, number][]
  timestamp: number
}
