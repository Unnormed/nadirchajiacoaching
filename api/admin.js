/* Beveiligd admin-paneel op /admin.
   - Eigen loginpagina met sessie-cookie (geen browser-venster).
   - Tab "Bezoekers": cookieloze statistieken (Upstash Redis).
   - Tab "Inhoud": tekst per sectie bewerken met opmaak (vet/cursief/link),
     versiegeschiedenis en 1-klik terugzetten. Wijzigingen staan meteen live
     (de site haalt ze op via /api/content + /cms.js).

   Omgevingsvariabelen:
   - ADMIN_PASSWORD (verplicht), ADMIN_USER (optioneel, standaard "nadir")
   - ADMIN_SECRET   (optioneel, sleutel voor de sessie-cookie; valt terug op ADMIN_PASSWORD)
   - KV_REST_API_URL / KV_REST_API_TOKEN (Upstash) */

const crypto = require("crypto");

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USER = process.env.ADMIN_USER || "nadir";
const PASS = process.env.ADMIN_PASSWORD || "";
const SECRET = process.env.ADMIN_SECRET || PASS || "ncc-fallback-secret";

/* ---------- Sessie-cookie (HMAC-ondertekend) ---------- */
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signToken(payload) {
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", SECRET).update(p).digest());
  return p + "." + sig;
}
function verifyToken(tok) {
  if (!tok || tok.indexOf(".") < 0) return null;
  const parts = tok.split(".");
  const p = parts[0], sig = parts[1] || "";
  const exp = b64url(crypto.createHmac("sha256", SECRET).update(p).digest());
  if (sig.length !== exp.length) return null;
  try { if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null; } catch (e) { return null; }
  try {
    const payload = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!payload || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function getSession(req) {
  return verifyToken(parseCookies(req)["ncc_session"]);
}
function setSession(res) {
  const tok = signToken({ u: USER, exp: Date.now() + 30 * 86400000 });
  res.setHeader("Set-Cookie", "ncc_session=" + tok + "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + 30 * 86400);
}
function clearSession(res) {
  res.setHeader("Set-Cookie", "ncc_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
}

/* ---------- Redis (Upstash REST) ---------- */
async function redisPipe(cmds) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const r = await fetch(REDIS_URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return Array.isArray(j) ? j.map((x) => (x && typeof x === "object" && "result" in x ? x.result : x)) : null;
}

/* ---------- Helpers ---------- */
function brusselsDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(date);
}
function lastDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(brusselsDay(new Date(now - i * 86400000)));
  return out;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function nl(n) {
  try { return Number(n).toLocaleString("nl-BE"); } catch (e) { return String(n); }
}
function toPairs(hgetall) {
  const pairs = [];
  if (Array.isArray(hgetall)) {
    for (let i = 0; i < hgetall.length; i += 2) pairs.push([hgetall[i], Number(hgetall[i + 1]) || 0]);
  } else if (hgetall && typeof hgetall === "object") {
    for (const k in hgetall) pairs.push([k, Number(hgetall[k]) || 0]);
  }
  return pairs.sort((a, b) => b[1] - a[1]);
}

/* ---------- Inhoud (CMS) ---------- */
/* type: 'line' = enkele regel (geen opmaak) · 'rich' = tekst met vet/cursief/link.
   'def' = de huidige tekst in de HTML. Uitbreiden? Voeg een veld toe én geef het
   element in de HTML een data-cms="id" (en data-cms-type="rich" voor opmaak). */
const FIELDS = [
  { id: "home.hero.kicker", group: "Hero", label: "Kicker (label bovenaan)", type: "line", def: "Build A Balanced Life" },
  { id: "home.hero.body", group: "Hero", label: "Intro-paragraaf", type: "rich", def: "Twaalf weken. Zes sessies. Eén duurzaam systeem voor meer balans, energie en richting. Voor werkende mensen die merken dat hun huidige manier van leven niet meer werkt." },
  { id: "home.hero.cta_primary", group: "Hero", label: "Knoptekst (primair)", type: "line", def: "Boek een kennismaking" },
  { id: "home.problem.card1.title", group: "Probleem", label: "Kaart 1 — titel", type: "line", def: "Leef je op automatische piloot?" },
  { id: "home.problem.card1.body", group: "Probleem", label: "Kaart 1 — tekst", type: "rich", def: "Werk neemt al je energie in beslag, persoonlijke doelen schuiven naar achteren, en je voelt dat de dagen op elkaar gaan lijken. Je doet veel, maar niet het juiste." },
  { id: "home.problem.card2.title", group: "Probleem", label: "Kaart 2 — titel", type: "line", def: "Vreet je werk al je energie op?" },
  { id: "home.problem.card2.body", group: "Probleem", label: "Kaart 2 — tekst", type: "rich", def: "Mails om 22u, weekendwerk dat niet stopt, en tegen vrijdag is er niets meer over. Er móét iets veranderen aan hoe je werk en privé verweven zijn, maar je weet niet waar te beginnen." },
  { id: "home.problem.card3.title", group: "Probleem", label: "Kaart 3 — titel", type: "line", def: "Kom je nooit toe aan wat écht telt?" },
  { id: "home.problem.card3.body", group: "Probleem", label: "Kaart 3 — tekst", type: "rich", def: "Die sportroutine, dat project, tijd voor de mensen die je liefhebt. Goede voornemens verdwijnen in de ruis. Niet omdat je niet wilt, maar omdat je systeem het niet ondersteunt." },
  { id: "home.banner.text", group: "Banner", label: "Bannertekst", type: "line", def: "Leer hoe BABL je helpt om dit patroon te doorbreken" },
];
const DEF = Object.fromEntries(FIELDS.map((f) => [f.id, f.def]));
const TYPE = Object.fromEntries(FIELDS.map((f) => [f.id, f.type]));

/* Beperkte HTML-opschoning voor 'rich'-velden: enkel vet/cursief/link/regeleinde. */
function sanitizeRich(html) {
  let s = String(html);
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<\s*b(\s[^>]*)?>/gi, "<strong>").replace(/<\s*\/\s*b\s*>/gi, "</strong>");
  s = s.replace(/<\s*strong(\s[^>]*)?>/gi, "<strong>").replace(/<\s*\/\s*strong\s*>/gi, "</strong>");
  s = s.replace(/<\s*i(\s[^>]*)?>/gi, "<em>").replace(/<\s*\/\s*i\s*>/gi, "</em>");
  s = s.replace(/<\s*em(\s[^>]*)?>/gi, "<em>").replace(/<\s*\/\s*em\s*>/gi, "</em>");
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "<br>");
  s = s.replace(/<a\b[^>]*?href\s*=\s*"([^"]*)"[^>]*>/gi, (m, href) =>
    /^(https?:\/\/|mailto:|\/)/i.test(href) ? '<a href="' + href.replace(/"/g, "&quot;") + '" target="_blank" rel="noopener">' : ""
  );
  s = s.replace(/<a\b[^>]*>/gi, "");
  s = s.replace(/<\s*\/\s*a\s*>/gi, "</a>");
  s = s.replace(/<(?!\/?(strong|em|br|a)\b)[^>]*>/gi, "");
  return s.trim();
}
function cleanValue(id, raw) {
  if (TYPE[id] === "rich") return sanitizeRich(raw);
  return String(raw).replace(/<[^>]*>/g, "").replace(/\r\n/g, "\n").trim();
}

async function getOverrides() {
  const r = await redisPipe([["GET", "cms:overrides"]]);
  try { return r && r[0] ? JSON.parse(r[0]) || {} : {}; } catch (e) { return {}; }
}
async function setOverrides(o) { await redisPipe([["SET", "cms:overrides", JSON.stringify(o)]]); }
async function getVersions() {
  const r = await redisPipe([["LRANGE", "cms:versions", "0", "49"]]);
  const arr = r && Array.isArray(r[0]) ? r[0] : [];
  return arr.map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
}
async function pushVersion(v) { await redisPipe([["LPUSH", "cms:versions", JSON.stringify(v)], ["LTRIM", "cms:versions", "0", "49"]]); }
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = typeof req.body === "string" ? req.body : "";
  if (!raw) raw = await new Promise((res) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => res(d)); req.on("error", () => res("")); });
  const ct = req.headers["content-type"] || "";
  if (ct.indexOf("application/json") >= 0) { try { return JSON.parse(raw || "{}"); } catch (e) { return {}; } }
  const out = {};
  raw.split("&").forEach((kv) => { const i = kv.indexOf("="); if (i >= 0) out[decodeURIComponent(kv.slice(0, i).replace(/\+/g, " "))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " ")); });
  return out;
}
function fieldsWith(o) {
  return FIELDS.map((f) => ({ id: f.id, group: f.group, label: f.label, type: f.type, value: f.id in o ? o[f.id] : f.def, overridden: f.id in o }));
}
function versionList(versions) { return versions.map((v, i) => ({ i, ts: v.ts, label: v.label || "Bewerking" })); }

/* ---------- Styling ---------- */
const CSS = `
:root{--green:#1f3c2c;--green-deep:#15281f;--moss:#8b9d7a;--cream:#f4ede1;--sand:#e8ddc8;--ochre:#c68954;--clay:#a86a3d;--ink:#1a1a1a;--ink60:rgba(26,26,26,.6);--ink40:rgba(26,26,26,.4)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',system-ui,sans-serif;background:var(--cream);color:var(--ink);line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:920px;margin:0 auto;padding:40px 24px 100px}
h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:42px;color:var(--green);letter-spacing:.2px;line-height:1.05}
.sub{color:var(--ink60);margin-top:6px;font-size:14px;font-family:'JetBrains Mono',monospace}
.kicker{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--moss);font-weight:500;margin-bottom:10px}
.muted{color:var(--ink60)}
code{font-family:'JetBrains Mono',monospace;background:var(--sand);padding:2px 6px;border-radius:4px;font-size:.85em}
.topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.logout{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--ink60);text-decoration:none;border:1px solid rgba(31,60,44,.18);border-radius:6px;padding:7px 12px;white-space:nowrap}
.logout:hover{color:var(--green);border-color:var(--green)}
.tabs{display:flex;gap:2px;margin:24px 0 0;border-bottom:1px solid rgba(31,60,44,.14)}
.tab{appearance:none;background:none;border:0;border-bottom:2px solid transparent;padding:12px 18px;font-family:inherit;font-size:15px;font-weight:600;color:var(--ink60);cursor:pointer;margin-bottom:-1px}
.tab:hover{color:var(--green)}
.tab.active{color:var(--green);border-bottom-color:var(--green)}
.panel{display:none}
.panel.active{display:block}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:24px 0}
.stat{background:#fff;border:1px solid rgba(31,60,44,.08);border-radius:8px;padding:20px}
.stat .n{font-family:'Cormorant Garamond',Georgia,serif;font-size:40px;font-weight:600;color:var(--green);line-height:1}
.stat .l{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--ink60);margin-top:10px;font-weight:600}
.card{background:#fff;border:1px solid rgba(31,60,44,.08);border-radius:8px;padding:24px;margin-top:20px}
.card h2{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:24px;color:var(--green);margin-bottom:18px}
.chart{width:100%;height:auto;display:block;overflow:visible}
.xlbl{font-family:'JetBrains Mono',monospace;font-size:11px;fill:var(--ink40)}
table{width:100%;border-collapse:collapse}
td{padding:9px 0;border-bottom:1px solid rgba(31,60,44,.06);font-size:14px;vertical-align:middle}
tr:last-child td{border-bottom:none}
td.k{color:var(--ink);word-break:break-all;padding-right:12px}
td.v{text-align:right;font-family:'JetBrains Mono',monospace;color:var(--green);font-weight:500;white-space:nowrap}
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.foot{margin-top:28px;font-size:13px;color:var(--ink40);max-width:640px}
.cms-sub{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0 6px}
.cms-sub button{appearance:none;background:#fff;border:1px solid rgba(31,60,44,.14);border-radius:999px;padding:8px 16px;font-family:inherit;font-size:13px;font-weight:600;color:var(--ink60);cursor:pointer}
.cms-sub button.active{background:var(--green);color:#fff;border-color:var(--green)}
.cms-field{margin:18px 0}
.cms-field label{display:flex;align-items:center;gap:8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink60);font-weight:600;margin-bottom:7px}
.cms-field .dot{color:var(--ochre);font-size:9px}
.cms-field input,.rt{width:100%;font-family:inherit;font-size:15px;color:var(--ink);background:#fff;border:1px solid rgba(31,60,44,.16);border-radius:6px;padding:11px 13px;line-height:1.55}
.rt{min-height:84px;border-top-left-radius:0;border-top-right-radius:0}
.rt:focus,.cms-field input:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px rgba(31,60,44,.09)}
.rt strong{font-weight:700}.rt a{color:var(--clay);text-decoration:underline}
.rt-tb{display:flex;gap:4px;border:1px solid rgba(31,60,44,.16);border-bottom:0;border-radius:6px 6px 0 0;padding:6px;background:var(--sand)}
.rtb{appearance:none;background:#fff;border:1px solid rgba(31,60,44,.12);border-radius:4px;min-width:30px;height:28px;padding:0 8px;font-family:inherit;font-size:13px;color:var(--ink);cursor:pointer}
.rtb:hover{border-color:var(--green);color:var(--green)}
.cms-bar{position:sticky;bottom:0;background:linear-gradient(transparent,var(--cream) 36%);padding:20px 0 6px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:6px}
.btn-save{appearance:none;background:var(--green);color:#fff;border:0;border-radius:6px;padding:12px 24px;font-family:inherit;font-size:15px;font-weight:600;cursor:pointer}
.btn-save[disabled]{opacity:.4;cursor:default}
.btn-ghost2{appearance:none;background:none;border:1px solid rgba(31,60,44,.22);border-radius:6px;padding:11px 16px;font-family:inherit;font-size:14px;color:var(--ink);cursor:pointer;text-decoration:none;display:inline-block}
.cms-status{font-size:13px;color:var(--ink60)}
.ver{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid rgba(31,60,44,.06);font-size:14px}
.ver:last-child{border-bottom:none}
.ver .when{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--ink40)}
.ver button{appearance:none;background:none;border:1px solid rgba(31,60,44,.22);border-radius:6px;padding:6px 13px;font-family:inherit;font-size:13px;color:var(--green);cursor:pointer;white-space:nowrap}
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);background:var(--green-deep);color:var(--cream);padding:13px 22px;border-radius:8px;font-size:14px;opacity:0;pointer-events:none;transition:.25s;z-index:10}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.login-wrap{min-height:78vh;display:flex;align-items:center;justify-content:center}
.login-card{max-width:380px;width:100%;background:#fff;border:1px solid rgba(31,60,44,.1);border-radius:12px;padding:38px 34px;text-align:center;box-shadow:0 12px 40px rgba(31,60,44,.08)}
.login-card .leaf{height:44px;margin:0 auto 18px;display:block}
.login-card h1{font-size:34px;margin-top:2px}
.login-card form{margin-top:22px;text-align:left;display:flex;flex-direction:column;gap:14px}
.login-card label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink60);font-weight:600}
.login-card input{width:100%;margin-top:6px;font-family:inherit;font-size:15px;color:var(--ink);background:var(--cream);border:1px solid rgba(31,60,44,.16);border-radius:6px;padding:12px 13px}
.login-card input:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px rgba(31,60,44,.09);background:#fff}
.login-card button{margin-top:6px;appearance:none;background:var(--green);color:#fff;border:0;border-radius:6px;padding:13px;font-family:inherit;font-size:15px;font-weight:600;cursor:pointer}
.login-card button:hover{background:var(--green-deep)}
.login-error{margin-top:16px;background:rgba(224,0,0,.08);border:1px solid rgba(224,0,0,.2);color:#b00;border-radius:6px;padding:10px 12px;font-size:13px}
@media(max-width:760px){.grid{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}h1{font-size:34px}}
`;

function page(inner) {
  return (
    `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow">` +
    `<title>Admin · Nadir Chajia Coaching</title>` +
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` +
    `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
    `<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">` +
    `<style>${CSS}</style></head><body><div class="wrap">${inner}</div></body></html>`
  );
}

function loginPage(error) {
  return page(
    `<div class="login-wrap"><div class="login-card">` +
    `<img class="leaf" src="/favicon.svg" alt="">` +
    `<div class="kicker">Nadir Chajia Coaching</div>` +
    `<h1>Admin</h1>` +
    (error ? `<div class="login-error">${error}</div>` : "") +
    `<form method="POST" action="/admin" autocomplete="on">` +
    `<label>Gebruikersnaam<input type="text" name="username" autocomplete="username" autofocus></label>` +
    `<label>Wachtwoord<input type="password" name="password" autocomplete="current-password"></label>` +
    `<button type="submit">Inloggen</button>` +
    `</form></div></div>`
  );
}

function barChart(series) {
  const W = 720, H = 190, padX = 8, padTop = 12, padBot = 26;
  const max = Math.max(1, ...series.map((s) => s.pv));
  const n = series.length;
  const bw = (W - padX * 2) / n;
  let bars = "";
  series.forEach((s, i) => {
    const h = Math.round((s.pv / max) * (H - padTop - padBot));
    const x = padX + i * bw, y = H - padBot - h, today = i === n - 1;
    bars += `<rect x="${(x + 1.5).toFixed(1)}" y="${y}" width="${(bw - 3).toFixed(1)}" height="${Math.max(h, 2)}" rx="2" fill="${today ? "var(--ochre)" : "var(--green)"}" opacity="${today ? 1 : 0.82}"><title>${s.day}: ${s.pv} weergaven · ${s.uv} bezoekers</title></rect>`;
  });
  const lbl = (i) => `<text x="${(padX + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="xlbl">${esc(series[i].day.slice(5))}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Paginaweergaven per dag">${bars}${lbl(0)}${lbl(Math.floor(n / 2))}${lbl(n - 1)}</svg>`;
}
function rows(arr, empty) {
  if (!arr.length) return `<tr><td class="muted" colspan="2">${empty}</td></tr>`;
  return arr.slice(0, 8).map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${nl(v)}</td></tr>`).join("");
}

const EDITOR_JS = `(function(){
  var app=document.getElementById('cms-app');
  if(!app)return;
  try{document.execCommand('styleWithCSS',false,false);}catch(e){}
  var S={fields:[],versions:[],group:null,val:{},orig:{}};
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function fmt(ts){try{return new Date(ts).toLocaleString('nl-BE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}catch(e){return '';}}
  function toast(m){var t=document.getElementById('cms-toast');if(!t)return;t.textContent=m;t.classList.add('show');setTimeout(function(){t.classList.remove('show');},2400);}
  function groups(){var g=[];S.fields.forEach(function(f){if(g.indexOf(f.group)<0)g.push(f.group);});return g;}
  function dirty(){return S.fields.some(function(f){return S.val[f.id]!==S.orig[f.id];});}
  function pull(){app.querySelectorAll('[data-id]').forEach(function(el){S.val[el.getAttribute('data-id')]=el.isContentEditable?el.innerHTML:el.value;});}
  function apply(d){
    S.fields=d.fields||[];S.versions=d.versions||[];S.val={};S.orig={};
    S.fields.forEach(function(f){S.val[f.id]=f.value;S.orig[f.id]=f.value;});
    if(!S.group||groups().indexOf(S.group)<0)S.group=S.fields.length?S.fields[0].group:null;
    render();
  }
  function fieldHtml(f){
    var dot=f.overridden?' <span class="dot" title="Aangepast">&#9679;</span>':'';
    if(f.type==='rich'){
      return '<div class="cms-field"><label>'+esc(f.label)+dot+'</label>'+
        '<div class="rt-tb">'+
        '<button type="button" class="rtb" data-cmd="bold" title="Vet"><b>B</b></button>'+
        '<button type="button" class="rtb" data-cmd="italic" title="Cursief"><i>I</i></button>'+
        '<button type="button" class="rtb" data-cmd="createLink" title="Link toevoegen">Link</button>'+
        '<button type="button" class="rtb" data-cmd="unlink" title="Link weghalen">Geen link</button>'+
        '</div><div class="rt" data-id="'+esc(f.id)+'" contenteditable="true">'+f.value+'</div></div>';
    }
    return '<div class="cms-field"><label>'+esc(f.label)+dot+'</label><input type="text" data-id="'+esc(f.id)+'" value="'+esc(f.value)+'"></div>';
  }
  function render(){
    var subs=groups().map(function(g){return '<button data-group="'+esc(g)+'" class="'+(g===S.group?'active':'')+'">'+esc(g)+'</button>';}).join('');
    var flds=S.fields.filter(function(f){return f.group===S.group;}).map(fieldHtml).join('');
    var vers=S.versions.length?S.versions.map(function(v){return '<div class="ver"><span><span class="when">'+fmt(v.ts)+'</span> &nbsp; '+esc(v.label)+'</span><button data-rb="'+v.i+'">Terugzetten</button></div>';}).join(''):'<p class="muted">Nog geen versies — je eerste opslag verschijnt hier.</p>';
    app.innerHTML=
      '<div class="cms-sub">'+subs+'</div><div>'+flds+'</div>'+
      '<div class="cms-bar"><button class="btn-save" id="cms-save"'+(dirty()?'':' disabled')+'>Opslaan</button>'+
      '<button class="btn-ghost2" id="cms-reset">Wijzigingen ongedaan</button>'+
      '<a class="btn-ghost2" href="/" target="_blank" rel="noopener">Site openen &#8599;</a>'+
      '<span class="cms-status">Opmaak: selecteer tekst en klik B of I. Wijzigingen staan meteen live.</span></div>'+
      '<div class="card" style="margin-top:30px"><h2>Versiegeschiedenis</h2>'+vers+
      '<div style="margin-top:16px"><button class="btn-ghost2" data-rb="defaults">&#8634; Originele standaardtekst herstellen</button></div></div>';
    bind();
  }
  function bind(){
    app.querySelectorAll('.cms-sub button').forEach(function(b){b.onclick=function(){pull();S.group=b.getAttribute('data-group');render();};});
    app.querySelectorAll('input[data-id]').forEach(function(el){el.oninput=function(){S.val[el.getAttribute('data-id')]=el.value;flag();};});
    app.querySelectorAll('.rt[data-id]').forEach(function(el){el.addEventListener('input',function(){S.val[el.getAttribute('data-id')]=el.innerHTML;flag();});});
    app.querySelectorAll('.rtb').forEach(function(b){b.addEventListener('mousedown',function(e){e.preventDefault();var c=b.getAttribute('data-cmd');if(c==='createLink'){var u=window.prompt('Link-URL (https://...):','https://');if(!u)return;document.execCommand('createLink',false,u);}else{document.execCommand(c,false,null);}var ed=b.parentNode.nextElementSibling;if(ed&&ed.getAttribute){S.val[ed.getAttribute('data-id')]=ed.innerHTML;flag();}});});
    var sv=document.getElementById('cms-save');if(sv)sv.onclick=save;
    var rs=document.getElementById('cms-reset');if(rs)rs.onclick=function(){S.fields.forEach(function(f){S.val[f.id]=S.orig[f.id];});render();};
    app.querySelectorAll('[data-rb]').forEach(function(b){b.onclick=function(){rollback(b.getAttribute('data-rb'));};});
  }
  function flag(){var s=document.getElementById('cms-save');if(s)s.disabled=!dirty();}
  function save(){
    pull();var ch={};
    S.fields.forEach(function(f){if(S.val[f.id]!==S.orig[f.id])ch[f.id]=S.val[f.id];});
    if(!Object.keys(ch).length)return;
    var s=document.getElementById('cms-save');s.disabled=true;s.textContent='Opslaan...';
    fetch('/admin?cms=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',changes:ch})})
      .then(function(r){return r.ok?r.json():null;}).then(function(d){
        s.textContent='Opslaan';
        if(d&&d.ok){apply(d);toast('Opgeslagen \\u2014 staat live op de site.');}else{s.disabled=false;toast('Opslaan mislukt.');}
      }).catch(function(){s.textContent='Opslaan';s.disabled=false;toast('Opslaan mislukt.');});
  }
  function rollback(v){
    var msg=v==='defaults'?'De originele standaardteksten terugzetten? De huidige tekst wordt vervangen.':'Deze versie terugzetten? De huidige tekst wordt vervangen.';
    if(!window.confirm(msg))return;
    fetch('/admin?cms=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'rollback',version:v})})
      .then(function(r){return r.ok?r.json():null;}).then(function(d){
        if(d&&d.ok){apply(d);toast('Teruggezet \\u2014 staat live.');}else{toast('Terugzetten mislukt.');}
      }).catch(function(){toast('Terugzetten mislukt.');});
  }
  function start(){
    fetch('/admin?cms=1',{cache:'no-store'}).then(function(r){
      if(!r.ok){app.innerHTML='<p class="muted">Kon de inhoud niet laden. Herlaad de pagina.</p>';return null;}
      return r.json();
    }).then(function(d){if(d)apply(d);});
  }
  start();
})();`;

const TAB_JS = `(function(){
  var tabs=document.querySelectorAll('.tab');
  tabs.forEach(function(t){t.onclick=function(){
    tabs.forEach(function(x){x.classList.remove('active');});
    document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active');});
    t.classList.add('active');
    var el=document.getElementById('panel-'+t.getAttribute('data-tab'));if(el)el.classList.add('active');
  };});
})();`;

function dashboard(d) {
  const bezoekers = `
    <div class="sub" style="margin:0 0 2px">Laatste 30 dagen · ${esc(brusselsDay(new Date()))} (Brussel)</div>
    <div class="grid">
      <div class="stat"><div class="n">${nl(d.uniqueAll)}</div><div class="l">Unieke bezoekers</div></div>
      <div class="stat"><div class="n">${nl(d.totalPv)}</div><div class="l">Paginaweergaven</div></div>
      <div class="stat"><div class="n">${nl(d.today.pv)}</div><div class="l">Vandaag</div></div>
      <div class="stat"><div class="n">${nl(d.pv7)}</div><div class="l">Laatste 7 dagen</div></div>
    </div>
    <div class="card"><h2>Paginaweergaven per dag</h2>${barChart(d.series)}</div>
    <div class="two">
      <div class="card"><h2>Toppagina's</h2><table>${rows(d.pages, "Nog geen data")}</table></div>
      <div class="card"><h2>Verwijzers</h2><table>${rows(d.refs, "Nog geen verwijzers")}</table></div>
    </div>
    <p class="foot">Cookieloos en anoniem — geen persoonsgegevens of IP-adressen, enkel aantallen. Bots niet meegeteld.</p>`;

  const inner = `
  <div class="topbar">
    <header><div class="kicker">Nadir Chajia Coaching · Admin</div><h1>Admin</h1></header>
    <a class="logout" href="/admin?logout=1">Uitloggen</a>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="bezoekers">Bezoekers</button>
    <button class="tab" data-tab="inhoud">Inhoud</button>
  </div>
  <section class="panel active" id="panel-bezoekers">${bezoekers}</section>
  <section class="panel" id="panel-inhoud"><div id="cms-app"><p class="muted">Inhoud laden…</p></div></section>
  <div class="toast" id="cms-toast"></div>
  <script>${TAB_JS}</script>
  <script>${EDITOR_JS}</script>`;
  return page(inner);
}

module.exports = async (req, res) => {
  const q = req.query || {};

  // Uitloggen
  if (q.logout !== undefined) {
    clearSession(res);
    res.statusCode = 302;
    res.setHeader("Location", "/admin");
    return res.end();
  }

  // Login-poging (POST zonder ?cms)
  if (req.method === "POST" && q.cms === undefined) {
    const body = await readBody(req);
    if (PASS && body.username === USER && body.password === PASS) {
      setSession(res);
      res.statusCode = 302;
      res.setHeader("Location", "/admin");
      return res.end();
    }
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end(loginPage(PASS ? "Onjuiste gebruikersnaam of wachtwoord." : "Nog niet geconfigureerd: stel <code>ADMIN_PASSWORD</code> in bij de Vercel-omgevingsvariabelen."));
  }

  const authed = !!getSession(req);

  // Niet ingelogd
  if (!authed) {
    if (q.cms !== undefined) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end(loginPage(PASS ? "" : "Nog niet geconfigureerd: stel <code>ADMIN_PASSWORD</code> in bij de Vercel-omgevingsvariabelen."));
  }

  // Inhoud-API (ingelogd)
  if (q.cms !== undefined) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (!REDIS_URL || !REDIS_TOKEN) { res.statusCode = 503; return res.end(JSON.stringify({ error: "no-database" })); }
    try {
      if (req.method === "POST") {
        const body = await readBody(req);
        if (body.action === "save") {
          const changes = body.changes && typeof body.changes === "object" ? body.changes : {};
          const o = await getOverrides();
          const groups = new Set();
          for (const id of Object.keys(changes)) {
            if (!(id in DEF)) continue;
            const val = cleanValue(id, changes[id]);
            if (val === DEF[id] || val === "") delete o[id];
            else o[id] = val;
            const f = FIELDS.find((x) => x.id === id);
            if (f) groups.add(f.group);
          }
          await setOverrides(o);
          await pushVersion({ ts: Date.now(), by: USER, label: "Bewerkt: " + ([...groups].join(", ") || "—"), overrides: o });
          return res.end(JSON.stringify({ ok: true, fields: fieldsWith(o), versions: versionList(await getVersions()) }));
        }
        if (body.action === "rollback") {
          let target;
          if (body.version === "defaults") target = {};
          else {
            const i = parseInt(body.version, 10);
            const versions = await getVersions();
            if (!(i >= 0 && i < versions.length)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad-version" })); }
            target = versions[i].overrides || {};
          }
          await setOverrides(target);
          await pushVersion({ ts: Date.now(), by: USER, label: body.version === "defaults" ? "Standaardtekst hersteld" : "Vorige versie teruggezet", overrides: target });
          return res.end(JSON.stringify({ ok: true, fields: fieldsWith(target), versions: versionList(await getVersions()) }));
        }
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: "unknown-action" }));
      }
      const overrides = await getOverrides();
      return res.end(JSON.stringify({ fields: fieldsWith(overrides), versions: versionList(await getVersions()) }));
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: "server-error" }));
    }
  }

  // HTML-paneel
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!REDIS_URL || !REDIS_TOKEN) return res.end(page(`<h1>Bijna klaar</h1><p class="sub">Koppel een Upstash Redis-databank via Vercel → Storage en deploy opnieuw.</p>`));
  try {
    const days = lastDays(30);
    const cmds = [["GET", "pv:total"], ["PFCOUNT", "uv:all"], ["HGETALL", "pv:pages"], ["HGETALL", "pv:refs"]];
    days.forEach((day) => { cmds.push(["GET", "pv:day:" + day]); cmds.push(["PFCOUNT", "uv:day:" + day]); });
    let r = await redisPipe(cmds);
    if (!r) r = [];
    const totalPv = Number(r[0]) || 0;
    const uniqueAll = Number(r[1]) || 0;
    const pages = toPairs(r[2]);
    const refs = toPairs(r[3]);
    const series = days.map((day, idx) => ({ day, pv: Number(r[4 + idx * 2]) || 0, uv: Number(r[5 + idx * 2]) || 0 }));
    const today = series[series.length - 1] || { pv: 0, uv: 0 };
    const pv7 = series.slice(-7).reduce((s, x) => s + x.pv, 0);
    res.end(dashboard({ totalPv, uniqueAll, today, pv7, series, pages, refs }));
  } catch (e) {
    res.end(page(`<h1>Even niet bereikbaar</h1><p class="sub">De gegevens konden niet geladen worden. Probeer het zo opnieuw.</p>`));
  }
};
