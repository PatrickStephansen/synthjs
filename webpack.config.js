const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('path');

module.exports = {
  entry: './src/index.js',
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist')
  },
  mode: 'development',
  plugins: [new CopyWebpackPlugin(['src/index.html'])],
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.ico$/,
        use: {
          loader: 'file-loader',
          options: {
            name: '[name].[ext]',
            publicPath:'/'
          }
        }
      }
    ]
  }
};
