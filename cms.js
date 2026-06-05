/* CMS-hydratie voor nadirchajia.be.
   Haalt de in /admin bewerkte teksten op en past ze toe op elementen met een
   data-cms attribuut. Velden met data-cms-type="rich" mogen opmaak bevatten
   (vet/cursief/link) en worden als HTML gezet; de rest als platte tekst.
   Standaardtekst staat in de HTML, dus zonder JS of bij een lege database
   toont de site gewoon zijn normale inhoud. */
(function () {
  fetch("/api/content", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.overrides) return;
      Object.keys(data.overrides).forEach(function (id) {
        var nodes = document.querySelectorAll('[data-cms="' + id.replace(/["\\]/g, "\\$&") + '"]');
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].getAttribute("data-cms-type") === "rich") nodes[i].innerHTML = data.overrides[id];
          else nodes[i].textContent = data.overrides[id];
        }
      });
    })
    .catch(function () {});
})();
