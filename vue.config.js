module.exports = {
  devServer: {
    proxy: {
      "/": {
        //开发服务器跨域
        target: "http://localhost:3000",
        port: 3000,
        changeOrigin: true
      }
    }
  }
};
