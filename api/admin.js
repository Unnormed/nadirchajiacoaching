/* Beveiligd admin-dashboard, bereikbaar via /admin.
   Sectie "Bezoekers": unieke bezoekers, paginaweergaven, een grafiek van de
   laatste 30 dagen, toppagina's en verwijzers — in de huisstijl van de site.
   (Hier komt later het inhoud-CMS naast.)

   Beveiliging: HTTP Basic Auth.
   - ADMIN_PASSWORD  (verplicht)  het wachtwoord
   - ADMIN_USER      (optioneel)  de gebruikersnaam, standaard "nadir"
   Data komt uit Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN). */

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USER = process.env.ADMIN_USER || "nadir";
const PASS = process.env.ADMIN_PASSWORD || "";

function brusselsDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(date);
}
function lastDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(brusselsDay(new Date(now - i * 86400000)));
  return out;
}
async function pipeline(cmds) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const r = await fetch(REDIS_URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  return r.ok ? r.json() : null;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function nl(n) {
  try { return Number(n).toLocaleString("nl-BE"); } catch (e) { return String(n); }
}
function toPairs(hgetall) {
  // Upstash geeft HGETALL terug als platte array [f,v,f,v] of als object
  const pairs = [];
  if (Array.isArray(hgetall)) {
    for (let i = 0; i < hgetall.length; i += 2) pairs.push([hgetall[i], Number(hgetall[i + 1]) || 0]);
  } else if (hgetall && typeof hgetall === "object") {
    for (const k in hgetall) pairs.push([k, Number(hgetall[k]) || 0]);
  }
  return pairs.sort((a, b) => b[1] - a[1]);
}

const CSS = `
:root{--green:#1f3c2c;--green-deep:#15281f;--moss:#8b9d7a;--cream:#f4ede1;--sand:#e8ddc8;--ochre:#c68954;--clay:#a86a3d;--ink:#1a1a1a;--ink60:rgba(26,26,26,.6);--ink40:rgba(26,26,26,.4)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',system-ui,sans-serif;background:var(--cream);color:var(--ink);line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:920px;margin:0 auto;padding:48px 24px 80px}
h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:42px;color:var(--green);letter-spacing:.2px;line-height:1.05}
.sub{color:var(--ink60);margin-top:6px;font-size:14px;font-family:'JetBrains Mono',monospace}
.kicker{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--moss);font-weight:500;margin-bottom:10px}
.muted{color:var(--ink60)}
code{font-family:'JetBrains Mono',monospace;background:var(--sand);padding:2px 6px;border-radius:4px;font-size:.85em}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:28px 0}
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
@media(max-width:760px){.grid{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}h1{font-size:34px}}
`;

function page(inner, refreshSec) {
  return (
    `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow">` +
    (refreshSec ? `<meta http-equiv="refresh" content="${refreshSec}">` : "") +
    `<title>Admin · Nadir Chajia Coaching</title>` +
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` +
    `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
    `<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">` +
    `<style>${CSS}</style></head><body><div class="wrap">${inner}</div></body></html>`
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
    const x = padX + i * bw;
    const y = H - padBot - h;
    const today = i === n - 1;
    bars +=
      `<rect x="${(x + 1.5).toFixed(1)}" y="${y}" width="${(bw - 3).toFixed(1)}" height="${Math.max(h, 2)}" rx="2" ` +
      `fill="${today ? "var(--ochre)" : "var(--green)"}" opacity="${today ? 1 : 0.82}">` +
      `<title>${s.day}: ${s.pv} weergaven · ${s.uv} bezoekers</title></rect>`;
  });
  const lbl = (i) =>
    `<text x="${(padX + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="xlbl">${esc(series[i].day.slice(5))}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Paginaweergaven per dag">${bars}${lbl(0)}${lbl(Math.floor(n / 2))}${lbl(n - 1)}</svg>`;
}

function rows(arr, empty) {
  if (!arr.length) return `<tr><td class="muted" colspan="2">${empty}</td></tr>`;
  return arr
    .slice(0, 8)
    .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${nl(v)}</td></tr>`)
    .join("");
}

function dashboard(d) {
  const inner = `
  <header>
    <div class="kicker">Nadir Chajia Coaching · Admin</div>
    <h1>Bezoekers</h1>
    <div class="sub">nadirchajia.be · laatste 30 dagen · ${esc(brusselsDay(new Date()))} (Brussel)</div>
  </header>
  <div class="grid">
    <div class="stat"><div class="n">${nl(d.uniqueAll)}</div><div class="l">Unieke bezoekers</div></div>
    <div class="stat"><div class="n">${nl(d.totalPv)}</div><div class="l">Paginaweergaven</div></div>
    <div class="stat"><div class="n">${nl(d.today.pv)}</div><div class="l">Vandaag</div></div>
    <div class="stat"><div class="n">${nl(d.pv7)}</div><div class="l">Laatste 7 dagen</div></div>
  </div>
  <div class="card">
    <h2>Paginaweergaven per dag</h2>
    ${barChart(d.series)}
  </div>
  <div class="two">
    <div class="card"><h2>Toppagina's</h2><table>${rows(d.pages, "Nog geen data")}</table></div>
    <div class="card"><h2>Verwijzers</h2><table>${rows(d.refs, "Nog geen verwijzers")}</table></div>
  </div>
  <p class="foot">Cookieloos en anoniem — er worden geen persoonsgegevens of IP-adressen bewaard, enkel geaggregeerde aantallen. Bots worden niet meegeteld. Deze pagina is afgeschermd met een wachtwoord en wordt niet geïndexeerd door zoekmachines.</p>`;
  return page(inner, 300);
}

module.exports = async (req, res) => {
  // ---- Authenticatie ----
  const hdr = req.headers.authorization || "";
  let ok = false;
  if (PASS && hdr.startsWith("Basic ")) {
    const dec = Buffer.from(hdr.slice(6), "base64").toString("utf8");
    const i = dec.indexOf(":");
    ok = dec.slice(0, i) === USER && dec.slice(i + 1) === PASS;
  }
  if (!ok) {
    res.statusCode = 401;
    res.setHeader("WWW-Authenticate", 'Basic realm="Nadir Chajia Coaching - Admin"');
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const msg = PASS
      ? "Log in om de bezoekerscijfers te bekijken."
      : 'Nog niet geconfigureerd: stel <code>ADMIN_PASSWORD</code> in bij de omgevingsvariabelen in Vercel.';
    return res.end(page(`<div class="kicker">Nadir Chajia Coaching · Admin</div><h1>Admin</h1><p class="sub">${msg}</p>`));
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  // ---- Databank nog niet gekoppeld? ----
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.end(
      page(
        `<h1>Bijna klaar</h1><p class="sub">Koppel een Upstash Redis-databank via Vercel → Storage en deploy opnieuw. Daarna verschijnen hier de cijfers.</p>`
      )
    );
  }

  // ---- Data ophalen ----
  try {
    const days = lastDays(30);
    const cmds = [
      ["GET", "pv:total"],
      ["PFCOUNT", "uv:all"],
      ["HGETALL", "pv:pages"],
      ["HGETALL", "pv:refs"],
    ];
    days.forEach((day) => {
      cmds.push(["GET", "pv:day:" + day]);
      cmds.push(["PFCOUNT", "uv:day:" + day]);
    });

    let r = await pipeline(cmds);
    r = Array.isArray(r) ? r.map((x) => (x && typeof x === "object" && "result" in x ? x.result : x)) : [];

    const totalPv = Number(r[0]) || 0;
    const uniqueAll = Number(r[1]) || 0;
    const pages = toPairs(r[2]);
    const refs = toPairs(r[3]);
    const series = days.map((day, idx) => ({
      day,
      pv: Number(r[4 + idx * 2]) || 0,
      uv: Number(r[5 + idx * 2]) || 0,
    }));
    const today = series[series.length - 1] || { pv: 0, uv: 0 };
    const pv7 = series.slice(-7).reduce((s, x) => s + x.pv, 0);

    res.end(dashboard({ totalPv, uniqueAll, today, pv7, series, pages, refs }));
  } catch (e) {
    res.end(page(`<h1>Even niet bereikbaar</h1><p class="sub">De statistieken konden niet geladen worden. Probeer het zo opnieuw.</p>`));
  }
};
