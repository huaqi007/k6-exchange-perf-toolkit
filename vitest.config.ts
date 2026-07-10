import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      // k6 运行时模块在单元测试中用本地 stub 替换
      'k6/metrics': path.resolve(__dirname, 'tests/stubs/k6-metrics.ts'),
      'k6/crypto': path.resolve(__dirname, 'tests/stubs/k6-crypto.ts'),
      'k6/encoding': path.resolve(__dirname, 'tests/stubs/k6-encoding.ts'),
      '@src': path.resolve(__dirname, 'src'),
    },
  },
})
