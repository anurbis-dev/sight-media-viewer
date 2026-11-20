// A pass-through proxy for the phone app's ShotGrid link (docs/SHOTGRID.md) — only needed when the studio's
// ShotGrid site does not answer browser requests from the app's address (CORS). Deploy it as a Cloudflare Worker
// (Workers → Create → paste this file), set ALLOWED_SITES (and ALLOWED_ORIGIN if you like), then put the worker's
// address into the app: Settings → ShotGrid connection → Proxy.
//
// The protocol is the one Sight's own server speaks (/api/sg/fetch): GET/POST/PUT/DELETE <worker>/?url=<target>.
// It forwards the method, the body and the Authorization / Content-Type / Accept headers, adds CORS headers to the
// answer, and stores nothing. Targets: the sites listed in ALLOWED_SITES, plus https file links ShotGrid hands out
// for uploads / downloads (Amazon S3 / CloudFront), without any Authorization header.

const ALLOWED_SITES = ["https://mystudio.shotgrid.autodesk.com"];   // your site(s), no trailing slash
const ALLOWED_ORIGIN = "*";                                         // or the app's address, e.g. "https://<user>.github.io"
const FILE_HOSTS = [/\.amazonaws\.com$/i, /\.cloudfront\.net$/i];

export default {
  async fetch(req){
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let target;
    try { target = new URL(new URL(req.url).searchParams.get("url") || ""); } catch { return new Response("bad url", { status: 400, headers: cors }); }
    const origin = target.origin.toLowerCase();
    const onSite = ALLOWED_SITES.some((s) => s.toLowerCase() === origin);
    const fileLink = target.protocol === "https:" && FILE_HOSTS.some((re) => re.test(target.hostname));
    if (!onSite && !fileLink) return new Response("target not allowed", { status: 403, headers: cors });
    const h = new Headers();
    for (const k of ["Content-Type", "Accept"]) if (req.headers.get(k)) h.set(k, req.headers.get(k));
    if (onSite && req.headers.get("Authorization")) h.set("Authorization", req.headers.get("Authorization"));
    const r = await fetch(target.toString(), {
      method: req.method, headers: h, redirect: onSite ? "manual" : "follow",
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    });
    // a site file link redirecting to storage: followed here without the token
    if (onSite && r.status >= 300 && r.status < 400 && r.headers.get("Location") && req.method === "GET"){
      const loc = new URL(r.headers.get("Location"), target);
      if (loc.protocol !== "https:") return new Response("redirect not allowed", { status: 502, headers: cors });
      const r2 = await fetch(loc.toString());
      return withCors(r2, cors);
    }
    return withCors(r, cors);
  },
};
function withCors(r, cors){
  const out = new Response(r.body, r);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}
