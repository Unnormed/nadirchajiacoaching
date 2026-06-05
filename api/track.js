/* Serverless functie: registreert één anoniem paginabezoek in Upstash Redis.
   - Cookieloos en privacyvriendelijk: bewaart géén IP-adressen, enkel een
     dagelijkse, niet-herleidbare hash om unieke bezoekers te kunnen tellen.
   - Bots/crawlers worden niet meegeteld.
   Vereist de omgevingsvariabelen KV_REST_API_URL en KV_REST_API_TOKEN
   (worden automatisch toegevoegd wanneer je Upstash via Vercel koppelt). */
const crypto = require("crypto");

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SALT = process.env.STATS_SALT || "babl-ncc";
const TTL = "34560000"; // 400 dagen in seconden
const BOTS =
  /bot|crawl|spider|slurp|bing|google|yandex|baidu|duckduck|facebookexternalhit|whatsapp|telegram|skype|discord|preview|monitor|lighthouse|headless|phantom|curl|wget|python-requests|axios|node-fetch|semrush|ahrefs|mj12|dotbot|pingdom|uptime|gtmetrix/i;

function brusselsDay(date) {
  // YYYY-MM-DD in de Belgische tijdzone
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(date);
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

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const ua = req.headers["user-agent"] || "";
    if (BOTS.test(ua)) {
      res.statusCode = 204;
      return res.end();
    }

    const day = brusselsDay(new Date());
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "na";
    const visitor = crypto
      .createHash("sha256")
      .update(ip + "|" + ua + "|" + day + "|" + SALT)
      .digest("hex")
      .slice(0, 24);

    const q = req.query || {};
    const path = String(q.p || "/").slice(0, 120);
    const ref = q.r ? String(q.r) : "";

    const cmds = [
      ["INCR", "pv:total"],
      ["PFADD", "uv:all", visitor],
      ["INCR", "pv:day:" + day],
      ["EXPIRE", "pv:day:" + day, TTL],
      ["PFADD", "uv:day:" + day, visitor],
      ["EXPIRE", "uv:day:" + day, TTL],
      ["HINCRBY", "pv:pages", path, "1"],
    ];

    if (ref) {
      try {
        const host = new URL(ref).hostname.replace(/^www\./, "");
        if (host && host !== "nadirchajia.be") cmds.push(["HINCRBY", "pv:refs", host, "1"]);
      } catch (e) {}
    }

    await pipeline(cmds);
  } catch (e) {}

  res.statusCode = 204;
  res.end();
};
