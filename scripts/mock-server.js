#!/usr/bin/env node
/**
 * scripts/mock-server.js — 三协议 mock 靶机服务
 *
 * 单文件启动 HTTP REST + WebSocket + gRPC 三个协议的 mock 服务:
 *  - REST (8080):  /api/v1/health, /api/v1/order, /api/v1/ticker/:symbol
 *  - WS   (8080):  /ws 端点，订阅 btcusdt@depth 深度快照
 *  - gRPC (9090):  PlaceOrder (Unary) + SubscribeOrders (Server Streaming)
 *
 * 启动: node scripts/mock-server.js
 * 依赖: npm install (express, ws, @grpc/grpc-js, @grpc/proto-loader, uuid)
 */
const express = require('express')
const http = require('http')
const { WebSocketServer } = require('ws')
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

// ============================================================
//  Configuration
// ============================================================
const REST_PORT = 8080
const GRPC_PORT = '0.0.0.0:9090'
const WS_PATH = '/ws'

// ============================================================
//  Utility: Normal distribution latency (Box-Muller)
//         P50 ≈ 50ms, P95 ≈ 300ms, clamped >= 5ms
// ============================================================
function randomNormal(mean, stddev) {
  const u = 1 - Math.random()
  const v = 1 - Math.random()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return Math.max(5, mean + z * stddev)
}

// ============================================================
//  REST API (Express)
// ============================================================
const app = express()
const server = http.createServer(app)
app.use(express.json())

function log(method, path, detail) {
  console.log(`[${new Date().toISOString()}] ${method} ${path} ${detail || ''}`)
}

// ---- GET /api/v1/health ----
app.get('/api/v1/health', (req, res) => {
  log('GET', req.originalUrl)
  res.json({ status: 'ok' })
})

// ---- POST /api/v1/order ----
app.post('/api/v1/order', (req, res) => {
  log('POST', req.originalUrl, JSON.stringify(req.body))
  const delay = randomNormal(50, 152)

  if (Math.random() < 0.05) {
    return setTimeout(() => {
      log('POST', req.originalUrl, '=> 500')
      res.status(500).json({ error: 'internal server error' })
    }, delay)
  }

  setTimeout(() => {
    const { symbol, side, type, price, quantity } = req.body
    const orderId = uuidv4()
    const status = Math.random() > 0.3 ? 'FILLED' : 'PARTIALLY_FILLED'
    const filledQty = status === 'FILLED'
      ? Number(quantity)
      : +(Math.random() * Number(quantity)).toFixed(8)

    log('POST', req.originalUrl, `=> 200 orderId=${orderId} ${symbol} ${side}`)
    res.json({ orderId, status, filledQty })
  }, delay)
})

// ---- GET /api/v1/ticker/:symbol ----
app.get('/api/v1/ticker/:symbol', (req, res) => {
  log('GET', req.originalUrl)
  const delay = randomNormal(50, 152)

  if (Math.random() < 0.05) {
    return setTimeout(() => {
      log('GET', req.originalUrl, '=> 500')
      res.status(500).json({ error: 'internal server error' })
    }, delay)
  }

  setTimeout(() => {
    const symbol = req.params.symbol.toUpperCase()
    const basePrice = 50000 + Math.random() * 20000
    const price = basePrice.toFixed(2)
    const change = ((Math.random() - 0.5) * 2000).toFixed(2)

    log('GET', req.originalUrl, `=> 200 price=${price}`)
    res.json({
      symbol,
      price,
      change,
      high: (+price + Math.random() * 500).toFixed(2),
      low: (+price - Math.random() * 500).toFixed(2),
      volume: (Math.random() * 10000).toFixed(4),
    })
  }, delay)
})

// ============================================================
//  WebSocket (ws)
// ============================================================

function randomPrice(base) {
  return +(base + (Math.random() - 0.5) * base * 0.002).toFixed(2)
}

function generateDepthSnapshot(symbol) {
  const base = 50000 + Math.random() * 20000
  const bids = []
  const asks = []
  for (let i = 0; i < 10; i++) {
    bids.push([randomPrice(base - (i + 1) * 10).toFixed(2), +(Math.random() * 5).toFixed(4)])
    asks.push([randomPrice(base + (i + 1) * 10).toFixed(2), +(Math.random() * 5).toFixed(4)])
  }
  return { symbol, bids, asks, timestamp: Date.now() }
}

const wss = new WebSocketServer({ server, path: WS_PATH })

wss.on('connection', (ws) => {
  const clientId = uuidv4().slice(0, 8)
  log('WS', `CONNECT client=${clientId}`)

  let interval = null

  ws.on('message', (data) => {
    log('WS', `RECV client=${clientId}`, data.toString().slice(0, 100))
    try {
      const msg = JSON.parse(data.toString())
      if (msg.method === 'SUBSCRIBE' && Array.isArray(msg.params)) {
        log('WS', `SUBSCRIBE client=${clientId}`, `channels=${msg.params.join(',')}`)

        if (interval) clearInterval(interval)
        interval = setInterval(() => {
          if (ws.readyState !== ws.OPEN) return
          const snapshot = generateDepthSnapshot(msg.params[0] || 'btcusdt')
          const payload = JSON.stringify({ channel: msg.params[0] || 'btcusdt@depth', data: snapshot })
          ws.send(payload)
        }, 100)

        ws.send(JSON.stringify({ result: 'SUBSCRIBED', id: msg.id }))
      }
    } catch (e) {
      log('WS', `PARSE_ERROR client=${clientId}`, e.message)
    }
  })

  ws.on('pong', () => log('WS', `PONG client=${clientId}`))
  ws.on('close', () => {
    log('WS', `DISCONNECT client=${clientId}`)
    if (interval) { clearInterval(interval); interval = null }
  })
  ws.on('error', (err) => log('WS', `ERROR client=${clientId}`, err.message))
})

// PING all clients every 30s
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.ping()
  })
}, 30000)

// ============================================================
//  gRPC Service
// ============================================================
const PROTO_PATH = path.join(__dirname, '..', 'proto', 'exchange.proto')

let packageDefinition
try {
  packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
} catch (e) {
  console.error(`[MOCK] Failed to load proto: ${e.message}`)
  console.error(`[MOCK] Make sure proto/exchange.proto exists`)
  process.exit(1)
}

const exchangeProto = grpc.loadPackageDefinition(packageDefinition).exchange

function placeOrder(call, callback) {
  const { symbol, side, type, price, quantity } = call.request
  const orderId = uuidv4()
  const status = Math.random() > 0.3 ? 'FILLED' : 'PARTIALLY_FILLED'
  const filledQty = status === 'FILLED' ? quantity : +(Math.random() * quantity).toFixed(8)

  log('GRPC', 'PlaceOrder', `orderId=${orderId} symbol=${symbol} side=${side} status=${status}`)
  callback(null, { order_id: orderId, status, filled_qty: filledQty })
}

function subscribeOrders(call) {
  const { symbol } = call.request || {}
  const sym = symbol || 'BTCUSDT'
  log('GRPC', 'SubscribeOrders START', `symbol=${sym}`)

  const interval = setInterval(() => {
    const orderId = uuidv4()
    const side = Math.random() > 0.5 ? 'BUY' : 'SELL'
    const type = Math.random() > 0.5 ? 'LIMIT' : 'MARKET'
    const price = +(50000 + Math.random() * 20000).toFixed(2)
    const quantity = +(Math.random() * 2).toFixed(4)
    const status = Math.random() > 0.3 ? 'FILLED' : 'PARTIALLY_FILLED'
    const filledQty = status === 'FILLED' ? quantity : +(Math.random() * quantity).toFixed(8)

    call.write({
      order_id: orderId,
      symbol: sym,
      side,
      type,
      price,
      quantity,
      status,
      filled_qty: filledQty,
    })
  }, 100)

  call.on('cancelled', () => {
    clearInterval(interval)
    log('GRPC', 'SubscribeOrders CANCELLED', `symbol=${sym}`)
  })
  call.on('error', (err) => {
    clearInterval(interval)
    log('GRPC', 'SubscribeOrders ERROR', err.message)
  })
}

// ============================================================
//  Start servers
// ============================================================

// Start gRPC
const grpcServer = new grpc.Server()
grpcServer.addService(exchangeProto.OrderService.service, {
  placeOrder: placeOrder,
  subscribeOrders: subscribeOrders,
})

grpcServer.bindAsync(GRPC_PORT, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
  if (err) {
    console.error(`[MOCK] gRPC bind error: ${err.message}`)
    return
  }
  console.log(`[MOCK] gRPC server listening on 0.0.0.0:${boundPort}`)
})

// Start HTTP + WS
server.listen(REST_PORT, () => {
  console.log(`[MOCK] REST + WS server listening on port ${REST_PORT}`)
  console.log(`[MOCK]   REST: http://localhost:${REST_PORT}/api/v1/*`)
  console.log(`[MOCK]   WS:   ws://localhost:${REST_PORT}${WS_PATH}`)
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[MOCK] Shutting down...')
  clearInterval(pingInterval)
  wss.close()
  server.close()
  grpcServer.tryShutdown(() => {
    console.log('[MOCK] gRPC server stopped')
  })
  process.exit(0)
})
