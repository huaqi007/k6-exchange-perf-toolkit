# Docker 三题重练：COPY 范围、open() 路径、Dockerfile 排错

> 针对第3个月第1周考试第1/4/5题的薄弱点，纯动手练习。每道题 15-20 分钟。

---

## 练习 1 — 搞清楚 `COPY --from` 到底复制了什么

### 1.1 先看一张图

```
阶段1 (node:20-alpine)                    阶段2 (grafana/k6:latest)
┌─────────────────────────┐              ┌─────────────────────────┐
│ /app/                   │              │ /app/                   │
│   node_modules/  ← 200MB│              │   dist/        ← 128KB │
│   src/                  │   COPY       │     mixed-scenario-v2.js│
│   dist/          ← 128KB│   --from     │     data/              │
│     mixed-scenario-v2.js│   ======▶    │       orders.json      │
│     data/               │  /app/dist/  │       symbols.json     │
│       orders.json       │              │                         │
│       symbols.json      │              │                         │
│   package.json          │   ❌ 没复制   │   ❌ node_modules      │
│   tsconfig.json         │   ❌ 没复制   │   ❌ package.json      │
│   webpack.config.js     │   ❌ 没复制   │   ❌ webpack.config.js │
│   node:20-alpine ~150MB │   ❌ 没复制   │   grafana/k6 ~101MB   │
└─────────────────────────┘              └─────────────────────────┘
```

**核心规则**：`COPY --from=builder /app/dist/ /app/` 只复制 `dist/` 里面的内容。其他一切 —— `node_modules`、`package.json`、整个 `node:20-alpine` 操作系统 —— 全部丢弃。

### 1.2 动手验证

在项目目录执行：

```bash
# 步骤 1：构建多阶段镜像（刚才已经做过，跳过或重跑）
docker build -t k6-tests:multistage -f Dockerfile.multistage .

# 步骤 2：进入容器，亲眼看看 /app/ 里有什么
docker run --rm -it --entrypoint sh k6-tests:multistage
```

进入容器后执行：

```sh
# 看看 /app/ 下有哪些文件
ls /app/
# ✅ 预期：只有 mixed-scenario-v2.js 和 data/，没有 node_modules/、package.json、src/

# 看看 data 目录
ls /app/data/
# ✅ 预期：orders.json  symbols.json

# 确认 node_modules 不存在
ls /app/node_modules 2>&1
# ✅ 预期：ls: /app/node_modules: No such file or directory

# 确认 npm 也不存在（node:20-alpine 被丢弃了）
which npm 2>&1
# ✅ 预期：npm: not found 或空

# 退出
exit
```

### 1.3 变体：如果 COPY 写错了会怎样

```bash
# 模拟一个常见错误：COPY 整个阶段1（❌ 别真这样做，只是脑测）
# COPY --from=builder /app/ /app/
# → 这样会把 node_modules(200MB) + node:20-alpine 系统文件 全带进来
# → 最终镜像膨胀到 350MB+
```

**练习 1 自检**：

- [ ] 能在心里画出阶段1→阶段2的 COPY 边界线
- [ ] 能说出 `COPY --from=builder /app/dist/` 复制了哪些文件
- [ ] 能说出被丢弃的：node_modules、npm、node、alpine 系统文件

---

## 练习 2 — `open()` 路径 = 脚本目录 + 相对路径

### 2.1 唯一规则（背下来）

```
k6 的 open('./data/orders.json') 不是相对于：
  ❌ 项目根目录
  ❌ 当前工作目录
  ❌ Dockerfile 的 WORKDIR

而是相对于：
  ✅ k6 正在执行的那个脚本文件所在的目录
```

### 2.2 四种布局，判断对错

以下四种 Dockerfile + 容器布局，k6 脚本里都写了 `open('./data/orders.json')`。判断能否找到文件。

**布局 A**（你的项目现在的正确版本）：

```
容器：
/app/
├── mixed-scenario-v2.js          ← 脚本位置
└── data/
    └── orders.json               ← open('./data/orders.json')
                                  → /app/ + ./data/orders.json
                                  → /app/data/orders.json ✅
```

**布局 B**（错误的——脚本和数据在不同目录）：

```
容器：
/app/
├── scripts/
│   └── mixed-scenario-v2.js      ← 脚本位置
└── data/
    └── orders.json               ← open('./data/orders.json')
                                  → /app/scripts/ + ./data/orders.json
                                  → /app/scripts/data/orders.json ❌ 不存在！
```

**布局 C**（脚本在子目录，数据也在子目录）：

```
容器：
/home/user/
└── app/
    ├── mixed-scenario-v2.js      ← 脚本位置
    └── data/
        └── orders.json           ← open('./data/orders.json')
                                  → /home/user/app/ + ./data/orders.json
                                  → /home/user/app/data/orders.json ✅
```

**布局 D**（脚本在根目录，数据在深层）：

```
容器：
/
├── run.js                         ← 脚本位置
└── var/
    └── lib/
        └── data/
            └── orders.json        ← open('./data/orders.json')
                                   → / + ./data/orders.json
                                   → /data/orders.json ❌ 不存在！（data 在 /var/lib/data/）
```

### 2.3 动手验证

```bash
# 步骤 1：用错误布局构建一个测试镜像
cat > /tmp/bad.dockerfile << 'EOF'
FROM grafana/k6:latest
WORKDIR /app
COPY dist/ /app/scripts/
COPY dist/data/ /app/data/
ENTRYPOINT ["k6"]
CMD ["run", "/app/scripts/mixed-scenario-v2.js"]
EOF

docker build -t k6-path-test:bad -f /tmp/bad.dockerfile .
docker run --rm k6-path-test:bad 2>&1 | head -5
# ✅ 预期：GoError: stat /app/scripts/data/symbols.json: no such file or directory
#          ^^^^^^^^^^^^^^^^^^^^^^^^ 注意这个路径！就是 open() 实际查找的位置

# 步骤 2：用正确布局验证
docker run --rm k6-tests:multistage 2>&1 | head -20
# ✅ 预期：正常 k6 输出，无文件找不到错误
```

**练习 2 自检**：

- [ ] 能一句话说清楚 open() 路径 = 什么 + 什么
- [ ] 不用翻文档就能判断布局 B 为什么错
- [ ] 亲眼看到错误日志中的绝对路径

---

## 练习 3 — Dockerfile 排错速练

下面 5 个 Dockerfile 都有 bug。不看前面内容，独立判断：错在哪？报什么错？怎么改？

做题规则：每题 2 分钟，写下答案后再看答案。

---

### Bug 1

```dockerfile
FROM grafana/k6:latest
WORKDIR /app
COPY dist/ /app/scripts/
CMD ["run", "/app/scripts/mixed-scenario-v2.js"]
```

问题：___

报错信息关键词：___

最少改几处：___

---

### Bug 2

```dockerfile
FROM grafana/k6:latest
COPY dist/ /app/
CMD ["run", "/app/mixed-scenario-v2.js"]
```

问题：___

报错信息关键词：___

---

### Bug 3

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci && npx webpack && cp -r src/data dist/data

FROM grafana/k6:latest
COPY --from=builder /app/ /app/
CMD ["run", "/app/dist/mixed-scenario-v2.js"]
```

问题：___

报错信息关键词：___

---

### Bug 4

```dockerfile
FROM grafana/k6:latest
WORKDIR /app
COPY dist/ /app/
CMD ["run", "mixed-scenario-v2.js"]
```

问题：___

报错信息关键词：___

---

### Bug 5

```dockerfile
FROM grafana/k6:latest
WORKDIR /data
COPY dist/data/ /data/
COPY dist/mixed-scenario-v2.js /app/mixed-scenario-v2.js
CMD ["run", "/app/mixed-scenario-v2.js"]
```

问题：___

报错信息关键词：___

---

### 答案（做完再看）

<details>
<summary>Bug 1 答案</summary>

**问题**：缺少 `data/` 目录。`COPY dist/ /app/scripts/` 复制了 `dist/` 的全部内容到 `/app/scripts/`，所以数据在 `/app/scripts/data/orders.json`。但脚本也在 `/app/scripts/`，`open('./data/orders.json')` → `/app/scripts/data/orders.json` ✅。**等等，这个其实是对的！**

重新检查：`COPY dist/ /app/scripts/` — `dist/` 目录包含 `mixed-scenario-v2.js` 和 `data/` 子目录。复制到 `/app/scripts/` 后：
- `/app/scripts/mixed-scenario-v2.js` ✅
- `/app/scripts/data/orders.json` ✅
- `open('./data/orders.json')` → `/app/scripts/data/orders.json` ✅

**所以 Bug 1 其实能跑！** 它只是目录命名绕了点。真正的错误是**没有设置 ENTRYPOINT**——`CMD ["run", ...]` 需要一个可执行文件入口，k6 镜像默认 ENTRYPOINT 是 `["k6"]`，只要没被覆盖就没问题。

如果 Dockerfile 没设置 ENTRYPOINT，k6 镜像的默认 ENTRYPOINT 已经被设好了。所以这个其实没问题。

</details>

<details>
<summary>Bug 2 答案</summary>

**问题**：没有 `WORKDIR`。`COPY dist/ /app/` 复制了文件，但 `CMD` 使用绝对路径 `/app/mixed-scenario-v2.js`，所以脚本能找到。但脚本里的 `open('./data/orders.json')` 会从**当前工作目录**解析（默认是 `/`），变成 `/data/orders.json` → **不存在**！

```
报错：GoError: stat /data/orders.json: no such file or directory
```

**修复**：加 `WORKDIR /app`。

</details>

<details>
<summary>Bug 3 答案</summary>

**问题**：两个。1) `COPY --from=builder /app/ /app/` 复制了整个阶段1（含 node_modules/ ~200MB），镜像膨胀。2) `CMD` 路径写的是 `/app/dist/mixed-scenario-v2.js`，但复制到 `/app/` 后脚本在 `/app/mixed-scenario-v2.js`。

```
报错：stat /app/dist/mixed-scenario-v2.js: no such file or directory
```

**修复**：`COPY --from=builder /app/dist/ /app/`，`CMD ["run", "/app/mixed-scenario-v2.js"]`。

</details>

<details>
<summary>Bug 4 答案</summary>

**问题**：`CMD` 路径用了相对路径 `mixed-scenario-v2.js`，但 WORKDIR 是 `/app`，k6 会在 `/app/mixed-scenario-v2.js` 找脚本。因为 COPY 确实把文件复制到了 `/app/mixed-scenario-v2.js`，所以**实际上能跑**。

但这个写法不规范——相对路径依赖 WORKDIR，如果将来改了 WORKDIR 容易出 bug。**规范写法应使用绝对路径**。

如果实际测试这个能通过，说明没有真正的 bug。

</details>

<details>
<summary>Bug 5 答案</summary>

**问题**：`WORKDIR /data`，脚本在 `/app/mixed-scenario-v2.js`（绝对路径，CMD 能找到）。但脚本里 `open('./data/orders.json')` → `/data/data/orders.json` → **不存在**！因为 WORKDIR 是 `/data`，k6 认为当前工作目录是 `/data`，但 `open()` 是相对于脚本目录（`/app/`），所以实际路径是 `/app/data/orders.json` — 文件在这里吗？

COPY 把文件放在了 `/data/orders.json`。脚本在 `/app/mixed-scenario-v2.js`。`open('./data/orders.json')` → `/app/data/orders.json`。但文件实际在 `/data/orders.json` → **找不到**。

```
报错：GoError: stat /app/data/orders.json: no such file or directory
```

**修复**：把数据 COPY 到脚本所在目录下。统一用 `COPY dist/ /app/`。

</details>

---

## 最终自检

不翻文档，写出一份能正确运行的 Dockerfile，要求：

- 多阶段构建
- k6 脚本能通过 `open('./data/orders.json')` 正确加载数据
- 镜像不含 node_modules

写完后对照你项目里已有的 `Dockerfile.multistage`，看是否一致。
