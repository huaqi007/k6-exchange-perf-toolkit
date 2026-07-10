/**
 * scenarios/rpc-node.ts — JSON-RPC 节点压测 [M5]
 *
 * 模拟区块链节点 RPC 请求负载:
 *  - eth_call: 合约只读调用
 *  - eth_getBalance: 余额查询
 *  - batch: 批量 RPC 请求
 *
 * 入口: k6 run dist/rpc-node.js
 */
import { check, sleep } from 'k6'
import { getEnv } from '../config/environments'
import { rpcCall, rpcBatchCall } from '../modules/json-rpc-client'
import { rpcCallCounter, rpcLatency, customErrors } from '../lib/metrics'
import { buildThresholds } from '../config/thresholds'
import { safeJsonParse } from '../lib/error-boundary'

const env = getEnv()

// 模拟地址列表
const ADDRESSES = [
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
  '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5',
  '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
]

export const options = {
  scenarios: {
    eth_call: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 10,
      maxVUs: 40,
      exec: 'ethCall',
    },
    get_balance: {
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 10,
      maxVUs: 40,
      exec: 'getBalance',
    },
    batch_rpc: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: 'batchRpc',
    },
  },
  thresholds: buildThresholds(['http', 'rpc', 'custom']),
}

/** 模拟 eth_call 合约调用 */
export function ethCall(): void {
  const start = Date.now()
  const res = rpcCall(env.rpcUrl, 'eth_call', [
    {
      to: ADDRESSES[0],
      data: '0x70a08231000000000000000000000000' + ADDRESSES[1].slice(2),
    },
    'latest',
  ])
  rpcCallCounter.add(1)
  rpcLatency.add(Date.now() - start)

  const json = safeJsonParse(res.body as string)
  const hasResult = !!(json && (json.result || json.error))
  customErrors.add(hasResult ? 0 : 1)

  sleep(0.05)
}

/** 模拟 eth_getBalance 余额查询 */
export function getBalance(): void {
  const addr = ADDRESSES[Math.floor(Math.random() * ADDRESSES.length)]
  const start = Date.now()
  const res = rpcCall(env.rpcUrl, 'eth_getBalance', [addr, 'latest'])
  rpcCallCounter.add(1)
  rpcLatency.add(Date.now() - start)

  const json = safeJsonParse(res.body as string)
  const hasResult = !!(json && json.result !== undefined)
  customErrors.add(hasResult ? 0 : 1)

  sleep(0.02)
}

/** 模拟批量 RPC 请求 */
export function batchRpc(): void {
  const calls = ADDRESSES.map((addr) => ({
    method: 'eth_getBalance',
    params: [addr, 'latest'],
  }))

  const start = Date.now()
  const res = rpcBatchCall(env.rpcUrl, calls)
  rpcCallCounter.add(calls.length)
  rpcLatency.add(Date.now() - start)

  check(res, { 'batch status 200': (r) => r.status === 200 })

  sleep(0.1)
}
