const Controller = require("./controller");
const express = require("express");
const cors = require("express-cors");
const multer = require("multer");
const range = require("express-range");

const controller = new Controller();

const app = express();

// Accept-Ranges = acceptable-ranges
app.use(
  range({
    accept: ["items", "byte"]
  })
);

// 支持跨域
app.use(
  cors({
    allowedOrigins: ["localhost:8080", "localhost:8081"]
  })
);

const upload = multer({ dest: __dirname + "/upload" });

app.post("/verify", controller.handleVerifyUpload);

app.post("/merge", controller.handleMerge);

app.post("/uploads", upload.any(), controller.handleFormData);

app.get("/getString", (req, res) => {
  if (req.range) {
    const { first, last, unit } = req.range;
    if (unit !== "byte") {
      res.status(500).json("字符串不支持此类型的range");
      return;
    }
    const resString = "hello it is a session about http ranges";
    if (first > resString.length) {
      res.status(500).json("range超出范围");
      return;
    } else {
      const max = last > resString.length ? resString.length : last;
      res.send(resString.slice(first, max));
      return;
    }
  }
  res.status(500).json("请输入range范围");
});

app.get("/getArray", (req, res) => {
  if (req.range) {
    const { first, last, unit } = req.range;
    if (unit !== "items") {
      res.status(500).json("数组不支持此类型的range");
      return;
    }
    const resArray = new Array(100).fill(null).map((item, idx) => idx);
    if (first > resArray.length) {
      res.status(500).json("range超出范围");
      return;
    } else {
      const max = last > resArray.length ? resArray.length : last;
      res.send(resArray.slice(first, max));
      return;
    }
  }
  res.status(500).json("请输入range范围");
});

app.listen(3000, () => console.log("正在监听 3000 端口"));
