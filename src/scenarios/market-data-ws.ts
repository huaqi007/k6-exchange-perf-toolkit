/**
 * scenarios/market-data-ws.ts — WebSocket 深度订阅压测 [M4]
 *
 * 500 VU 同时维持 WebSocket 长连接，订阅 btcusdt@depth 深度频道。
 * 断线自动重连（指数退避 + jitter）由 modules/ws-reconnect 统一提供。
 *
 * 入口: k6 run dist/market-data-ws.js
 */
import { getEnv } from '../config/environments'
import { connectWithRetry } from '../modules/ws-reconnect'
import { buildThresholds } from '../config/thresholds'

const env = getEnv()

export const options = {
  scenarios: {
    ws_depth: {
      executor: 'constant-vus',
      vus: 500,
      duration: '60s',
    },
  },
  thresholds: buildThresholds(['ws']),
}

export default function (): void {
  connectWithRetry({
    url: env.wsUrl,
    maxReconnects: 5,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    onOpen: (socket) => {
      socket.send(
        JSON.stringify({
          method: 'SUBSCRIBE',
          params: ['btcusdt@depth'],
        })
      )
      socket.setInterval(() => socket.ping(), 30000)
    },
  })
}
