/** k6/crypto 的测试 stub —— 用 Node.js crypto 实现 hmac。 */
import nodeCrypto from 'crypto'

export function hmac(
  algorithm: string,
  secret: string,
  data: string,
  outputEncoding: 'hex' | 'base64'
): string {
  return nodeCrypto.createHmac(algorithm, secret).update(data).digest(outputEncoding)
}

export default { hmac }
