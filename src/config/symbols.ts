/**
 * symbols.ts — SharedArray 交易对配置加载
 * ============================================================================
 * 职责：
 *   1. 通过 SharedArray 加载 symbols.json（至少 10 个交易对）
 *   2. 所有 VU 共享同一份数据，无论多少并发都只占一份内存
 *   3. 导出类型化的 SymbolConfig 接口供其他模块使用
 *
 * 为什么用 SharedArray 而非普通 import？
 * - SharedArray 将数据放在共享内存中，100 个 VU 也只解析一次 JSON
 * - 普通 import 每个 VU 都会执行一次（在 k6 中每个 VU 是一个 JS 虚拟机）
 */

import { SharedArray } from 'k6/data';

/**
 * 交易对配置的数据结构
 */
export interface SymbolConfig {
  symbol: string;         // 交易对名称，如 "BTC-USDT"
  minQty: number;         // 最小下单量
  maxQty: number;         // 最大下单量
  pricePrecision: number; // 价格精度（小数位数）
  qtyPrecision: number;   // 数量精度（小数位数）
}

/**
 * 通过 SharedArray 加载交易对配置
 *
 * open() 路径说明：
 * - 路径相对于 k6 执行的主脚本位置
 * - Webpack 打包后主脚本在 dist/ 目录
 * - npm run build 会 cp src/data dist/data
 * - 因此路径为 ./data/symbols.json
 */
export const SYMBOLS_CONFIG = new SharedArray(
  'symbolsConfig',
  () => {
    // open() 路径支持环境变量覆盖，适配 k6-operator ConfigMap 挂载场景
    const DATA_PATH = __ENV.DATA_PATH || './data';
    const raw = JSON.parse(open(`${DATA_PATH}/symbols.json`));
    return raw as SymbolConfig[];
  },
) as unknown as SymbolConfig[];

/**
 * 预提取的交易对名称数组（避免每次从 SharedArray 遍历）
 * 在 init context 中只执行一次
 */
export const SYMBOL_NAMES: string[] = SYMBOLS_CONFIG.map((s) => s.symbol);
