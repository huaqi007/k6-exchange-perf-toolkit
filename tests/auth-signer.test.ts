import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { AuthSigner } from '../src/modules/auth-signer'

describe('AuthSigner', () => {
  const apiKey = 'test-key'
  const secret = 'test-secret'
  const query = 'symbol=BTCUSDT&side=BUY&type=LIMIT'

  it('produces a correct HMAC-SHA256 hex signature', () => {
    const signer = new AuthSigner(apiKey, secret, 'binance')
    const expected = crypto.createHmac('sha256', secret).update(query).digest('hex')
    expect(signer.sign(query)).toBe(expected)
  })

  it('binance headers use X-MBX-APIKEY + X-SIGNATURE', () => {
    const signer = new AuthSigner(apiKey, secret, 'binance')
    const headers = signer.createHeaders(query)
    expect(headers['X-MBX-APIKEY']).toBe(apiKey)
    expect(headers['X-SIGNATURE']).toBeTruthy()
  })

  it('okx headers include timestamp in ISO-8601 with millis', () => {
    const signer = new AuthSigner(apiKey, secret, 'okx')
    const headers = signer.createHeaders(query)
    expect(headers['OK-ACCESS-KEY']).toBe(apiKey)
    expect(headers['OK-ACCESS-SIGN']).toBeTruthy()
    expect(headers['OK-ACCESS-TIMESTAMP']).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )
  })
})
