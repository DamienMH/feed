/* Moteur de selection, porte depuis engine.py.
 *
 * Les regles sont identiques a celles eprouvees en Python : dette par module,
 * scoring multi-criteres, contrainte de composition effort/plaisir avec lissage
 * local, et repetition espacee des rappels. La difference est qu ici tout
 * s execute dans le telephone, donc le flux reagit immediatement au geste.
 */

export const POIDS = {
  dette: 1.0,
  continuite: 0.8,
  contexte: 0.4,
  appetence: 0.5,
  monotonie: 0.9,
};

export const MOMENTS = {
  matin: [0, 180],
  journee: [0, 300],
  soir: [120, 1200],
  nuit: [0, 240],
};

export function momentActuel(date = new Date()) {
  const h = date.getHours();
  if (h < 11) return "matin";
  if (h < 18) return "journee";
  if (h < 23) return "soir";
  return "nuit";
}

const JOUR = 86400000;

/* --------------------------------------------------------------------------
 * Etat de progression, conserve sur le telephone
 * ----------------------------------------------------------------------- */

export function etatVide() {
  return {
    version: 1,
    evenements: [],      // { carte, action, date, mode }
    rappels: {},         // id -> { prochaine, intervalle, facilite, repetitions }
    reponses: [],        // { rappel, date, reussi }
    sessions: {},        // AAAA-MM-JJ -> { objectif, vues, atteint, bonusSec }
    activation: {},      // module -> date d activation
    modulesActifs: null, // null = ceux du paquet
  };
}

export function chargerEtat(cle = "feed-etat") {
  try {
    const brut = localStorage.getItem(cle);
    if (!brut) return etatVide();
    const etat = JSON.parse(brut);
    return { ...etatVide(), ...etat };
  } catch (e) {
    return etatVide();
  }
}

export function sauverEtat(etat, cle = "feed-etat") {
  try {
    // Le journal n a pas besoin d etre eternel : deux mois suffisent a tous
    // les calculs, et ca evite de faire grossir le stockage indefiniment.
    const limite = Date.now() - 60 * JOUR;
    etat.evenements = etat.evenements.filter((e) => e.date > limite);
    localStorage.setItem(cle, JSON.stringify(etat));
    return true;
  } catch (e) {
    return false;
  }
}

/* --------------------------------------------------------------------------
 * Facteurs
 * ----------------------------------------------------------------------- */

export function dettes(paquet, etat) {
  const resultat = {};
  const maintenant = Date.now();

  for (const module of modulesActifs(paquet, etat)) {
    const depuis = etat.activation[module.id] || (etat.activation[module.id] = maintenant);
    const jours = Math.max((maintenant - depuis) / JOUR, 0);
    const attendu = (module.cadence || 4) * jours / 7;

    if (attendu < 1) {
      resultat[module.id] = 0;          // rien n est encore du
      continue;
    }
    const realise = etat.evenements.filter(
      (e) => e.action === "terminee" && e.module === module.id && e.date >= depuis
    ).length;
    resultat[module.id] = Math.max(0, Math.min(1, (attendu - realise) / attendu));
  }
  return resultat;
}

export function appetences(etat) {
  const limite = Date.now() - 30 * JOUR;
  const compte = {};
  for (const e of etat.evenements) {
    if (e.date < limite) continue;
    if (e.action !== "terminee" && e.action !== "passee") continue;
    compte[e.module] = compte[e.module] || { ok: 0, ko: 0 };
    compte[e.module][e.action === "terminee" ? "ok" : "ko"] += 1;
  }
  const resultat = {};
  for (const [module, { ok, ko }] of Object.entries(compte)) {
    resultat[module] = ok + ko < 3 ? 0.5 : ok / (ok + ko);
  }
  return resultat;
}

export function continuites(paquet, etat) {
  const limite = Date.now() - 2 * JOUR;
  const ouverts = new Set();
  for (const e of etat.evenements) {
    if (e.action === "terminee" && e.type === "chapitre" && e.date >= limite) {
      ouverts.add(e.module);
    }
  }
  return ouverts;
}

export function derniersModules(etat, combien = 3) {
  return etat.evenements
    .slice(-combien)
    .reverse()
    .map((e) => e.module);
}

export function modulesActifs(paquet, etat) {
  const choisis = etat.modulesActifs;
  return paquet.modules.filter((m) =>
    choisis ? choisis.includes(m.id) : m.statut === "actif"
  );
}

/* --------------------------------------------------------------------------
 * Candidates et file
 * ----------------------------------------------------------------------- */

export function candidates(paquet, etat) {
  const vues = new Set(
    etat.evenements
      .filter((e) => ["vue", "terminee", "passee"].includes(e.action))
      .map((e) => e.carte)
  );
  const actifs = new Set(modulesActifs(paquet, etat).map((m) => m.id));

  // Un chapitre attend que le precedent du meme parcours soit termine. On
  // raisonne sur les chapitres reellement presents dans le paquet, pas sur les
  // numeros : un parcours partiellement redige doit rester lisible.
  const termines = new Set(
    etat.evenements.filter((e) => e.action === "terminee").map((e) => e.carte)
  );
  const suite = {};
  for (const carte of paquet.cartes) {
    if (carte.type !== "chapitre") continue;
    (suite[carte.module] = suite[carte.module] || []).push(carte);
  }
  const precedent = new Map();
  for (const liste of Object.values(suite)) {
    liste.sort((a, b) => (a.chapitre || 0) - (b.chapitre || 0));
    liste.forEach((carte, i) => precedent.set(carte.id, i > 0 ? liste[i - 1].id : null));
  }

  return paquet.cartes.filter((c) => {
    if (vues.has(c.id) || !actifs.has(c.module)) return false;
    if (c.type === "chapitre") {
      const avant = precedent.get(c.id);
      return avant === null || termines.has(avant);
    }
    return true;
  });
}

export function rappelsDus(etat, paquet, limite = 5) {
  const aujourdhui = Date.now();
  const index = new Map();
  for (const carte of paquet.cartes) {
    for (const r of carte.rappels || []) index.set(r.id, { ...r, carte });
  }
  return Object.entries(etat.rappels)
    .filter(([id, e]) => e.prochaine <= aujourdhui && index.has(Number(id) || id))
    .sort((a, b) => a[1].prochaine - b[1].prochaine)
    .slice(0, limite)
    .map(([id]) => index.get(Number(id) || id));
}

function score(carte, ctx) {
  const dette = ctx.dettes[carte.module] || 0;
  const continuite = ctx.continuites.has(carte.module) && carte.type === "chapitre" ? 1 : 0;
  const appetence = ctx.appetences[carte.module] ?? 0.5;

  const [mini, maxi] = MOMENTS[ctx.moment];
  const duree = carte.duree || 120;
  const contexte = duree >= mini && duree <= maxi
    ? 1
    : Math.max(0, 1 - Math.abs(duree - maxi) / Math.max(maxi, 1));

  const monotonie = ctx.recents.length
    ? ctx.recents.filter((m) => m === carte.module).length / ctx.recents.length
    : 0;

  return POIDS.dette * dette
    + POIDS.continuite * continuite
    + POIDS.contexte * contexte
    + POIDS.appetence * appetence
    - POIDS.monotonie * monotonie;
}

export function construireFile(paquet, etat, options = {}) {
  const taille = options.taille || paquet.reglages?.objectif_cartes_jour || 20;
  const mode = options.mode || "objectif";
  const moment = options.moment || momentActuel();

  const ctx = {
    dettes: mode === "bonus" ? {} : dettes(paquet, etat),
    appetences: appetences(etat),
    continuites: continuites(paquet, etat),
    recents: derniersModules(etat),
    moment,
  };

  let restantes = candidates(paquet, etat);
  if (mode === "bonus") restantes = restantes.filter((c) => c.exigence <= 2 || c.plaisir);
  if (!restantes.length) return [];

  const notes = new Map(restantes.map((c) => [c.id, score(c, ctx)]));
  restantes = restantes.slice().sort((a, b) => notes.get(b.id) - notes.get(a.id));

  const exigeantMax = paquet.reglages?.mix_exigeant_max ?? 4;
  const plaisirMin = paquet.reglages?.mix_plaisir_min ?? 3;

  const file = [];
  while (file.length < taille && restantes.length) {
    const position = file.length % 10;
    const tranche = position ? file.slice(-position) : [];
    const exigeantes = tranche.filter((c) => c.exigence === 3).length;
    const plaisirs = tranche.filter((c) => c.plaisir).length;

    const quotaExigeant = exigeantes >= exigeantMax;
    const besoinPlaisir = plaisirMin - plaisirs >= 10 - position;

    // Lissage local : les quotas seuls laisseraient passer sept cartes d effort
    // d affilee suivies d un bloc de plaisir, ce qui est le mur qui fait
    // abandonner. On interdit donc trois exigeantes de suite et on impose une
    // respiration au moins toutes les quatre cartes.
    const troisExigeantes = file.length >= 2 && file.slice(-2).every((c) => c.exigence === 3);
    const sansRespiration = file.length >= 3 && !file.slice(-3).some((c) => c.plaisir);

    let choisie = restantes.find((c) => {
      if ((besoinPlaisir || sansRespiration) && !c.plaisir) return false;
      if ((quotaExigeant || troisExigeantes) && c.exigence === 3) return false;
      if (file.length && c.module === file[file.length - 1].module && c.type !== "chapitre") return false;
      return true;
    });
    // On relache le lissage avant les quotas, jamais l inverse.
    if (!choisie) choisie = restantes.find((c) => !(quotaExigeant && c.exigence === 3));
    if (!choisie) choisie = restantes[0];

    file.push(choisie);
    restantes = restantes.filter((c) => c.id !== choisie.id);
    ctx.recents = [choisie.module, ...ctx.recents].slice(0, 3);
  }
  return file;
}

/* --------------------------------------------------------------------------
 * Journal et rappels
 * ----------------------------------------------------------------------- */

export function journaliser(etat, carte, action, mode = "objectif") {
  etat.evenements.push({
    carte: carte.id,
    module: carte.module,
    type: carte.type,
    action,
    mode,
    date: Date.now(),
  });

  if (action === "terminee") {
    for (const r of carte.rappels || []) {
      if (!etat.rappels[r.id]) {
        etat.rappels[r.id] = {
          prochaine: Date.now() + JOUR,
          intervalle: 1,
          facilite: 2.5,
          repetitions: 0,
        };
      }
    }
  }
  return etat;
}

export function planifierRappel(etat, rappelId, reussi) {
  const e = etat.rappels[rappelId] || { intervalle: 1, facilite: 2.5, repetitions: 0 };
  let { intervalle, facilite, repetitions } = e;

  if (reussi) {
    repetitions += 1;
    intervalle = repetitions === 1 ? 1 : repetitions === 2 ? 3 : intervalle * facilite;
    facilite = Math.min(2.8, facilite + 0.1);
  } else {
    repetitions = 0;
    intervalle = 1;
    facilite = Math.max(1.3, facilite - 0.25);
  }

  etat.rappels[rappelId] = {
    prochaine: Date.now() + Math.round(intervalle) * JOUR,
    intervalle,
    facilite,
    repetitions,
  };
  etat.reponses.push({ rappel: rappelId, date: Date.now(), reussi });
  return etat;
}

/* --------------------------------------------------------------------------
 * Progression
 * ----------------------------------------------------------------------- */

export function retention(etat, jours = 7) {
  const limite = Date.now() - jours * JOUR;
  const recentes = etat.reponses.filter((r) => r.date >= limite);
  if (!recentes.length) return null;
  return Math.round((recentes.filter((r) => r.reussi).length / recentes.length) * 100);
}

export function serie(etat) {
  let compte = 0;
  for (let i = 0; ; i++) {
    const jour = new Date(Date.now() - i * JOUR).toISOString().slice(0, 10);
    const session = etat.sessions[jour];
    if (session?.atteint) compte += 1;
    else if (i > 0) break;                 // aujourd hui en cours ne casse pas la serie
  }
  return compte;
}

export function progression(paquet, etat) {
  const termines = new Set(
    etat.evenements.filter((e) => e.action === "terminee").map((e) => e.carte)
  );
  const d = dettes(paquet, etat);

  return paquet.modules.map((module) => {
    const cartes = paquet.cartes.filter((c) => c.module === module.id);
    const faits = cartes.filter((c) => termines.has(c.id)).length;
    const dette = d[module.id] ?? 0;
    return {
      ...module,
      total: cartes.length,
      faits,
      pct: cartes.length ? Math.round((faits / cartes.length) * 100) : 0,
      etat: dette < 0.15 ? "à jour" : dette < 0.6 ? "en retard" : "décroché",
    };
  });
}

export function sessionDuJour(etat, objectif) {
  const jour = new Date().toISOString().slice(0, 10);
  if (!etat.sessions[jour]) {
    etat.sessions[jour] = { objectif, vues: 0, atteint: false, bonusSec: 0 };
  }
  return etat.sessions[jour];
}
