/* Cookieloze bezoekersteller voor nadirchajia.be.
   Stuurt één anonieme ping per paginabezoek naar /api/track.
   Gebruikt geen cookies of localStorage — valt dus buiten de cookiebanner. */
(function () {
  try {
    var path = location.pathname || "/";
    if (path.indexOf("/stats") === 0) return; // het dashboard zelf niet meetellen

    var url =
      "/api/track?p=" +
      encodeURIComponent(path) +
      (document.referrer ? "&r=" + encodeURIComponent(document.referrer) : "");

    if (navigator.sendBeacon) navigator.sendBeacon(url);
    else fetch(url, { method: "POST", keepalive: true, cache: "no-store" });
  } catch (e) {}
})();
