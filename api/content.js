/* Publieke leesendpoint (geen login): geeft de bewerkte teksten (overrides) terug
   als JSON. Wordt door /cms.js op elke pagina gebruikt om teksten te vervangen. */
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const r = await fetch(REDIS_URL + "/get/" + encodeURIComponent(key), {
    headers: { Authorization: "Bearer " + REDIS_TOKEN },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j && typeof j.result === "string" ? j.result : null;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=60");
  let overrides = {};
  try {
    const raw = await redisGet("cms:overrides");
    if (raw) overrides = JSON.parse(raw) || {};
  } catch (e) {}
  res.end(JSON.stringify({ overrides: overrides }));
};
