# k6-ts-projectV2 — 性能测试逻辑文档

> 生成日期：2026-07-03 | TypeScript + Webpack + k6 | dist 140KB

---

## 1. 项目概览

本项目是一个**模块化的 k6 混合场景压测工程**，模拟加密货币交易所的核心 API 流量。通过 TypeScript 编写、Webpack 打包，产出可在 k6 运行时直接执行的 JS 脚本。

### 1.1 模拟的 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/health` | 健康检查，返回 `{"status":"ok"}` |
| `GET` | `/api/v1/ticker/:symbol` | 行情查询，返回随机价格 |
| `POST` | `/api/v1/order` | 下单，需要 HMAC-SHA256 签名头 |

### 1.2 技术栈

```
TypeScript (ES2016) → ts-loader → Webpack 5 → CommonJS bundle → k6 运行时
```

k6 内置模块（`k6/http`、`k6/data`、`k6/crypto` 等）通过 webpack `externals` 排除，由 k6 运行时注入。

---

## 2. 项目结构 & 模块依赖

```
src/
├── config/
│   ├── env.ts                  # 环境变量（BASE_URL）
│   └── symbols.ts              # SharedArray 加载 10+ 交易对配置
├── data/
│   ├── orders.json             # 1000 条预生成订单（118KB）
│   └── symbols.json            # 10 个交易对的精度/限制配置
├── error/
│   └── error-boundary.ts       # 指数退避重试 + try-catch 错误边界 ⭐
├── lib/
│   └── metrics.ts              # 自定义 k6 指标（Counter/Trend）
├── modules/
│   ├── order-generator.ts      # 加权随机选择 + 订单生成
│   └── pre-signer.ts           # HMAC 预签名 SharedArray + 索引
├── scenarios/
│   └── Mixed-scenario-v2.ts    # 🔴 主入口：3 个混合场景
└── types/
    └── k6-globals.d.ts         # k6 全局类型声明
```

### 2.1 模块依赖图

```
Mixed-scenario-v2.ts  (入口)
  ├── config/env.ts                   → getBaseUrl()
  ├── config/symbols.ts               → [不直接引用，由 order-generator 间接使用]
  ├── lib/metrics.ts                  → metrics.*
  ├── error/error-boundary.ts         → safeGetWithRetry / safePostWithRetry
  │     └── lib/metrics.ts            → metrics.httpRetries / scriptErrors
  ├── modules/order-generator.ts      → weightedRandomSymbol()
  │     └── config/symbols.ts         → SYMBOLS_CONFIG (SharedArray)
  └── modules/pre-signer.ts           → preSignedOrders / getOrderBySymbol()
        └── data/orders.json          → open() 加载预生成订单
```

### 2.2 依赖方向

```
config/   ← 被 error/、modules/ 依赖（底层配置）
lib/      ← 被 error/、scenarios/ 依赖（底层指标）
error/    ← 被 scenarios/ 依赖（HTTP 工具层）
modules/  ← 被 scenarios/ 依赖（业务逻辑层）
scenarios/ ← 入口层，不被任何模块依赖
```

**无循环依赖。所有箭头单向向上。**

---

## 3. 三个混合场景

### 3.1 场景一：Ticker 轮询 (`pollTicker`)

```
执行器：constant-arrival-rate
速率：200 RPS（每秒精准发射 200 个请求）
VU：预分配 50，最大 100
持续：2 分钟
```

**逻辑流程：**

```
┌─────────────────────────────────────────────────┐
│ weightedRandomSymbol()                           │
│   BTC 40% / ETH 30% / SOL 5% / ... → "BTC-USDT" │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│ safeGetWithRetry(GET /api/v1/ticker/BTC-USDT)    │
│   ├── 网络层：指数退避重试（最多 3 次）          │
│   └── 异常时：try-catch → 返回 null              │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│ res == null ? → return（安全退出）               │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│ metrics.tickerRequests.add(1)                    │
│ metrics.tickerLatency.add(res.timings.duration)  │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│ check(res, { 'Status is 200', ... })             │
│   业务异常识别：400 + INSUFFICIENT_FUNDS          │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│ isSuccess == false ? → return（跳过后续解析）     │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│ try { price = res.json('price') } catch { ... }  │
│   第 3 层防御：JSON 解析异常不崩 VU              │
└─────────────────────────────────────────────────┘
```

### 3.2 场景二：下单 (`placeOrder`) ⭐ 核心

```
执行器：ramping-arrival-rate
起始速率：20 RPS
阶段 1：20 → 100 RPS（1 分钟，线性增长）
阶段 2：100 → 200 RPS（1 分钟）
阶段 3：200 RPS 恒定（1 分钟）
VU：预分配 30，最大 200
```

**完整 7 步调用链：**

```
 Step 1 ─── weightedRandomSymbol()
             │
             │ CDF 累积分布算法
             │ BTC 40% | ETH 30% | 其余 8 个均分 30%
             ▼
 Step 2 ─── getOrderBySymbol(symbol)
             │
             │ 从 ordersBySymbol 索引表 O(1) 查找
             │ 返回一条 PreSignedOrder { apiKey, timestamp, signature, body }
             │ 降级策略：symbol 无预签名订单 → 全局随机取
             ▼
 Step 3 ─── 组装请求头
             │
             │ X-API-Key    ← signed.apiKey
             │ X-Timestamp  ← String(signed.timestamp)
             │ X-Signature  ← signed.signature
             │ Content-Type ← application/json
             ▼
 Step 4 ─── safePostWithRetry(POST /api/v1/order, body, {headers})
             │
             │ ┌──────────────────────────────────────┐
             │ │ attempt 0: 立即发起                    │
             │ │   ↓ 5xx/网络错误                       │
             │ │ attempt 1: 等 375~625ms 后重试          │
             │ │   ↓ 再次失败                           │
             │ │ attempt 2: 等 750~1250ms 后重试         │
             │ │   ↓ 再次失败                           │
             │ │ attempt 3: 等 1500~2500ms 后重试        │
             │ │   ↓ 再次失败                           │
             │ │ return null ← 所有重试耗尽              │
             │ └──────────────────────────────────────┘
             ▼
 Step 5 ─── check(res, { 'Order status 2xx', ... })
             │
             │ 区分：2xx 成功 / 4xx 业务错误
             │ 业务错误（如 INSUFFICIENT_FUNDS）→ 记录 metrics.orderErrors
             ▼
 Step 6 ─── metrics 记录
             │
             │ isSuccess → metrics.ordersPlaced.add(1)
             │ !isSuccess → metrics.orderErrors.add(1)
             │ 始终记录 → metrics.orderLatency.add(timings.duration)
             ▼
 Step 7 ─── try { body = res.json() } catch { ... }
             │
             │ 解析 { orderId, status, filledQty }
             │ 失败 → metrics.scriptErrors.add(1)
             ▼
          迭代完成，VU 等待下一次调度
```

### 3.3 场景三：健康检查 (`healthCheck`)

```
执行器：constant-vus
并发：10 VU（恒定）
持续：2 分钟
```

**逻辑流程：**

```
safeGetWithRetry(GET /api/v1/health)
  → null? return
  → metrics.healthChecks.add(1)
  → metrics.healthLatency.add(timings.duration)
  → check(res, { 'Health check 200' })
```

### 3.4 性能门禁（Thresholds）

```
thresholds:
  order_latency_ms    → p(95)<500ms, p(99)<1000ms  ← 下单延迟 SLA
  ticker_latency_ms   → p(95)<300ms                ← 行情延迟 SLA
  http_req_failed     → rate<10%                   ← 协议层错误率上限
  http_reqs           → rate>50/s                  ← 防止静默失败
```

thresholds 在 CI/CD 中可替代单元测试断言：P95 超限 → k6 退出码 99 → CI Job Failed → 阻止低性能代码合入。

---

## 4. 核心算法：加权随机选择 (CDF)

### 4.1 权重分配

| 交易对 | 权重 | 累积区间 |
|--------|------|----------|
| BTC-USDT | 40% | [0.00, 0.40) |
| ETH-USDT | 30% | [0.40, 0.70) |
| SOL-USDT | 5% | [0.70, 0.75) |
| BNB-USDT | 5% | [0.75, 0.80) |
| XRP-USDT | 4% | [0.80, 0.84) |
| ADA-USDT | 4% | [0.84, 0.88) |
| DOGE-USDT | 3% | [0.88, 0.91) |
| DOT-USDT | 3% | [0.91, 0.94) |
| LINK-USDT | 3% | [0.94, 0.97) |
| AVAX-USDT | 3% | [0.97, 1.00) |

### 4.2 CDF 算法

```
输入：无
输出：交易对名称（string）

1. rand = Math.random()          // [0, 1)
2. cumulative = 0
3. for each (symbol, weight) in WEIGHTS:
      cumulative += weight
      if rand < cumulative:
          return symbol
4. return WEIGHTS[last].symbol   // 浮点精度兜底
```

**复杂度：** O(n)，n=10。耗时 < 1μs，对 200 RPS 无影响。

### 4.3 为什么权重硬编码而非从 symbols.json 推导？

- 权重是**业务决策**，不应随配置文件的增删自动变化
- 新增交易对需在权重表中有**明确位置**（默认给均分 3%）
- 权重总和在 init 阶段**自动校验**：`Math.abs(sum - 1.0) < 0.001`

---

## 5. 预签名订单机制

### 5.1 为什么需要预签名？

```
性能优化：crypto.hmac() 在 VU context 中每迭代一次就计算一次
  100 VU × 100 迭代 = 10000 次 HMAC-SHA256 → 消耗大量 CPU

预签名方案：
  init context 中计算 1000 次 → SharedArray 共享
  VU context 中零计算，只从数组中取值
  P95 延迟可降低 10-15%（VU 数越大越明显）
```

### 5.2 签名格式（Binance 风格）

```
signPayload = timestamp + method + path + body
            = "1700000000000POST/api/v1/order{\"symbol\":\"BTC-USDT\",...}"

signature   = HMAC-SHA256(secretKey="test-secret", signPayload) → hex string
```

### 5.3 SharedArray 内存模型

```
┌─────────────────────────────────────────────┐
│                 Shared Memory               │
│  ┌───────────────────────────────────────┐  │
│  │  preSignedOrders[0..999]              │  │
│  │  1000 条 × ~200 bytes = ~200KB       │  │
│  │  所有 VU 共享，不重复占用内存          │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  ordersBySymbol (索引)                │  │
│  │  { "BTC-USDT": [0,5,12,...], ... }   │  │
│  │  预计算，O(1) 按 symbol 查找          │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
     ↑           ↑           ↑
    VU1         VU2        VU100
```

### 5.4 时间戳策略

```
每条订单偏移 50ms：
  order[0]   .timestamp = startTime + 0ms
  order[1]   .timestamp = startTime + 50ms
  order[2]   .timestamp = startTime + 100ms
  ...
  order[999] .timestamp = startTime + 49950ms ≈ startTime + 50s
```

**覆盖窗口：50 秒**，远小于典型服务端 2~5 分钟的时间戳容差。不会因 "timestamp too far in the future" 被拒绝。

---

## 6. 错误处理三层防御体系

```
┌──────────────────────────────────────────────────────────────┐
│ 第 1 层：safeGetWithRetry / safePostWithRetry                 │
│                                                              │
│   重试触发条件：                                              │
│     · HTTP 0   (网络错误：连接拒绝/DNS失败/超时)              │
│     · HTTP 429 (被限流)                                      │
│     · HTTP 5xx (服务端暂态故障)                               │
│                                                              │
│   不重试条件：                                                │
│     · HTTP 4xx (业务逻辑错误，重试无意义)                     │
│                                                              │
│   重试策略：指数退避 + 随机抖动 (±25%)                        │
│     attempt 0 → 立即                                         │
│     attempt 1 → 等 ~375-625ms                                │
│     attempt 2 → 等 ~750-1250ms                               │
│     attempt 3 → 等 ~1500-2500ms                              │
│     全部耗尽 → return null                                   │
│                                                              │
│   异常捕获：最外层 try-catch 兜底                              │
│     任何 JS 异常 → metrics.scriptErrors + 重试 or 返回 null   │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ 第 2 层：check() 业务校验                                    │
│                                                              │
│   · HTTP 200/201 → 成功                                      │
│   · HTTP 400 + INSUFFICIENT_FUNDS → 业务错误（不崩溃）       │
│   · check 不抛异常，只返回 true/false                         │
│   · 失败后通过 isSuccess 判断跳过后续处理                      │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ 第 3 层：业务数据解析 try-catch                               │
│                                                              │
│   try {                                                      │
│     const body = res.json()  // JSON 解析                    │
│     // 如果 body 不是合法 JSON，此处抛异常                    │
│   } catch (e) {                                              │
│     metrics.scriptErrors.add(1)  // 记录但不崩溃 VU           │
│     console.error(...)                                       │
│   }                                                          │
│                                                              │
│   这是最后一道防线，确保即使 API 返回畸形数据也不会中断 VU     │
└──────────────────────────────────────────────────────────────┘
```

### 6.1 为什么要加 ±25% 随机抖动？

```
不加抖动（所有 VU 同时重试）：
  time ──────────────────────────────────▶
  1000 VU 同时失败
  │
  ├── 全部等 500ms
  │
  └── 1000 VU 同时重试 → 再次压垮服务 💥

加抖动（±25% 随机分散）：
  time ──────────────────────────────────▶
  1000 VU 同时失败
  │
  ├── VU#1 等 375ms  → 重试
  ├── VU#2 等 487ms  → 重试
  ├── VU#3 等 512ms  → 重试
  ├── VU#4 等 598ms  → 重试
  │   ...平滑分散在 375~625ms...
  └── VU#1000 等 620ms → 重试
  服务端负载平滑 ✅
```

---

## 7. 自定义指标

| 指标名 | 类型 | 含义 | 记录位置 |
|--------|------|------|----------|
| `orders_placed` | Counter | 成功下单总数 | placeOrder |
| `order_latency_ms` | Trend (p90/95/99) | 下单延迟分布 | placeOrder |
| `order_errors` | Counter | 下单失败数（业务错误） | placeOrder / pollTicker |
| `ticker_latency_ms` | Trend | Ticker 请求延迟分布 | pollTicker |
| `ticker_requests` | Counter | Ticker 请求总数 | pollTicker |
| `health_latency_ms` | Trend | 健康检查延迟分布 | healthCheck |
| `health_checks` | Counter | 健康检查请求总数 | healthCheck |
| `http_retries` | Counter | HTTP 重试总次数 | error-boundary |
| `script_errors` | Counter | 脚本级崩溃次数 | error-boundary + 各场景 |

### 7.1 Grafana 面板建议

```promql
# 下单成功率
rate(orders_placed) / (rate(orders_placed) + rate(order_errors)) * 100

# 重试率（重试太多说明服务端不稳定）
rate(http_retries) / rate(ticker_requests) * 100

# P99 下单延迟
histogram_quantile(0.99, rate(order_latency_ms_bucket))

# 脚本崩溃率（应为 0，> 0 说明有 bug）
rate(script_errors)
```

---

## 8. k6 生命周期

```
┌──────────────────────────────────────────────────────┐
│ INIT CONTEXT (执行 1 次，所有 VU 共享)                │
│                                                      │
│  import 所有模块                                      │
│  SharedArray 构造：                                   │
│    · open('./data/orders.json') → 解析 JSON           │
│    · crypto.hmac() → 1000 次签名计算                  │
│    · 构建 ordersBySymbol 索引                         │
│  options 导出                                         │
│  weightedRandomSymbol() 等函数定义（不执行）            │
│                                                      │
│  ⚠️ 此阶段可用：open(), crypto, Date.now(), Math.*    │
│  ⚠️ 此阶段不可用：http.*, check(), sleep()            │
└──────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────┐
│ VU CONTEXT (每个 VU 独立循环执行)                      │
│                                                      │
│  while (scenario_duration) {                         │
│    pollTicker() / placeOrder() / healthCheck()       │
│    // 执行器按配置速率调度                             │
│  }                                                   │
│                                                      │
│  ⚠️ 此阶段可用：http.*, check(), sleep(), metrics.*   │
│  ⚠️ 此阶段不可用：crypto.*, open()                    │
└──────────────────────────────────────────────────────┘
```

---

## 9. 构建 & 部署

### 9.1 构建命令

```bash
npm run build
# = webpack && cp -r src/data dist/data
```

### 9.2 构建产物

```
dist/
├── mixed-scenario-v2.js   # 6.6 KB（webpack 打包的单文件）
└── data/
    ├── orders.json        # 118 KB（预生成订单数据）
    └── symbols.json       # 983 B（交易对配置）
总计：128 KB ≪ 500 KB 限制
```

### 9.3 运行

```bash
# 本地 mock 服务
k6 run dist/mixed-scenario-v2.js

# 指定目标地址
k6 run -e BASE_URL=https://staging-api.example.com dist/mixed-scenario-v2.js

# 输出到 Grafana Cloud
k6 run --out cloud dist/mixed-scenario-v2.js

# 输出 JSON 结果
k6 run --out json=results.json dist/mixed-scenario-v2.js
```

### 9.4 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BASE_URL` | `http://localhost:8080` | 目标 API 地址 |

---

## 10. 配置值参考

### 10.1 重试配置 (`error-boundary.ts`)

| 参数 | 值 | 说明 |
|------|-----|------|
| maxRetries | 3 | 最多 4 次尝试（含首次） |
| baseDelayMs | 500 | 基础退避延迟 |
| maxDelayMs | 10000 | 延迟上限 |
| retryOnStatus | [0, 429, 500, 502, 503, 504] | 触发重试的状态码 |

### 10.2 场景配置 (`Mixed-scenario-v2.ts`)

| 场景 | 执行器 | 速率/并发 | 持续 |
|------|--------|-----------|------|
| ticker_poll | constant-arrival-rate | 200 RPS | 2min |
| order_flow | ramping-arrival-rate | 20→100→200 RPS | 3min |
| health_check | constant-vus | 10 VU | 2min |

**Thresholds（性能门禁）**：

| 指标 | 条件 | 含义 |
|------|------|------|
| `order_latency_ms` | p(95)<500, p(99)<1000 | 下单延迟 SLA |
| `ticker_latency_ms` | p(95)<300 | 行情延迟 SLA |
| `http_req_failed` | rate<0.10 | 协议层错误率上限 |
| `http_reqs` | rate>50 | 防止静默失败 |

### 10.3 交易对权重 (`order-generator.ts`)

| 交易对 | 权重 | 参考价 |
|--------|------|--------|
| BTC-USDT | 40% | $65,000 |
| ETH-USDT | 30% | $3,400 |
| SOL-USDT | 5% | $140 |
| BNB-USDT | 5% | $300 |
| XRP-USDT | 4% | $0.50 |
| ADA-USDT | 4% | $0.40 |
| DOGE-USDT | 3% | $0.10 |
| DOT-USDT | 3% | $6.00 |
| LINK-USDT | 3% | $14.00 |
| AVAX-USDT | 3% | $30.00 |

---

## 11. 扩展指南

### 11.1 新增交易对

1. 在 `src/data/symbols.json` 中添加配置条目
2. 在 `src/modules/order-generator.ts` 的 `SYMBOL_WEIGHTS` 中添加权重（调整已有权重使总和 = 1.0）
3. 在 `REF_PRICES` 中添加参考价格

### 11.2 调整重试策略

修改 `src/error/error-boundary.ts` 中的 `RETRY_CONFIG`：

```typescript
const RETRY_CONFIG = {
  maxRetries: 5,        // 增加到 5 次
  baseDelayMs: 1000,    // 改为 1s 基础延迟
  maxDelayMs: 30000,    // 上限改为 30s
  retryOnStatus: [0, 429, 500, 502, 503, 504],
};
```

### 11.3 添加新场景

在 `src/scenarios/Mixed-scenario-v2.ts` 的 `options.scenarios` 中添加新配置块，并编写对应的 `export function`。

### 11.4 修改订单生成分布

如需修改 `orders.json` 中各交易对的分布比例，重新生成该文件即可。当前 1000 条订单的 symbol 分布取决于 JSON 生成时的随机分布；实际压测时由 `weightedRandomSymbol()` 控制选择权重，不依赖 JSON 内的分布。
