/** k6/encoding 的测试 stub —— base64 编解码。 */
export function b64encode(input: string): string {
  return Buffer.from(input).toString('base64')
}

export function b64decode(input: string): string {
  return Buffer.from(input, 'base64').toString()
}

export default { b64encode, b64decode }
