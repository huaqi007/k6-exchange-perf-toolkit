const path = require('path');

module.exports = {
  mode: 'production',
  entry: {
    // ✅ 混合场景 v2（完善版 — placeOrder 调用 preSignedOrders + safePostWithRetry）
    'mixed-scenario-v2': './src/scenarios/Mixed-scenario-v2.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  target: 'node',
  stats: 'errors-only',
  // k6 内置模块不需要 webpack 打包（运行时注入）
  externals: /^k6(\/.*)?$/,
};
