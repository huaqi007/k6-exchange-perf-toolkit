/**
 * scenarios/cosmos-query.ts — Cosmos gRPC 查询压测 [M6]
 *
 * 模拟对 Cosmos SDK 节点的 AllBalances 查询负载。
 * 适用于测试基于 Cosmos 的链（如 Osmosis、Cosmos Hub 等）。
 *
 * 入口: k6 run dist/cosmos-query.js
 */
import grpc from 'k6/net/grpc'
import { check, sleep } from 'k6'
import { getEnv } from '../config/environments'
import { grpcCallCounter, grpcLatency } from '../lib/metrics'
import { buildThresholds } from '../config/thresholds'

const env = getEnv()

// Cosmos SDK proto 路径（需从 cosmos-sdk release 下载对应版本 proto）
const PROTO_PATHS = ['./proto', './proto/cosmos']
const PROTO_FILES = [
  'cosmos/bank/v1beta1/query.proto',
  'cosmos/base/query/v1beta1/pagination.proto',
  'cosmos/base/v1beta1/coin.proto',
  'gogoproto/gogo.proto',
]

// 模拟钱包地址列表
const COSMOS_ADDRESSES = [
  'cosmos1qypqxpq9qcrsszg2pvz7x8t0n3mjk4s0u3l5k8',
  'cosmos1xv9tklw7d0apkzs0rn5cqhzg5z6z4g0x0xz4uh',
  'cosmos1lsagfzrmcv9hpck8f3hvdhmlx3hxws6zec4t0d',
]

export const options = {
  scenarios: {
    all_balances: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { target: 20, duration: '30s' },
        { target: 50, duration: '30s' },
        { target: 20, duration: '30s' },
        { target: 0, duration: '10s' },
      ],
      exec: 'queryAllBalances',
    },
  },
  thresholds: buildThresholds(['grpc']),
}

export function queryAllBalances(): void {
  const client = new grpc.Client()
  client.load(PROTO_PATHS, ...PROTO_FILES)

  const address = COSMOS_ADDRESSES[Math.floor(Math.random() * COSMOS_ADDRESSES.length)]

  try {
    client.connect(env.cosmosGrpcUrl, { plaintext: true })

    const start = Date.now()
    const response = client.invoke(
      'cosmos.bank.v1beta1.Query/AllBalances',
      { address, pagination: { limit: 100, offset: 0 } },
      { timeout: '5s' }
    )
    const latency = Date.now() - start

    grpcCallCounter.add(1)
    grpcLatency.add(latency)

    check(response, {
      'AllBalances success': (r) => r.status === grpc.StatusOK,
    })
    client.close()
  } catch (e) {
    console.error(`[Cosmos AllBalances] Error: ${e}`)
    grpcCallCounter.add(1)
    try { client.close() } catch { /* ignore */ }
  }

  sleep(1)
}
