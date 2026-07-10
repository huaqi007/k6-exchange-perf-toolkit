/**
 * modules/auth-signer.ts — API 签名工具
 *
 * 支持多交易所（Binance / OKX）HMAC-SHA256 签名，
 * 通过交易所标识切换签名头字段格式。
 */
import crypto from 'k6/crypto'
import encoding from 'k6/encoding'

/** 支持的交易所签名格式 */
export type ExchangeType = 'binance' | 'okx'

/**
 * AuthSigner 封装 API Key + Secret Key，生成签名请求头。
 */
export class AuthSigner {
  constructor(
    private readonly apiKey: string,
    private readonly secretKey: string,
    private readonly exchange: ExchangeType = 'binance'
  ) {}

  /**
   * 对查询字符串进行 HMAC-SHA256 签名。
   *
   * @param queryString 待签名的查询字符串（如 "symbol=BTCUSDT&side=BUY&..."）
   * @returns 十六进制签名字符串
   */
  sign(queryString: string): string {
    return crypto.hmac('sha256', this.secretKey, queryString, 'hex')
  }

  /**
   * 生成带签名的 HTTP 请求头。
   *
   * - Binance: 使用 X-MBX-APIKEY 头
   * - OKX:    使用 OK-ACCESS-KEY 头
   */
  createHeaders(queryString: string): Record<string, string> {
    const signature = this.sign(queryString)
    if (this.exchange === 'binance') {
      return {
        'X-MBX-APIKEY': this.apiKey,
        'X-SIGNATURE': signature,
      }
    }
    // OKX
    // OK-ACCESS-TIMESTAMP 要求 ISO 8601 格式且带毫秒，如 2020-12-08T09:08:57.715Z。
    // 由 epoch 毫秒显式构造，避免 goja 运行时 Date 行为差异。
    const timestamp = new Date(Date.now()).toISOString()
    return {
      'OK-ACCESS-KEY': this.apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': 'k6-perf-test',
    }
  }
}
