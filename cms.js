/* CMS-hydratie voor nadirchajia.be.
   Haalt de in /admin bewerkte teksten op en past ze toe op elementen met een
   data-cms attribuut. De standaardtekst staat gewoon in de HTML, dus zonder
   JS of bij een lege database toont de site altijd zijn normale inhoud. */
(function () {
  fetch("/api/content", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.overrides) return;
      Object.keys(data.overrides).forEach(function (id) {
        var nodes = document.querySelectorAll('[data-cms="' + id.replace(/["\\]/g, "\\$&") + '"]');
        for (var i = 0; i < nodes.length; i++) nodes[i].textContent = data.overrides[id];
      });
    })
    .catch(function () {});
})();
