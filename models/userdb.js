var mongoose = require("mongoose");

// 设置Schema
var userSchema = new mongoose.Schema({
	name: String,
	// 园龄
	date: String,
	// 推介博客
	referral: String,
	// 粉丝
	fans: String,
	// 关注
	attention: String,
	// 主页url
	homeurl: String,
	// 抓取到新文章后更新时间
	lastupdate: Date,
	// 文章
	article: [{
		_id: false,
		title: String,
		url: String,
	}],
});

// 设置索引
userSchema.index({
	name: 1
});


// 生成userModel
var userdb = mongoose.model("bloguser", userSchema);
// 暴露接口
module.exports = userdb;