/**
 * config/environments.ts — 多环境地址与凭证配置
 *
 * 通过 k6 __ENV 全局变量在运行时切换 local / staging / prod，
 * 默认使用 local 对接本地 mock 靶机。
 */

export interface Environment {
  name: string
  restBaseUrl: string
  wsUrl: string
  grpcUrl: string
  rpcUrl: string
  cosmosGrpcUrl: string
  apiKey: string
  secretKey: string
}

/**
 * 所有环境配置汇总。
 *
 * staging / prod 凭证从 __ENV 读取，避免硬编码敏感信息。
 * 生产环境 gRPC 使用 TLS（可不填 plaintext 参数）。
 */
export const environments: Record<string, Environment> = {
  local: {
    name: 'local',
    restBaseUrl: 'http://localhost:8080',
    wsUrl: 'ws://localhost:8080/ws',
    grpcUrl: 'localhost:9090',
    rpcUrl: 'http://localhost:8080',
    cosmosGrpcUrl: 'localhost:9090',
    apiKey: 'local-test-key',
    secretKey: 'local-test-secret',
  },
  staging: {
    name: 'staging',
    restBaseUrl: 'https://staging-api.exchange.example.com',
    wsUrl: 'wss://staging-ws.exchange.example.com/ws',
    grpcUrl: 'staging-grpc.exchange.example.com:443',
    rpcUrl: 'https://staging-rpc.node.example.com',
    cosmosGrpcUrl: 'staging-cosmos.node.example.com:9090',
    apiKey: __ENV.STAGING_API_KEY || '',
    secretKey: __ENV.STAGING_SECRET_KEY || '',
  },
  prod: {
    name: 'prod',
    restBaseUrl: 'https://api.exchange.example.com',
    wsUrl: 'wss://ws.exchange.example.com/ws',
    grpcUrl: 'grpc.exchange.example.com:443',
    rpcUrl: 'https://rpc.node.example.com',
    cosmosGrpcUrl: 'cosmos.node.example.com:9090',
    apiKey: __ENV.PROD_API_KEY || '',
    secretKey: __ENV.PROD_SECRET_KEY || '',
  },
}

/**
 * 获取当前生效的环境配置。
 *
 * 使用 k6 `__ENV.ENVIRONMENT` 切换，默认为 "local"。
 */
export function getEnv(): Environment {
  const envName = __ENV.ENVIRONMENT || 'local'
  return environments[envName] || environments.local
}
