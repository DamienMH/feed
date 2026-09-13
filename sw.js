/* Service worker : l application et son contenu doivent rester lisibles hors
 * ligne, dans le metro par exemple. Strategie simple, le cache d abord pour la
 * coquille, le reseau d abord pour le contenu afin de recuperer un paquet frais
 * quand la connexion le permet. */

// A incrementer des que la coquille change : l activation efface les anciens
// caches, sinon un index.html perime resterait servi indefiniment.
// v2 : ouverture animee et illustrations.
const CACHE = "feed-f0ec3534";
const COQUILLE = ["./", "./index.html", "./manifest.json", "./images/perso/apprendre.png", "./images/perso/argumenter.png", "./images/perso/autonomie.png", "./images/perso/bati.png", "./images/perso/climat-vivant.png", "./images/perso/data-auto.png", "./images/perso/economie-actu.png", "./images/perso/entrainement.png", "./images/perso/esprit-critique.png", "./images/perso/etat.png", "./images/perso/europe.png", "./images/perso/faire-politique.png", "./images/perso/feed-art.png", "./images/perso/feed-litterature.png", "./images/perso/feed-pratique.png", "./images/perso/feed-sciences.png", "./images/perso/gestion-projet.png", "./images/perso/histoire-france.png", "./images/perso/histoire-musiques.png", "./images/perso/ia.png", "./images/perso/karate.png", "./images/perso/le-son.png", "./images/perso/medias-attention.png", "./images/perso/nutrition-solide.png", "./images/perso/pays-reel.png", "./images/perso/philosophie.png", "./images/perso/pratique-anglais.png", "./images/perso/protection-sociale.png", "./images/perso/psychanalyse.png", "./images/perso/rail.png", "./images/perso/rapports-de-force.png", "./images/perso/theorie-musicale.png", "./images/perso/ton-argent.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.endsWith("contenu.json")) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copie = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copie));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((c) => c || fetch(e.request).then((r) => {
      const copie = r.clone();
      caches.open(CACHE).then((cache) => cache.put(e.request, copie));
      return r;
    }))
  );
});
