/**
 * modules/ws-reconnect.ts — WebSocket 重连框架
 *
 * 在 k6 场景 exec 函数中调用 connectWithRetry，
 * 自动处理断线检测 + 指数退避 + jitter 重连逻辑。
 *
 * 用法示例:
 *   export default function () {
 *     connectWithRetry({ url: env.wsUrl, onMessage: handleMsg })
 *   }
 */
import ws from 'k6/ws'
import { sleep } from 'k6'
import { wsReconnectCounter, wsConnectLatency, wsMessageCounter } from '../lib/metrics'

export interface WSReconnectConfig {
  /** WebSocket 端点 URL */
  url: string
  /** k6 ws.connect 额外参数 (headers, tags 等) */
  params?: Record<string, unknown>
  /** 收到消息时的回调，返回 false 可主动断开 */
  onMessage?: (socket: ws.Socket, message: string, parsed: Record<string, unknown>) => boolean | void
  /** 连接打开时的回调 */
  onOpen?: (socket: ws.Socket) => void
  /** 最大重连次数 */
  maxReconnects?: number
  /** 基础退避延迟 (ms) */
  baseDelayMs?: number
  /** 最大退避延迟上限 (ms) */
  maxDelayMs?: number
}

/**
 * 建立 WebSocket 连接，自动重连直到超过 maxReconnects 次数。
 *
 * 内部对 ws.connect 进行循环包装，每次断开后计算退避延迟并 sleep。
 */
export function connectWithRetry(config: WSReconnectConfig): void {
  const maxReconnects = config.maxReconnects ?? 10
  const baseDelay = config.baseDelayMs ?? 1000
  const maxDelay = config.maxDelayMs ?? 30000

  for (let attempt = 0; attempt <= maxReconnects; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
      const jitter = Math.random() * (delay * 0.3)
      sleep((delay + jitter) / 1000)
      console.log(`[WS] Reconnecting attempt ${attempt}/${maxReconnects}, delay=${(delay + jitter).toFixed(0)}ms`)
    }

    const connectStart = Date.now()
    const res = ws.connect(config.url, config.params || {}, (socket) => {
      socket.on('open', () => {
        wsConnectLatency.add(Date.now() - connectStart)
        console.log(`[WS] Connected to ${config.url}`)
        if (config.onOpen) {
          config.onOpen(socket)
        }
      })

      socket.on('message', (data) => {
        wsMessageCounter.add(1)
        if (config.onMessage) {
          let parsed: Record<string, unknown> = {}
          try {
            parsed = JSON.parse(data as string) as Record<string, unknown>
          } catch {
            /* 非 JSON 消息原样透传 */
          }
          config.onMessage(socket, data as string, parsed)
        }
      })

      socket.on('close', (code) => {
        console.log(`[WS] Disconnected code=${code}, attempt=${attempt}`)
        if (attempt < maxReconnects) {
          wsReconnectCounter.add(1)
        }
      })

      socket.on('error', (e) => {
        console.error(`[WS] Error: ${typeof e === 'string' ? e : JSON.stringify(e)}`)
      })

      socket.on('ping', () => {
        // k6 ws 模块自动回复 pong
      })
    })

    if (res && res.status === 101) {
      // ws.connect 会阻塞直到连接关闭，返回后表示已断开
      continue
    }
    // 握手失败
    break
  }
}
