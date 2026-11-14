// gjj-site: the shop's short address, gjj.yingwang.dev. The files stay on GitHub Pages; this Worker fetches them
// from there and hands them out under the short address, so a push to main is all a release needs.
const ORIGIN = "https://yingwang.github.io/cyber-guojiajia";

export default {
  async fetch(req) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const url = new URL(req.url);
    let path = url.pathname;
    // The shop itself is app.html. Pages' index.html is the old address's forwarding page, which would send the visitor
    // straight back here.
    if (path === "/" || path === "/index.html") path = "/app.html";
    const up = await fetch(ORIGIN + path + url.search, {
      method: req.method,
      redirect: "manual",
      cf: { cacheEverything: true, cacheTtl: path.startsWith("/photo/img/") ? 3600 : 60 },
    });
    const headers = new Headers(up.headers);
    // Pages answers /classic with a redirect to its own address; keep the visitor on the short one.
    const loc = headers.get("location");
    if (loc) {
      const rest = loc.replace(/^https?:\/\/yingwang\.github\.io\/cyber-guojiajia/, "").replace(/^\/cyber-guojiajia(?=\/|$)/, "");
      headers.set("location", rest || "/");
    }
    return new Response(up.body, { status: up.status, statusText: up.statusText, headers });
  },
};
