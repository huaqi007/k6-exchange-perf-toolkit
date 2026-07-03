/**
 * order-generator.ts — 订单生成器模块
 * ============================================================================
 * 职责：
 *   1. 加权随机选择交易对（BTC 40%、ETH 30%、其余 8 个均分 30%）
 *   2. 根据交易对的精度配置生成符合规范的订单
 *   3. 提供动态订单生成（供非预签场景参考）和加权符号选择（供预签场景）
 *
 * 加权策略：
 *   BTC-USDT  → 40%  （主力交易对，模拟真实流量分布）
 *   ETH-USDT  → 30%  （第二主力）
 *   SOL-USDT  → 5%   （热门山寨币）
 *   BNB-USDT  → 5%
 *   XRP-USDT  → 4%
 *   ADA-USDT  → 4%
 *   DOGE-USDT → 3%
 *   DOT-USDT  → 3%
 *   LINK-USDT → 3%
 *   AVAX-USDT → 3%
 *   总计      → 100%
 *
 * 使用方式：
 *   const symbol = weightedRandomSymbol(); // 按权重随机选交易对
 *   const order = generateOrder();         // 生成一笔随机订单（简易版）
 */

import { SYMBOLS_CONFIG } from '../config/symbols';

// ============================================================================
// 订单类型定义
// ============================================================================
export interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  price?: number;    // MARKET 订单不需要价格
  quantity: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';  // 订单有效期类型
}

// ============================================================================
// 加权随机选择配置
// ============================================================================

/**
 * 交易对权重配置
 *
 * 权重总和 = 1.0 (100%)
 * 使用累积分布函数 (CDF) 进行 O(n) 时间复杂度的随机选择
 *
 * 为什么用硬编码权重而不是动态计算？
 * - 权重是业务决策，不应该随 symbols.json 的增删而自动变化
 * - 明确标注每个交易对的权重，方便审阅和调整
 * - 新增交易对需要在权重表中有明确位置（默认给均分）
 */
const SYMBOL_WEIGHTS: Array<{ symbol: string; weight: number }> = [
  { symbol: 'BTC-USDT',  weight: 0.40 },
  { symbol: 'ETH-USDT',  weight: 0.30 },
  { symbol: 'SOL-USDT',  weight: 0.05 },
  { symbol: 'BNB-USDT',  weight: 0.05 },
  { symbol: 'XRP-USDT',  weight: 0.04 },
  { symbol: 'ADA-USDT',  weight: 0.04 },
  { symbol: 'DOGE-USDT', weight: 0.03 },
  { symbol: 'DOT-USDT',  weight: 0.03 },
  { symbol: 'LINK-USDT', weight: 0.03 },
  { symbol: 'AVAX-USDT', weight: 0.03 },
];

// init 时验证权重总和 ≈ 1.0
const TOTAL_WEIGHT = SYMBOL_WEIGHTS.reduce((sum, item) => sum + item.weight, 0);
if (Math.abs(TOTAL_WEIGHT - 1.0) > 0.001) {
  throw new Error(`[order-generator] 权重总和必须为 1.0，当前值: ${TOTAL_WEIGHT}`);
}

// ============================================================================
// 交易对参考价格（用于生成合理波动范围内的模拟订单价格）
// ============================================================================
const REF_PRICES: Record<string, number> = {
  'BTC-USDT':  65000,
  'ETH-USDT':   3400,
  'SOL-USDT':    140,
  'BNB-USDT':    300,
  'XRP-USDT':   0.50,
  'ADA-USDT':   0.40,
  'DOGE-USDT':  0.10,
  'DOT-USDT':    6.0,
  'LINK-USDT':   14,
  'AVAX-USDT':   30,
};

// ============================================================================
// 加权随机选择
// ============================================================================

/**
 * 使用累积分布函数 (CDF) 按权重随机选择交易对
 *
 * 算法流程：
 *   1. 生成 [0, 1) 的均匀随机数
 *   2. 遍历权重表，累加权重
 *   3. 当随机数小于等于累积权重时，返回当前交易对
 *
 * 示例（BTC 40%, ETH 30%, SOL 30%）：
 *   rand=0.25 → 累积到 BTC(0.40) → 返回 BTC-USDT
 *   rand=0.55 → 累积到 ETH(0.70) → 返回 ETH-USDT
 *   rand=0.85 → 累积到 SOL(1.00) → 返回 SOL-USDT
 *
 * 时间复杂度：O(n)，n = 权重表长度
 * 空间复杂度：O(1)
 *
 * @returns 按权重随机选择的交易对名称
 */
export function weightedRandomSymbol(): string {
  const rand = Math.random(); // [0, 1) 均匀分布

  let cumulative = 0;
  for (const item of SYMBOL_WEIGHTS) {
    cumulative += item.weight;
    // 当随机数落在当前累积区间内时返回
    if (rand < cumulative) {
      return item.symbol;
    }
  }

  // 兜底：浮点精度问题导致 rand 接近 1.0 时，返回最后一个
  return SYMBOL_WEIGHTS[SYMBOL_WEIGHTS.length - 1].symbol;
}

// ============================================================================
// 基于配置的订单生成（支持 10+ 交易对 + 精度约束）
// ============================================================================

/**
 * 根据加权随机选出的交易对 + 精度配置生成订单
 *
 * 特点：
 *   - 使用 weightedRandomSymbol() 按 40%/30%/... 权重选择
 *   - 使用 symbols.json 中的 pricePrecision / qtyPrecision 控制精度
 *   - 价格范围更灵活（参考价的 95%~105%）
 *
 * @returns 符合精度规范的订单请求
 */
export function generateOrderWeighted(): OrderRequest {
  const symbol = weightedRandomSymbol();

  // 从 SharedArray 中查找对应的精度配置
  const cfg = SYMBOLS_CONFIG.find((s) => s.symbol === symbol);
  const basePrice = REF_PRICES[symbol] || 100; // 兜底价格

  // 根据精度配置生成价格和数量
  const pricePrecision = cfg ? cfg.pricePrecision : 2;
  const qtyPrecision  = cfg ? cfg.qtyPrecision  : 4;

  // 价格波动范围：参考价的 95%~105%
  const priceRaw = basePrice * (0.95 + Math.random() * 0.10);
  // 使用精度幂次进行四舍五入
  const price = Math.round(priceRaw * Math.pow(10, pricePrecision)) / Math.pow(10, pricePrecision);

  // 数量范围：minQty ~ minQty*5（不超过 maxQty）
  const minQty = cfg ? cfg.minQty : 0.001;
  const maxQty = cfg ? Math.min(cfg.maxQty, minQty * 10) : 1;
  const qtyRaw = minQty + Math.random() * (maxQty - minQty);
  const quantity = Math.round(qtyRaw * Math.pow(10, qtyPrecision)) / Math.pow(10, qtyPrecision);

  return {
    symbol,
    side: Math.random() > 0.5 ? 'BUY' : 'SELL',
    type: Math.random() > 0.3 ? 'LIMIT' : 'MARKET',
    price: price,
    quantity: quantity,
    timeInForce: 'GTC',
  };
}
