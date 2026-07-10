/**
 * types/rpc.ts — JSON-RPC 与 gRPC 消息结构
 *
 * 定义跨协议通信的请求 / 响应格式，供 json-rpc-client 与 grpc-client 模块使用。
 */

/** JSON-RPC 2.0 请求 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params: unknown[]
  id: number
}

/** JSON-RPC 2.0 响应 */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: {
    code: number
    message: string
  }
  id: number
}

/** JSON-RPC batch 调用条目 */
export interface JsonRpcBatchItem {
  method: string
  params: unknown[]
}

/** gRPC PlaceOrder 请求消息 */
export interface GrpcPlaceOrderRequest {
  symbol: string
  side: string
  type: string
  price: number
  quantity: number
}

/** gRPC PlaceOrder 响应消息 */
export interface GrpcPlaceOrderResponse {
  order_id: string
  status: string
  filled_qty: number
}

/** gRPC SubscribeOrders 请求消息 */
export interface GrpcSubscribeOrdersRequest {
  symbol: string
}

/** gRPC SubscribeOrders 流式更新消息 */
export interface GrpcOrderUpdate {
  order_id: string
  symbol: string
  side: string
  type: string
  price: number
  quantity: number
  status: string
  filled_qty: number
}

/** Cosmos gRPC AllBalances 请求 */
export interface CosmosQueryRequest {
  address: string
  pagination?: {
    key: Uint8Array
    offset: number
    limit: number
  }
}

/** Cosmos gRPC AllBalances 响应单币种条目 */
export interface CosmosCoin {
  denom: string
  amount: string
}

/** Cosmos gRPC AllBalances 响应 */
export interface CosmosAllBalancesResponse {
  balances: CosmosCoin[]
  pagination: {
    next_key: Uint8Array
    total: string
  }
}
