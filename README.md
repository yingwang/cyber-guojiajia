# 赛博过家家

挑货、刷卡、等快递、拆箱，一分钱不花。

在线玩：https://yingwang.github.io/cyber-guojiajia/

商品名都是谐音的玩具货，与真实品牌无关。标「示例」的评价和问答是虚构的；其余是玩家自己写的，大家都看得见。

## 改页面

改 `src/app.html`，再跑 `python3 build.py`。它生成两份：`prototype.html`（Claude Artifact，评价只存在本机浏览器）和 `index.html`（GitHub Pages，评价、问答、点赞走共享后台）。

## 共享后台

`api/` 是 Cloudflare Worker 加 D1 数据库，地址 `https://gjj-api.yingwang.dev`。

- 玩家不用注册，第一次发言时领一个随机昵称和令牌（令牌只存哈希）。
- 收到包裹的人才能评价、回答；谁都能提问。每件商品每人一条评价、每题一个回答。
- 不收链接和联系方式；每人十分钟最多发 6 条、一天 40 条，同一网络一天 100 条。
- 来自三个不同网络的举报会自动隐藏一条帖子。管理员在「我的」页连点五下「设置」，输入管理口令，就能删帖、恢复被隐藏的帖子。

部署（在 `api/` 里，用 wrangler 登录后）：

```
wrangler d1 execute gjj --remote --file schema.sql   # 建表，可重复跑
wrangler deploy
```

密钥 `ADMIN_KEY`、`IP_SALT` 用 `wrangler secret put` 设，不进仓库。
