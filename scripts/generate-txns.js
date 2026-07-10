#!/usr/bin/env node
/**
 * scripts/generate-txns.js — 预生成测试数据
 *
 * 生成批量订单模板 (data/orders.json) 和交易对配置 (data/symbols.json)，
 * 供 k6 SharedArray 在 init 阶段加载，全 VU 共享同一份数据避免重复计算。
 *
 * 用法: node scripts/generate-txns.js [--count=10000] [--symbols=BTCUSDT,ETHUSDT]
 */
const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

// 支持 CLI 参数 (--count=1000 --symbols=BTCUSDT,ETHUSDT) 与环境变量 (COUNT / SYMBOLS)，
// CLI 参数优先级高于环境变量。
function parseArgs(argv) {
  const args = {}
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg)
    if (match) args[match[1]] = match[2]
  }
  return args
}

const cli = parseArgs(process.argv.slice(2))

const COUNT = parseInt(cli.count || process.env.COUNT || '10000', 10)
const SYMBOL_LIST = (cli.symbols || process.env.SYMBOLS || 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,ADAUSDT').split(',')

const BASE_PRICES = {
  BTCUSDT: 50000,
  ETHUSDT: 3000,
  BNBUSDT: 400,
  SOLUSDT: 100,
  ADAUSDT: 0.5,
}

function randomOrder(i) {
  const symbol = SYMBOL_LIST[Math.floor(Math.random() * SYMBOL_LIST.length)]
  const basePrice = BASE_PRICES[symbol] || 1000
  const price = +(basePrice + (Math.random() - 0.5) * basePrice * 0.01).toFixed(2)

  return {
    id: `TEMPLATE-${i}-${uuidv4().slice(0, 8)}`,
    symbol,
    side: Math.random() > 0.5 ? 'BUY' : 'SELL',
    type: Math.random() > 0.3 ? 'LIMIT' : 'MARKET',
    price,
    quantity: +(Math.random() * 2 + 0.001).toFixed(4),
  }
}

function generateSymbolsConfig() {
  return SYMBOL_LIST.map((sym) => ({
    symbol: sym,
    baseAsset: sym.replace(/USDT|BTC|ETH|BNB$/, ''),
    quoteAsset: 'USDT',
    pricePrecision: sym === 'ADAUSDT' ? 4 : 2,
    quantityPrecision: 4,
    minQty: sym === 'BTCUSDT' ? 0.0001 : 0.001,
  }))
}

// Generate orders
console.log(`Generating ${COUNT} order templates...`)
const orders = []
for (let i = 0; i < COUNT; i++) {
  orders.push(randomOrder(i))
}

const dataDir = path.join(__dirname, '..', 'data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

fs.writeFileSync(path.join(dataDir, 'orders.json'), JSON.stringify(orders, null, 2))
console.log(`  -> data/orders.json (${orders.length} orders)`)

// Generate symbols config
const symbolsConfig = generateSymbolsConfig()
fs.writeFileSync(path.join(dataDir, 'symbols.json'), JSON.stringify(symbolsConfig, null, 2))
console.log(`  -> data/symbols.json (${symbolsConfig.length} symbols)`)

console.log('Done.')
