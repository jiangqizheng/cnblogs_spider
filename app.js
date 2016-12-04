// 1.以首页为入口，抓取全部页数url;
// 2.解析文章页url，获取用户主页url;
// 3.解析用户主页，判断是否存在多个页面，获取当前用户所有文章;
// 4.抓取分析文章详情页，调用数据库查询更新;
// 5.分析数据,未完;

// express..后续显示..数据分析结果用
var express = require('express');
var cheerio = require("cheerio");
var superagent = require("superagent");
// 备选，用于解决编码问题
// var charset = require("superagent-charset");
var async = require("async");
var eventproxy = require("eventproxy");
// 数据库相关models
var db = require("./models/db.js");
var userdb = require("./models/userdb.js");
var articledb = require("./models/articledb.js");
var app = express();
var ep = new eventproxy();
// charset(superagent);

// 入口url
var baseUrl = "https://www.cnblogs.com/mvc/AggSite/PostList.aspx";
// 主页post请求内容数组
var pagePost = [];
// 用户主页连接
var userhomeUrl = [];
// 文章URL集合
var articleUrl = [];
// 存放数据库中articleurl比对资料
var articleUrldb = [];
// 并发数量控制
var asyncCount = 5;
// 并发量统计
var curCount = 0;
// 抓取计数
var urlindex = 0;
// 抓取异常量统计,只做统计。
var urlErrCount = 0;
// 初始时间
var starttime = new Date().getTime();


// 全局进程异常捕获
process.on('uncaughtException', function(err) {
	console.log('Caught exception: ' + err);
	console.log(err.stack);
	console.log("全局异常机制：捕获无法处理的异常，为避免发生新的错误，程序30s后重新启动！");
	setTimeout(function() {
		StART();
	}, 30000);
});

// 回调异常捕获处理
ep.fail(function(err) {
	console.log("捕获回调中的异常，为避免发生新的错误，程序30s后重新启动！");
	setTimeout(function() {
		StART();
	}, 30000);
});

// 循环获取主页连接post请求内需要的参数（页数）
for (var i = 1; i <= 200; i++) {
	pagePost.push({
		"CategoryType": "SiteHome",
		"ParentCategoryId": 0,
		"CategoryId": 808,
		"PageIndex": i,
		"TotalPostCount": 4000,
		"ItemListActionName": "PostList"
	});
};

StART();

function StART() {
	console.log("程序开始：当前正在加载数据库......");
	// 查询数据库中文章url
	articledb.find({}, {
		url: 1,
		_id: 0
	}, ep.done(function(result) {
		result.forEach(function(item) {
			articleUrldb.push(item.url);
		});
		console.log("比对数组长度：" + articleUrldb.length);
		ep.emit("start");
	}));
};

ep.tail("start", function(result) {
	spiderStart();
});

// 爬虫初始函数
function spiderStart() {
	// phaseOne
	phaseOne();

	function phaseOne() {
		async.mapLimit(pagePost, asyncCount, function(item, callback) {
			getpageurl(item, callback);
		}, ep.done(function(msg) {
			var newdate = new Date().getTime();
			console.log("————————————————————————————————————————————————————");
			console.log("phaseOne完成..共抓取到：" + articleUrl.length + "条articleUrl；抓取失败：" + urlErrCount + "项");
			console.log("共耗时：" + (newdate - starttime) / 1000 + "s");
			console.log("————————————————————————————————————————————————————");
			curCount = 0;
			urlindex = 0;
			ep.emit("phaseTwo", newdate);
		}));
	};
	// phaseOne处理函数
	function getpageurl(postjson, callback) {
		curCount++;
		urlindex++;
		console.log("phaseOne：目前并发数：" + curCount + "；正在抓取第：" + urlindex + "项");
		superagent
			.post(baseUrl)
			.set("User-Agent", "User-Agent:Mozilla/5.0 (Windows NT 6.1; WOW64)")
			.send(postjson)
			.end(function(err, data) {
				if (err) {
					curCount--;
					urlErrCount++;
					callback(null);
				};
				try {
					var $ = cheerio.load(data.text);
				} catch (e) {
					urlErrCount++;
					curCount--;
					callback(null);
				};
				$("a.titlelnk").each(function(i, item) {
					var url = $(this).attr("href");
					// 判断当前url数据库中是否已经存在
					if (articleUrldb.indexOf(url) == -1) {
						articleUrl.push(url);
					};
				});
				curCount--;
				callback(null);
			});
	};
	// phaseTwo
	ep.all("phaseTwo", function(beforedate) {
		var blogurlRegExp = /\b\.com\/(.+)(?=\/p\/)/;

		articleUrl.forEach(function(item) {
			if (userhomeUrl.indexOf("http://www.cnblogs.com/" + blogurlRegExp.exec(item)[0].slice(5)) == -1) {
				userhomeUrl.push("http://www.cnblogs.com/" + blogurlRegExp.exec(item)[0].slice(5));
			};
		});

		async.mapLimit(userhomeUrl, asyncCount, function(url, callback) {
			// async.mapSeries(userhomeUrl, function(url, callback) {
			homearticleUrl(url, callback);
		}, ep.done(function(msg) {
			var newdate = new Date().getTime();
			console.log("————————————————————————————————————————————————————");
			console.log("phaseTwo完成..共抓取到：" + articleUrl.length + "条articleUrl；抓取失败：" + urlErrCount + "项");
			console.log("共耗时：" + (newdate - beforedate) / 1000 + "s");
			console.log("—————————————————————————————————————————————————————");
			curCount = 0;
			// ep.emit("phaseThree", newdate);
		}));
	});

	// phaseTwo处理函数
	function homearticleUrl(url, callback) {
		// 当前项处理的url数组
		var StatusUrl = [];
		curCount++;
		console.log(" phaseTwo处理函数；正在抓取； " + url);
		superagent
		// 直接加载第二页，判断是否存在多页
			.get(url + "/default.html?page=2")
			.set("User-Agent", "User-Agent:Mozilla/5.0 (Windows NT 6.1; WOW64)")
			.end(function(err, data) {
				if (err) {
					urlErrCount++;
					curCount--;
					console.log(err);
					return callback(null);
				};
				try {
					var $ = cheerio.load(data.text);
				} catch (e) {
					urlErrCount++;
					curCount--;
					console.log(e);
					return callback(null);
				};
				if ($(".pager") != "") {
					var page = [];
					$(".pager").first().children("a").each(function(i, item) {
						var url = $(this).attr("href")
						if (page.indexOf(url) == -1) {
							page.push(url);
						};
					});
					if (page == []) {
						curCount--;
						return callback(null);
					};
					async.mapLimit(page, asyncCount, function(url, callback2) {
						allpage(url, callback2);
					}, ep.done(function() {
						// 交接数据进行数据库操作
						phaseThree(StatusUrl, callback);
					}));
				} else {
					dispose($);
					// 交接数据进行数据库操作
					phaseThree(StatusUrl, callback);
				};
				// 二次加载
				function allpage(url, callback2) {
					console.log("二次抓取；url：" + url);
					superagent
						.get(url)
						.end(function(err, data) {
							if (err) {
								urlErrCount++;
								return callback2(null);
							};
							try {
								var $ = cheerio.load(data.text);
							} catch (e) {
								urlErrCount++;
								return callback2(null);
							};
							dispose($);
							callback2(null);
						});
				};
				// 基本处理函数
				// 传入参数
				function dispose($) {
					$("a.postTitle2").each(function(i, item) {
						var url = $(this).attr("href");
						// 判断数据库，当前数组中是否存在重复
						if ((articleUrl.indexOf(url) == -1) && (articleUrldb.indexOf(url) == -1)) {
							StatusUrl.push(url);
						};
					});
				};
			});
	};

	// phaseThree
	function phaseThree(dataurl, callback) {
		if (dataurl == []) {
			curCount--;
			return callback(null);
		};
		// 此处非并发,（并发时,数据库查询并发时返回相同状态）
		// async.mapLimit(dataurl, asyncCount, function(url, callback) {
		async.mapSeries(dataurl, function(url, callback) {
			reptileArticle(url, callback);
		}, function(err) {
			console.log("—————————————————————————————————————————————————————");
			console.log("phaseThree完成..共抓取到：" + dataurl.length + "条Url");
			console.log("—————————————————————————————————————————————————————");
			curCount--;
			return callback(null);
		});
	};

	// phaseThree处理函数
	function reptileArticle(url, callback) {
		// 设置抓取延时
		var delay = parseInt((Math.random() * 888888) % 1000, 10);
		urlindex++;
		console.log(" 并发数：" + curCount + " ; 正在抓取第：" + urlindex + " 条数据;模拟延时：" + delay / 1000 + "s ;当前url：" + url);
		try {
			var blogurlRegExp = /\b\.com\/(.+)(?=\/p\/)/;
			var blogurl = blogurlRegExp.exec(url)[0].slice(5);
		} catch (e) {
			urlErrCount++;
			return callback(null);
		};
		superagent
			.get(url)
			.set("User-Agent", "User-Agent:Mozilla/5.0 (Windows NT 6.1; WOW64)")
			.end(function(err, data) {
				if (err) {
					urlErrCount++;
					return callback(null);
				};
				try {
					var $ = cheerio.load(data.text);
				} catch (e) {
					urlErrCount++;
					return callback(null);
				};
				var articleTitle = $("#cb_post_title_url").text();
				var articleBody = $("#cnblogs_post_body p").text();
				// get用户信息页
				superagent
					.get("http://www.cnblogs.com/mvc/blog/news.aspx?blogApp=" + blogurl)
					.set("User-Agent", "User-Agent:Mozilla/5.0 (Windows NT 6.1; WOW64)")
					.end(function(err, data) {
						if (err) {
							urlErrCount++;
							return callback(null);
						};
						try {
							var $ = cheerio.load(data.text);
						} catch (e) {
							urlErrCount++;
							return callback(null);
						};
						var userContent = [];
						$("#profile_block").children('a').each(function(i, elem) {
							userContent[i] = $(this).text();
						});
						// 判断是否推介博客
						var useroff = userContent.length == 5 ? true : false;

						// 数据库对照，去重存档
						userdb.findOne({
							name: userContent[0]
						}, function(err, result) {
							if (!result) {
								userdb.create({
									name: userContent[0],
									date: userContent[1],
									referral: useroff ? userContent[2] : "",
									fans: useroff ? userContent[3] : userContent[2],
									attention: useroff ? userContent[4] : userContent[3],
									homeurl: "http://www.cnblogs.com/" + blogurl,
									lastupdate: new Date(),
									article: {
										title: articleTitle,
										url: url,
									},
								}, ep.done("setuserdb"));
							} else {
								var urlArr = [];
								var content = {
									"title": articleTitle,
									"url": url,
								};
								result.article.forEach(function(item) {
									urlArr.push(item.url);
								});
								if (urlArr.indexOf(url) == -1) {
									result.article.push(content);
									result.lastupdate = new Date();
									result.save(ep.done("setuserdb"));
								} else {
									ep.emit("setuserdb", result);
								};
							};
						});
						// 对比文章url
						articledb.findOne({
							url: url
						}, function(err, result) {
							if (!result) {
								articledb.create({
									author: userContent[0],
									title: articleTitle,
									url: url,
									lastupdate: new Date(),
									body: articleBody,
								}, ep.done("setarticledb"));
							} else {
								ep.emit("setarticledb", result);
							};
						});
						// 两处数据库对照完毕，执行回调函数
						ep.all("setuserdb", "setarticledb", function(userdb, articledb) {
							setTimeout(function() {
								callback(null);
							}, delay);
						});
					});
			});
	};
};