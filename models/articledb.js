var mongoose = require("mongoose");

// 设置Schema
var articleSchema = new mongoose.Schema({
	author: String,
	title: String,
	url: String,
	// 文章被抓取的最新时间
	lastupdate: Date,
	body: String,
});

// 设置索引
articleSchema.index({
	url: 1
});


// 生成userModel
var articledb = mongoose.model("blogarticle", articleSchema);
// 暴露接口
module.exports = articledb;