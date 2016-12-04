// 爬虫逻辑
// 1.以首页为入口，抓取全部200页url;
// 2.解析文章url，获取用户主页url;
// 3.解析用户主页，获取文章;
// 4.抓取全部文章，进行数据库存取操作;
// 5.分析数据;


var express = require('express');
var cheerio = require("cheerio");
var superagent = require("superagent");
var charset = require("superagent-charset");
// 此处主要用于控制并发数
var async = require("async");
// 此处主要用于流程控制
var eventproxy = require("eventproxy");


// 数据库相关models
var db = require("./models/db.js");
var userdb = require("./models/userdb.js");
var articledb = require("./models/articledb.js");


var app = express();
var ep = new eventproxy();
charset(superagent);



// 抓取失败统计
var urlErrCount = 0;
// 通过fail处理的异常
var failErrCount = 0;
// 通过uncaughtException处理的异常
var uncaughtErrCount = 0;
// 确定执行阶段
var newPhase = 0;


// 入口url
var baseUrl = "https://www.cnblogs.com/mvc/AggSite/PostList.aspx";
// 主页post请求内容数组
var pagePost = [];
// 用户主页连接
var userhomeUrl = [];
// 文章URL集合
var articleUrl = [];
// 记录程序运行中url，程序崩溃时调用，继续进程
var newarticleUrl = [];
// 存放数据库中articleurl比对资料
var articleUrldb = [];
// 并发数量控制
var asyncCount = 10;
// 并发量统计
var curCount = 0;
// 抓取计数
var urlindex = 0;
// 初始时间
var starttime = new Date().getTime();

// 为提升抓取效率， 内部错误处理为try， 出现错误则进入下一函数
// 全局进程异常捕获
process.on('uncaughtException', function(err) {
	console.log('Caught exception: ' + err);
	console.log(err.stack);
	switch (newPhase) {
		case 1:
			console.log("phaseOne发生了一个错误：" + err);
			phaseOne();
			break;
		case 2:
			console.log("phaseTwo发生了一个错误：" + err);
			ep.emit("phaseTwo");
			break;
		case 3:
			console.log("phaseThree发生了一个错误：" + err);
			articleUrl = newarticleUrl;
			ep.emit("phaseThree");
			break;
	};
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

console.log("程序开始：当前正在加载数据库......");
// 查询数据库中文章url
articledb.find({}, {
	url: 1,
	_id: 0
}, ep.done(function(result) {
	result.forEach(function(item) {
		articleUrldb.push(item.url);
	});
	ep.emit("start");
}));


ep.all("start", function(result) {
	spiderStart();
});


// 爬虫初始函数
function spiderStart() {

	// 异常捕获处理
	ep.fail(function(err) {
		failErrCount++;
		switch (newPhase) {
			case 1:
				console.log("phaseOne发生了一个错误：" + err);
				phaseOne();
				break;
			case 2:
				console.log("phaseTwo发生了一个错误：" + err);
				ep.emit("phaseTwo");
				break;
			case 3:
				console.log("phaseThree发生了一个错误：" + err);
				articleUrl = newarticleUrl;
				ep.emit("phaseThree");
				break;
		};
	});

	// phaseOne
	phaseOne();

	function phaseOne() {
		newPhase = 1;
		async.mapLimit(pagePost, asyncCount, function(item, callback) {
			getpageurl(item, callback);
		}, ep.done(function(msg) {
			var newdate = new Date().getTime();
			console.log("———————————————————————————————————————————————————————————————————————————————");
			console.log("———————————————————————————————————————————————————————————————————————————————");
			console.log("phaseOne完成..共抓取到：" + articleUrl.length + "条articleUrl；抓取失败：" + urlErrCount + "项");
			console.log("共耗时：" + (newdate - starttime) / 1000 + "s");
			console.log("———————————————————————————————————————————————————————————————————————————————");
			console.log("———————————————————————————————————————————————————————————————————————————————");
			curCount = 0;
			urlindex = 0;
			ep.emit("phaseTwo", newdate);
		}));
	};
	// phaseOne处理函数
	function getpageurl(postjson, callback) {
		curCount++
		urlindex++
		console.log("phaseOne：目前并发数：" + curCount + "；正在抓取第：" + urlindex + "项");
		superagent
			.post(baseUrl)
			.send(postjson)
			.end(function(err, data) {
				if (err) {
					curCount--;
					urlErrCount++;
					return callback(null);
				};
				try {
					var $ = cheerio.load(data.text);
				} catch (e) {
					urlErrCount++
					curCount--
					return callback(null);
				};
				$("a.titlelnk").each(function(i, item) {
					var url = $(this).attr("href");
					// 判断当前url数据库中是否已经存在
					if (articleUrldb.indexOf(url) == -1) {
						articleUrl.push(url);
					};
				});
				curCount--
				callback(null);
			});
	};


	// phaseTwo
	ep.all("phaseTwo", function(beforedate) {
		newPhase = 2;
		var blogurlRegExp = /\b\.com\/(.+)(?=\/p\/)/;

		articleUrl.forEach(function(item) {
			if (userhomeUrl.indexOf("http://www.cnblogs.com/" + blogurlRegExp.exec(item)[0].slice(5)) == -1) {
				userhomeUrl.push("http://www.cnblogs.com/" + blogurlRegExp.exec(item)[0].slice(5));
			};
		});
		async.mapLimit(userhomeUrl, asyncCount, function(url, callback) {
			homearticleUrl(url, callback);
		}, ep.done(function(msg) {
			var newdate = new Date().getTime();
			console.log("———————————————————————————————————————————————————————————————————————————————");
			console.log("———————————————————————————————————————————————————————————————————————————————");
			console.log("phaseTwo完成..共抓取到：" + articleUrl.length + "条articleUrl；抓取失败：" + urlErrCount + "项");
			console.log("共耗时：" + (newdate - beforedate) / 1000 + "s");
			console.log("———————————————————————————————————————————————————————————————————————————————");
			console.log("———————————————————————————————————————————————————————————————————————————————");
			curCount = 0;
			urlindex = 0;
			ep.emit("phaseThree", newdate);
		}));
	});

	// phaseTwo处理函数
	function homearticleUrl(url, callback) {
		// 模拟抓取延时
		var delay = parseInt((Math.random() * 888888) % 1000, 10);
		curCount++;
		urlindex++;
		console.log("phaseTwo：并发及错误监控：" + curCount + "；正在抓取第：" + urlindex + "条数据；url为; " + url + " ；延迟模拟:" + delay);
		superagent
			.get(url + "/default.html?page=2")
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
					return callabck(null);
				};
				if ($(".pager") != "") {
					var page = [];
					$(".pager").first().children("a").each(function(i, item) {
						var url = $(this).attr("href")
						if (page.indexOf(url) == -1) {
							page.push(url);
						};
					});
					async.mapLimit(page, asyncCount, function(url, callback2) {
						allpage(url, callback2);
					}, function(err) {
						setTimeout(function() {
							curCount--;
							callback(null);
						}, delay);
					});
				} else {
					dispose($);
					setTimeout(function() {

						curCount--;
						callback(null);
					}, delay);
				};
				// 基本处理函数
				// 传入参数，此处注意作用域
				function dispose($) {
					$("a.postTitle2").each(function(i, item) {
						var url = $(this).attr("href");
						// 判断数据库，当前数组中是否存在重复
						if ((articleUrl.indexOf(url) == -1) && (articleUrldb.indexOf(url) == -1)) {
							articleUrl.push(url);
						};
					});
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
			});
	};
	// phaseThree
	ep.all("phaseThree", function(beforedate) {
		newPhase = 3;
		async.mapLimit(articleUrl, asyncCount, function(url, callback) {
			reptileArticle(url, callback);
		}, ep.done(function(msg) {
			console.log("———————————————————————————————————————————————————————————————————————————————");
			console.log("———————————————————————————————————————————————————————————————————————————————");
			console.log("phaseThree完成..共抓取到：" + articleUrl.length + "条articleUrl；抓取失败：" + urlErrCount + "项");
			console.log("———————————————————————————————————————————————————————————————————————————————");
			console.log("———————————————————————————————————————————————————————————————————————————————");
			curCount = 0;
			urlindex = 0;
		}));
	});
	// phaseThree处理函数
	function reptileArticle(url, callback) {
		var delay = parseInt((Math.random() * 888888) % 1000, 10);
		curCount++;
		urlindex++;
		console.log("phaseThree：并发及错误监控：" + curCount + "；正在抓取第：" + urlindex + "条数据；url为; " + url + " ；延迟模拟:" + delay);
		try {
			var blogurlRegExp = /\b\.com\/(.+)(?=\/p\/)/;
			var blogurl = blogurlRegExp.exec(url)[0].slice(5);
		} catch (e) {
			curCount--;
			urlErrCount++;
			return callback(null);
		}
		superagent
			.get(url)
			.end(function(err, data) {
				if (err) {
					curCount--;
					urlErrCount++;
					return callback(null);
				};
				try {
					var $ = cheerio.load(data.text);
				} catch (e) {
					curCount--;
					urlErrCount++;
					return callback(null);
				};
				var articleTitle = $("#cb_post_title_url").text();
				var articleBody = $("#cnblogs_post_body p").text();
				// get用户信息页
				superagent
					.get("http://www.cnblogs.com/mvc/blog/news.aspx?blogApp=" + blogurl)
					.end(function(err, data) {
						if (err) {
							curCount--;
							urlErrCount++;
							return callback(null);
						};
						try {
							var $ = cheerio.load(data.text);
						} catch (e) {
							curCount--;
							urlErrCount++;
							return callback(null);
						};
						var userContent = [];
						$("#profile_block").children('a').each(function(i, elem) {
							userContent[i] = $(this).text();
						});
						// 判断是否推介博客（极少量误差不去理会哈）
						var useroff = userContent.length == 5 ? true : false;

						// 数据库对照，去重存档
						// 对比用户
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
							// 备份函数处理进度
							newarticleUrl = articleUrl.slice(urlindex);
							setTimeout(function() {
								curCount--;
								callback(null);
							}, delay);
						});
					});
			});
	};
};