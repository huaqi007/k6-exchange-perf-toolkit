const path = require('path');
const glob = require('glob');

const scenarioFiles = glob.sync('./src/scenarios/*.ts');
const entries = {};
scenarioFiles.forEach((file) => {
  const name = path.basename(file, '.ts');
  entries[name] = path.resolve(__dirname, file);
});

module.exports = {
  mode: 'production',
  target: 'web',
  entry: entries,
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs',
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@src': path.resolve(__dirname, 'src'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  externals: [
    function ({ request }, callback) {
      if (/^(k6|k6\/.*)$/.test(request)) {
        return callback(null, 'commonjs ' + request);
      }
      callback();
    },
  ],
  stats: 'errors-warnings',
};
