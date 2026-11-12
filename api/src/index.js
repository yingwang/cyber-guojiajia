// 赛博过家家 shared board on Cloudflare Workers + D1.
// Anonymous identities (a random bearer token, stored hashed), reviews and answers only for goods the user has unboxed,
// questions from anyone, likes, reports that hide a post once three different networks flag it, and an admin key for removal.
import { PIDS } from "./pids.js";

const VALID = new Set(PIDS);
const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
const LEN = { r: [2, 300], q: [2, 120], a: [2, 200], nick: [1, 12] };
const HIDE_AFTER = 3;
const ADJ = ["爱拆箱的", "不剁手的", "等快递的", "爱比价的", "囤货的", "逛街的", "省钱的", "刷卡的", "挑颜色的", "看评价的", "蹲返场的", "收快递的"];
const NOUN = ["小熊", "橘猫", "企鹅", "柴犬", "海獭", "兔子", "刺猬", "松鼠", "水獭", "小鹿", "考拉", "仓鼠"];
const COLORS = ["#E2793A", "#3D7BE0", "#169E70", "#B36AD6", "#EE3F6B", "#C79661", "#2F8F9D", "#7A6CE0"];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-admin",
  "access-control-max-age": "86400",
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });
const fail = (error, status = 400) => json({ error }, status);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
}
async function body(req) {
  try {
    const t = await req.text();
    return t.length > 4000 ? null : JSON.parse(t || "{}");
  } catch {
    return null;
  }
}
async function count(env, sql, ...args) {
  const r = await env.DB.prepare(sql).bind(...args).first();
  return r ? r.n : 0;
}

// Strip control and direction characters, fold whitespace.
const clean = (s) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
// Ads almost always carry a link or a way to reach the seller, so those are what gets refused.
function problem(s, [lo, hi]) {
  const n = [...s].length;
  if (n < lo) return "多写几个字吧";
  if (n > hi) return `最多 ${hi} 个字`;
  const k = s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  if (/https?:|www\.|[a-z0-9-]\.(com|cn|net|org|io|top|xyz|cc|me|vip|shop|link|site|club|app|ly)\b/.test(k)) return "不能留链接";
  if (/(微信|薇信|威信|徽信|v信|vx|wx|qq|扣扣|电报|telegram|whatsapp|加我|私信我|私聊|联系我)/.test(k) || /\d{7,}/.test(k.replace(/[-_.]/g, "")))
    return "不能留联系方式";
  if (/(.)\1{9,}/u.test(k)) return "换个说法吧";
  return null;
}

async function who(req, env) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9_-]{20,80})$/);
  if (!m) return null;
  return env.DB.prepare("SELECT id, nick, color, banned FROM users WHERE token_hash = ?").bind(await sha(m[1])).first();
}
const isAdmin = (req, env) => !!env.ADMIN_KEY && env.ADMIN_KEY.length >= 16 && req.headers.get("x-admin") === env.ADMIN_KEY;
const ipHash = async (req, env) => (await sha((env.IP_SALT || "") + "|" + (req.headers.get("cf-connecting-ip") || ""))).slice(0, 32);

const SHAPE = "p.id, p.kind, p.pid, p.parent, p.stars, p.ci, p.text, p.created_at AS t, p.uid, p.hidden, p.reports, u.nick, u.color";
const out = (x, me) => ({
  id: x.id, kind: x.kind, parent: x.parent, stars: x.stars, ci: x.ci, text: x.text, t: x.t, nick: x.nick, color: x.color,
  mine: !!me && x.uid === me.id,
});

async function createUser(req, env) {
  const ip = await ipHash(req, env), t = Date.now();
  if ((await count(env, "SELECT COUNT(*) AS n FROM users WHERE ip_hash = ? AND created_at > ?", ip, t - HOUR)) >= 20)
    return fail("先歇一会儿再来", 429);
  const token = newToken(), nick = pick(ADJ) + pick(NOUN), color = pick(COLORS);
  await env.DB.prepare("INSERT INTO users (token_hash, nick, color, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha(token), nick, color, ip, t).run();
  return json({ token, nick, color });
}

async function getMe(req, env) {
  const me = await who(req, env);
  if (!me) return fail("请刷新页面", 401);
  const { results } = await env.DB.prepare("SELECT kind, pid, hidden FROM posts WHERE uid = ?").bind(me.id).all();
  const counts = { r: 0, q: 0, a: 0 }, reviewed = [];
  for (const x of results) {
    if (!x.hidden) counts[x.kind]++;
    if (x.kind === "r") reviewed.push(x.pid);
  }
  return json({ nick: me.nick, color: me.color, counts, reviewed });
}

async function setNick(req, env) {
  const me = await who(req, env);
  if (!me) return fail("请刷新页面", 401);
  const b = await body(req), nick = clean(b && b.nick);
  if (!nick) return fail("起个名字吧");
  const why = problem(nick, LEN.nick);
  if (why) return fail(why);
  if (nick === "我" || /(管理|官方|客服|过家家)/.test(nick)) return fail("换个名字吧");
  await env.DB.prepare("UPDATE users SET nick = ? WHERE id = ?").bind(nick, me.id).run();
  return json({ nick });
}

async function addOrders(req, env) {
  const me = await who(req, env);
  if (!me) return fail("请刷新页面", 401);
  const b = await body(req);
  const pids = [...new Set((b && Array.isArray(b.pids) ? b.pids : []).filter((p) => VALID.has(p)))].slice(0, 120);
  if (pids.length) {
    const t = Date.now();
    await env.DB.batch(pids.map((p) => env.DB.prepare("INSERT OR IGNORE INTO orders (uid, pid, created_at) VALUES (?, ?, ?)").bind(me.id, p, t)));
  }
  return json({ ok: true, n: pids.length });
}

async function getProduct(req, env, pid) {
  if (!VALID.has(pid)) return fail("没有这件商品", 404);
  const me = await who(req, env);
  const q = [
    env.DB.prepare(`SELECT ${SHAPE} FROM posts p JOIN users u ON u.id = p.uid WHERE p.pid = ? AND p.hidden = 0 AND u.banned = 0 ORDER BY p.created_at DESC LIMIT 300`).bind(pid),
    env.DB.prepare("SELECT target, COUNT(*) AS n FROM likes WHERE pid = ? GROUP BY target").bind(pid),
  ];
  if (me) q.push(env.DB.prepare("SELECT target FROM likes WHERE pid = ? AND uid = ?").bind(pid, me.id));
  const r = await env.DB.batch(q);
  return json({
    posts: r[0].results.map((x) => out(x, me)),
    likes: Object.fromEntries(r[1].results.map((x) => [x.target, x.n])),
    liked: me ? r[2].results.map((x) => x.target) : [],
  });
}

async function addPost(req, env, pid) {
  if (!VALID.has(pid)) return fail("没有这件商品", 404);
  const me = await who(req, env);
  if (!me) return fail("请刷新页面", 401);
  if (me.banned) return fail("暂时不能发言", 403);
  const b = await body(req);
  if (!b || !["r", "q", "a"].includes(b.kind)) return fail("格式不对");
  const kind = b.kind, text = clean(b.text), why = problem(text, LEN[kind]);
  if (why) return fail(why);
  let stars = null, ci = null, parent = null;
  if (kind !== "q") {
    if (!(await env.DB.prepare("SELECT 1 AS ok FROM orders WHERE uid = ? AND pid = ?").bind(me.id, pid).first()))
      return fail(kind === "r" ? "收到包裹后才能评价" : "收到包裹后才能回答", 403);
    ci = Number.isInteger(b.ci) && b.ci >= 0 && b.ci < 12 ? b.ci : 0;
  }
  if (kind === "r") {
    stars = Number.isInteger(b.stars) && b.stars >= 1 && b.stars <= 5 ? b.stars : 0;
    if (!stars) return fail("打个星吧");
    if (await env.DB.prepare("SELECT 1 AS ok FROM posts WHERE uid = ? AND pid = ? AND kind = 'r'").bind(me.id, pid).first())
      return fail("这件已经评过了", 409);
  }
  if (kind === "a") {
    parent = String(b.parent || "");
    let m;
    if ((m = parent.match(/^s:([a-z0-9-]{1,40}):(\d)$/))) {
      if (m[1] !== pid) return fail("格式不对");
    } else if ((m = parent.match(/^q:(\d{1,12})$/))) {
      if (!(await env.DB.prepare("SELECT 1 AS ok FROM posts WHERE id = ? AND kind = 'q' AND pid = ? AND hidden = 0").bind(+m[1], pid).first()))
        return fail("这个问题不在了", 404);
    } else return fail("格式不对");
    if (await env.DB.prepare("SELECT 1 AS ok FROM posts WHERE uid = ? AND parent = ? AND kind = 'a'").bind(me.id, parent).first())
      return fail("这个问题你答过了", 409);
  }
  const t = Date.now(), ip = await ipHash(req, env);
  const n = (
    await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE uid = ? AND created_at > ?").bind(me.id, t - 10 * MIN),
      env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE uid = ? AND created_at > ?").bind(me.id, t - DAY),
      env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE ip_hash = ? AND created_at > ?").bind(ip, t - DAY),
      env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE uid = ? AND text = ? AND created_at > ?").bind(me.id, text, t - DAY),
    ])
  ).map((x) => x.results[0].n);
  if (n[0] >= 6) return fail("发得太快了，歇几分钟再来", 429);
  if (n[1] >= 40 || n[2] >= 100) return fail("今天发得够多了，明天再来", 429);
  if (n[3] > 0) return fail("这段话刚发过", 409);
  const res = await env.DB.prepare("INSERT INTO posts (kind, pid, parent, uid, stars, ci, text, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(kind, pid, parent, me.id, stars, ci, text, ip, t).run();
  return json({ post: { id: res.meta.last_row_id, kind, parent, stars, ci, text, t, nick: me.nick, color: me.color, mine: true } });
}

async function delPost(req, env, id) {
  const p = await env.DB.prepare("SELECT id, kind, uid FROM posts WHERE id = ?").bind(id).first();
  if (!p) return json({ ok: true });
  if (isAdmin(req, env)) {
    await env.DB.prepare("UPDATE posts SET hidden = 2 WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  const me = await who(req, env);
  if (!me || me.id !== p.uid) return fail("只能删自己发的", 403);
  const s = [env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id), env.DB.prepare("DELETE FROM reports WHERE post_id = ?").bind(id)];
  if (p.kind === "r") s.push(env.DB.prepare("DELETE FROM likes WHERE target = ?").bind("r:" + id));
  if (p.kind === "q") s.push(env.DB.prepare("UPDATE posts SET hidden = 2 WHERE kind = 'a' AND parent = ?").bind("q:" + id));
  await env.DB.batch(s);
  return json({ ok: true });
}

async function like(req, env) {
  const me = await who(req, env);
  if (!me) return fail("请刷新页面", 401);
  const b = await body(req), target = String((b && b.target) || "");
  let pid, m;
  if ((m = target.match(/^s:([a-z0-9-]{1,40}):(\d)$/)) && VALID.has(m[1])) pid = m[1];
  else if ((m = target.match(/^r:(\d{1,12})$/))) {
    const p = await env.DB.prepare("SELECT pid, uid FROM posts WHERE id = ? AND kind = 'r' AND hidden = 0").bind(+m[1]).first();
    if (!p) return fail("这条评价不在了", 404);
    if (p.uid === me.id) return fail("不能给自己点");
    pid = p.pid;
  } else return fail("格式不对");
  const t = Date.now();
  const had = await env.DB.prepare("SELECT 1 AS ok FROM likes WHERE target = ? AND uid = ?").bind(target, me.id).first();
  if (had) await env.DB.prepare("DELETE FROM likes WHERE target = ? AND uid = ?").bind(target, me.id).run();
  else {
    if ((await count(env, "SELECT COUNT(*) AS n FROM likes WHERE uid = ? AND created_at > ?", me.id, t - HOUR)) >= 300) return fail("点得太快了", 429);
    await env.DB.prepare("INSERT OR IGNORE INTO likes (target, uid, pid, created_at) VALUES (?, ?, ?, ?)").bind(target, me.id, pid, t).run();
  }
  return json({ liked: !had, likes: await count(env, "SELECT COUNT(*) AS n FROM likes WHERE target = ?", target) });
}

async function report(req, env) {
  const me = await who(req, env);
  if (!me) return fail("请刷新页面", 401);
  const b = await body(req), id = Number(b && b.id);
  if (!Number.isInteger(id) || id <= 0) return fail("格式不对");
  const p = await env.DB.prepare("SELECT uid FROM posts WHERE id = ?").bind(id).first();
  if (!p) return json({ ok: true });
  if (p.uid === me.id) return fail("这是你自己发的");
  const t = Date.now(), ip = await ipHash(req, env);
  if ((await count(env, "SELECT COUNT(*) AS n FROM reports WHERE uid = ? AND created_at > ?", me.id, t - DAY)) >= 30) return fail("今天举报得够多了", 429);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO reports (post_id, uid, ip_hash, created_at) VALUES (?, ?, ?, ?)").bind(id, me.id, ip, t).run();
  if (r.meta.changes) {
    // Several identities from one network count once, so one person cannot hide a post alone.
    const nets = await count(env, "SELECT COUNT(DISTINCT ip_hash) AS n FROM reports WHERE post_id = ?", id);
    await env.DB.prepare("UPDATE posts SET reports = reports + 1, hidden = CASE WHEN hidden = 0 AND ? >= ? THEN 1 ELSE hidden END WHERE id = ?")
      .bind(nets, HIDE_AFTER, id).run();
  }
  return json({ ok: true });
}

async function reported(req, env) {
  if (!isAdmin(req, env)) return fail("口令不对", 403);
  const { results } = await env.DB.prepare(
    `SELECT ${SHAPE} FROM posts p JOIN users u ON u.id = p.uid WHERE p.reports > 0 OR p.hidden > 0 ORDER BY p.created_at DESC LIMIT 100`
  ).all();
  return json({ posts: results.map((x) => ({ ...out(x, null), pid: x.pid, hidden: x.hidden, reports: x.reports })) });
}

async function setHidden(req, env) {
  if (!isAdmin(req, env)) return fail("口令不对", 403);
  const b = await body(req), id = Number(b && b.id), h = Number(b && b.hidden);
  if (!Number.isInteger(id) || ![0, 2].includes(h)) return fail("格式不对");
  if (h === 0)
    await env.DB.batch([
      env.DB.prepare("UPDATE posts SET hidden = 0, reports = 0 WHERE id = ?").bind(id),
      env.DB.prepare("DELETE FROM reports WHERE post_id = ?").bind(id),
    ]);
  else await env.DB.prepare("UPDATE posts SET hidden = 2 WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const path = new URL(req.url).pathname.replace(/\/+$/, ""), M = req.method;
    let m;
    try {
      if (path === "/api/me") return M === "POST" ? await createUser(req, env) : await getMe(req, env);
      if (path === "/api/me/nick" && M === "POST") return await setNick(req, env);
      if (path === "/api/orders" && M === "POST") return await addOrders(req, env);
      if ((m = path.match(/^\/api\/p\/([a-z0-9-]{1,40})$/)) && M === "GET") return await getProduct(req, env, m[1]);
      if ((m = path.match(/^\/api\/p\/([a-z0-9-]{1,40})\/posts$/)) && M === "POST") return await addPost(req, env, m[1]);
      if ((m = path.match(/^\/api\/posts\/(\d{1,12})$/)) && M === "DELETE") return await delPost(req, env, +m[1]);
      if (path === "/api/like" && M === "POST") return await like(req, env);
      if (path === "/api/report" && M === "POST") return await report(req, env);
      if (path === "/api/admin/check") return isAdmin(req, env) ? json({ ok: true }) : fail("口令不对", 403);
      if (path === "/api/admin/reported") return await reported(req, env);
      if (path === "/api/admin/hide" && M === "POST") return await setHidden(req, env);
      if (path === "" || path === "/api") return json({ ok: true });
      return fail("没有这个地址", 404);
    } catch (e) {
      console.error(e);
      return fail("服务器出了点问题，稍后再试", 500);
    }
  },
};
