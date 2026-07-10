```
            _    ___
   ___ __ _| |_ / _ \ ___ _ ____   _____ _ __
  / __/ _` | __| | | / _ \ '_ \ \ / / _ \ '__|
 | (_| (_| | |_| |_| |  __/ | | \ V /  __/ |
  \___\__,_|\__|\___/ \___|_| |_|\_/ \___|_|

  Exchange Performance Testing Toolkit
  REST · WebSocket · gRPC · JSON-RPC · Cosmos
```

# k6-exchange-perf-toolkit

多协议交易所性能测试工具箱，基于 [k6](https://k6.io) 构建，覆盖 HTTP REST、WebSocket、gRPC Unary/Streaming、JSON-RPC、Cosmos SDK 全链路压测场景。

## 架构

```
k6-exchange-perf-toolkit/
├── src/
│   ├── scenarios/          # 场景入口层 — k6 options + exec 函数
│   │   ├── order-stress.ts       # HTTP 下单压测 (ramping-arrival-rate)
│   │   ├── market-data-ws.ts     # WS 深度订阅 + 断线重连 + 500VU
│   │   ├── matching-engine.ts    # 撮合引擎：做市商/闪电撤单/Maker-Taker
│   │   ├── rpc-node.ts           # JSON-RPC: eth_call/getBalance/batch
│   │   ├── grpc-service.ts       # gRPC Unary + Server Streaming
│   │   ├── cosmos-query.ts       # Cosmos gRPC AllBalances 查询
│   │   └── e2e-trading.ts        # 全链路：WS看盘→HTTP下单→gRPC上链
│   ├── modules/            # 可复用能力层
│   │   ├── http-client.ts        # safeGet/safePost + 指数退避重试
│   │   ├── ws-reconnect.ts       # while+connect+退避+jitter 重连框架
│   │   ├── auth-signer.ts        # HMAC-SHA256 签名 (Binance/OKX)
│   │   ├── json-rpc-client.ts    # JSON-RPC 请求封装 (单条/batch)
│   │   ├── grpc-client.ts        # gRPC 连接复用封装
│   │   └── order-generator.ts    # 加权随机交易对 + 订单生成
│   ├── lib/                # 全局工具库
│   │   ├── metrics.ts            # Counter/Trend/Rate 自定义指标
│   │   ├── error-boundary.ts     # 错误边界，异常不崩 VU
│   │   └── rate-limiter.ts       # 客户端令牌桶限频
│   ├── config/             # 环境/阈值配置
│   │   ├── environments.ts       # local/staging/prod 多环境
│   │   └── thresholds.ts         # 性能门禁阈值
│   └── types/              # TypeScript 类型定义
│       ├── order.ts              # 订单/交易对/签名结构
│       └── rpc.ts                # JSON-RPC / gRPC 消息结构
├── proto/                  # Protobuf IDL
│   ├── exchange.proto            # OrderService: PlaceOrder + SubscribeOrders
│   └── cosmos/                   # Cosmos SDK proto (从 release 下载)
├── data/                   # 测试数据 (SharedArray 预加载)
│   ├── orders.json
│   └── symbols.json
├── scripts/
│   ├── mock-server.js            # 三协议靶机 (HTTP+WS+gRPC)
│   ├── generate-txns.js          # 批量生成测试订单 (--count / COUNT env)
│   ├── fetch-cosmos-proto.sh     # 下载 Cosmos SDK proto 文件
│   └── run-all.sh                # 一键运行全部场景
├── tests/                  # vitest 单元测试 (纯函数)
├── k8s/                    # 分布式压测 (k6-operator)
│   ├── configmap.yaml            # k6-test-scripts ConfigMap 说明
│   └── testrun.yaml
├── .github/workflows/      # GitHub Actions 性能门禁
│   └── perf-gate.yml
├── grafana/                # 可观测性面板
│   └── dashboard.json
├── docker-compose.yml            # 一键启动 mock+k6+Prometheus+Grafana
├── Dockerfile.multistage         # 多阶段镜像 (< 200MB)
├── webpack.config.js             # TS 编译为 k6 可执行 JS
└── tsconfig.json
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动 Mock 靶机

```bash
npm run mock
# 输出:
# [MOCK] REST + WS server listening on port 8080
# [MOCK]   REST: http://localhost:8080/api/v1/*
# [MOCK]   WS:   ws://localhost:8080/ws
# [MOCK] gRPC server listening on 0.0.0.0:9090
```

### 3. 编译 TypeScript

```bash
npm run build
# 产物: dist/*.js
```

### 4. 运行压测

```bash
# 单个场景
k6 run dist/order-stress.js        # HTTP 下单压测
k6 run dist/market-data-ws.js      # WebSocket 压测
k6 run dist/grpc-service.js        # gRPC 压测
k6 run dist/e2e-trading.js         # 全链路压测

# 或使用 npm scripts
npm run test:order
npm run test:ws
npm run test:grpc
npm run test:e2e

# 一键运行所有场景
bash scripts/run-all.sh
```

### 5. 运行单元测试

```bash
npm run test:unit        # 运行 vitest 单元测试 (lib/ 与 modules/ 纯函数)
npm run test:unit:watch  # watch 模式
```

## Cosmos 场景 proto 准备

`cosmos-query` 场景依赖 Cosmos SDK 的 proto 文件（默认不随仓库提供），运行前先下载：

```bash
bash scripts/fetch-cosmos-proto.sh v0.50.4
# 生成 proto/cosmos/** 与 proto/gogoproto/gogo.proto
```

## Kubernetes 分布式压测

`k8s/testrun.yaml` 引用名为 `k6-test-scripts` 的 ConfigMap，需先由构建产物创建：

```bash
npm run build
kubectl create namespace perf-testing
kubectl create configmap k6-test-scripts --from-file=dist/ -n perf-testing \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f k8s/testrun.yaml
```

详见 `k8s/configmap.yaml` 顶部说明。

## Mock 靶机 API

### REST (8080)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/health` | GET | 健康检查 → `{"status":"ok"}` |
| `/api/v1/order` | POST | 下单, body: `{symbol,side,type,price,quantity}` |
| `/api/v1/ticker/:symbol` | GET | 行情数据（随机价格） |

- 延迟: 正态分布 P50≈50ms, P95≈300ms
- 5% 概率返回 HTTP 500
- 所有请求打印日志

### WebSocket (8080/ws)

```json
// 订阅深度
{"method":"SUBSCRIBE","params":["btcusdt@depth"]}

// 每 100ms 推送
{"channel":"btcusdt@depth","data":{"symbol":"BTCUSDT","bids":[[...],...],"asks":[[...],...]}}
```

- 30s 间隔 ping/pong 心跳
- 支持多频道订阅

### gRPC (9090)

```protobuf
service OrderService {
  rpc PlaceOrder (PlaceOrderRequest) returns (PlaceOrderResponse);
  rpc SubscribeOrders (SubscribeOrdersRequest) returns (stream OrderUpdate);
}
```

## 场景说明

| 场景 | 执行器 | 负载 | 协议 |
|------|--------|------|------|
| `order-stress` | ramping-arrival-rate | 10→200 RPS | HTTP REST |
| `market-data-ws` | constant-vus | 500 VU | WebSocket |
| `matching-engine` | 3x constant-arrival-rate | 做市商/撤单/Taker | HTTP REST |
| `rpc-node` | 3x constant-arrival-rate | eth_call/balance/batch | JSON-RPC |
| `grpc-service` | arrival-rate + constant-vus | Unary + Streaming | gRPC |
| `cosmos-query` | ramping-vus | 5→50 VU | Cosmos gRPC |
| `e2e-trading` | 3x mixed | WS + HTTP + gRPC | 全链路 |

## Docker 部署

```bash
# 一键启动全栈 (mock + k6 + Prometheus + Grafana)
docker compose up -d

# 仅运行压测
docker compose run --rm k6-runner

# 查看 Grafana 面板
# http://localhost:3000 (admin/admin)
```

## CI 性能门禁

Push/PR 到 `main` 分支时自动触发 (`.github/workflows/perf-gate.yml`):
1. 编译 TypeScript
2. 启动 mock 靶机
3. 运行 k6 压测
4. 检查阈值 (P95 < 300ms, 错误率 < 1%)
5. 上传结果 artifact

## 自定义指标

| 指标 | 类型 | 说明 |
|------|------|------|
| `orders_placed` | Counter | 已下单总数 |
| `order_latency_ms` | Trend | 订单延迟 (ms) |
| `order_error_rate` | Rate | 订单失败率 |
| `ws_messages_received` | Counter | WS 消息数 |
| `ws_reconnects` | Counter | WS 重连次数 |
| `ws_connect_latency` | Trend | WS 建连延迟 (ms) |
| `grpc_calls` | Counter | gRPC 调用次数 |
| `grpc_latency_ms` | Trend | gRPC 延迟 (ms) |
| `grpc_stream_msgs` | Counter | gRPC 流式消息数 |
| `rpc_calls` | Counter | RPC 调用次数 |
| `rpc_latency_ms` | Trend | RPC 延迟 (ms) |
| `matching_latency_ms` | Trend | 撮合处理延迟 (ms) |
| `custom_errors` | Rate | 业务异常率 |

## 技术栈

- **k6** v0.49+ — 负载生成引擎
- **TypeScript** 5.3+ — 类型安全
- **Webpack** 5 — TS → JS 编译
- **gRPC** (k6/net/grpc) — gRPC 负载
- **Express + ws** — Mock 靶机
- **Prometheus + Grafana** — 可观测性
- **k6-operator** — K8s 分布式压测
- **GitHub Actions** — CI 性能门禁

## License

MIT
