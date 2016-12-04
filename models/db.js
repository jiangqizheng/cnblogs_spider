var mongoose = require("mongoose");
// 根据需求设置db
mongoose.connect("mongodb://localhost/blogSpider");
// 监听错误
mongoose.connection.on("error", console.error.bind("console", "connection:Error"));
// 监听连接
mongoose.connection.once("open", console.log.bind("console", "数据库连接成功"));