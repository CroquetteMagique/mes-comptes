/* Analyse d'une dictée de dépenses — version navigateur.
 * Traduction fidèle de dictee.py (mêmes règles, mêmes résultats) : voir ce fichier
 * pour le principe. Toute modification doit être faite dans les DEUX fichiers ;
 * un test de parité local (non publié) le vérifie.
 */
(function (racine) {
  "use strict";

  const MOIS = {
    janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
    aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
    janv: 1, fev: 2, fevr: 2, avr: 4, juil: 7, oct: 10, nov: 11, dec: 12,
  };
  const NOMS_MOIS = "janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre";
  const UNITES = {
    zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6,
    sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13,
    quatorze: 14, quinze: 15, seize: 16,
  };
  const DIZAINES = { vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };
  const SIGLES = new Set(["sncf", "ratp", "edf", "kfc", "sfr", "tgv", "ter", "rer", "caf", "h&m"]);
  const EUROS = new Set(["euro", "euros", "eur", "€", "balles"]);
  const CENTIMES = new Set(["centime", "centimes"]);
  const FIN_DE_PHRASE = new Set([".", "!", "?", ";", ":"]);
  const BRUIT = new Set(["euh", "heu", "hum", "bah", "ben", "bon", "alors", "voila", "ok", "rien", "puis", "ensuite",
    "aussi", "et", "enfin"]);
  const BORDS = new Set(["de", "d'", "du", "des", "le", "la", "les", "l'", "un", "une", "a", "au", "aux", "pour", "donc",
    "ca", "en", "dans", "sur", "chez", "c'est", "tout", "j'", "j'ai", "ai", "on", "il", "elle",
    "paye", "payer", "depense", "depenses", "achete", "acheter", "pris", "mis", "fait", "coute",
    "me", "m'", "moi", "suis", "y", "avec", "par"]);

  const MOTS_CLES = {
    nourriture: ["intermarche", "carrefour", "lidl", "leclerc", "auchan", "aldi", "monoprix", "franprix",
      "tesco", "courses", "supermarche", "boulangerie", "cantine", "cafe", "epicerie", "marche",
      "pain", "picard", "biocoop"],
    restaurant: ["resto", "restaurant", "mcdo", "mcdonald", "burger", "pizza", "kebab", "wolt",
      "uber eats", "deliveroo", "sushi", "brasserie", "kfc", "tacos", "crous"],
    transport: ["sncf", "train", "bus", "metro", "ratp", "taxi", "uber", "bolt", "essence", "blablacar",
      "ouigo", "tram", "navigo", "peage", "parking", "velo", "trottinette", "carburant"],
    abonnement: ["abonnement", "netflix", "spotify", "claude", "anthropic", "deezer", "forfait",
      "disney", "amazon prime", "icloud", "chatgpt", "youtube"],
    logement: ["loyer", "edf", "electricite", "gaz", "internet", "box", "laverie", "machine a laver", "caution"],
    sante: ["pharmacie", "medecin", "docteur", "dentiste", "mutuelle", "osteo", "kine", "lunettes"],
    vetements: ["vetement", "vetements", "zara", "h&m", "chaussures", "uniqlo", "primark", "pull", "jean"],
    sport: ["sport", "salle", "basic fit", "piscine", "foot", "tennis", "escalade", "fitness"],
    soiree: ["bar", "soiree", "biere", "boite", "club", "verre", "apero"],
    cadeaux: ["cadeau", "anniversaire", "fleurs"],
    culture: ["cinema", "cine", "musee", "concert", "theatre", "livre", "expo", "spectacle", "pop corn"],
    jeux: ["jeu", "jeux", "steam", "playstation", "xbox", "nintendo"],
    etudes: ["fournitures", "inscription", "universite", "fac", "cours", "photocopies", "ecole"],
    voyage: ["avion", "hotel", "airbnb", "ryanair", "easyjet", "vol", "auberge", "valise"],
  };

  const sansAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const cle = (s) => sansAccents(s).toLowerCase().trim();
  const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function devinerType(texte) {
    const k = " " + cle(texte) + " ";
    for (const typ of Object.keys(MOTS_CLES)) {
      for (const m of MOTS_CLES[typ]) {
        // (pas de « lookbehind » : non pris en charge par les anciens Safari)
        if (new RegExp("[^a-z]" + echapper(m) + "(?![a-z])").test(k)) return typ;
      }
    }
    return null;
  }

  // Arrondi à 2 décimales exactement comme round(x, 2) de Python : sur la valeur
  // réellement stockée (2,675 vaut 2,67499…), et demi exact -> chiffre pair.
  function arrondi(x) {
    const [ent, dec] = Math.abs(x).toFixed(20).split(".");
    let cents = Number(ent) * 100 + Number(dec.slice(0, 2));
    const suite = dec.slice(2), demi = "5" + "0".repeat(suite.length - 1);
    if (suite > demi || (suite === demi && cents % 2)) cents += 1;
    return (x < 0 ? -cents : cents) / 100;
  }

  // ── Dates (objets {y, m, d}) ───────────────────────────────────────────────

  function valide(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  const fabriquer = (y, m, d) => (valide(y, m, d) ? { y, m, d } : null);
  const nombre = (x) => x.y * 10000 + x.m * 100 + x.d;
  function decaler(x, jours) {
    const t = new Date(Date.UTC(x.y, x.m - 1, x.d + jours));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  const deux = (n) => String(n).padStart(2, "0");
  const iso = (x) => `${x.y}-${deux(x.m)}-${deux(x.d)}`;

  function anneePour(mois, jour, auj) {
    let a = auj.y;
    if (valide(a, mois, jour) && nombre({ y: a, m: mois, d: jour }) > nombre(decaler(auj, 1))) a -= 1;
    return a;
  }
  const dater = (jour, mois, annee, auj) => fabriquer(annee || anneePour(mois, jour, auj), mois, jour);

  // ── 1. Découpage ───────────────────────────────────────────────────────────

  const TOKEN = /\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:[A-Za-zÀ-ÿ]+\d|\d+(?!euros?\b|eur\b|e\b)[A-Za-zÀ-ÿ])[A-Za-zÀ-ÿ\d]*|\d+(?:[.,]\d+)?|€|[A-Za-zÀ-ÿ&]+'?|[.;:!?,]/g;

  function normaliser(texte) {
    let t = texte.replace(/’/g, "'").replace(/-/g, " ");
    t = t.replace(/aujourd\s*'?\s*hui/gi, " aujourdhui ");
    t = t.replace(/avant\s+hier/gi, " avanthier ");
    t = t.replace(/\b1\s?(?:er|re|ère)(?![A-Za-zÀ-ÿ0-9_])/gi, "1");
    t = t.replace(new RegExp("\\bpremi(?:er|ère|ere)(?![A-Za-zÀ-ÿ0-9_])(?=\\s+(?:" + NOMS_MOIS + "))", "gi"), "1");
    return t;
  }

  function decouper(texte) {
    const out = [];
    for (const brut of normaliser(texte).match(TOKEN) || []) {
      const c = cle(brut);
      if (brut.length === 1 && ".;:!?,".includes(brut)) out.push({ t: "SEP", brut });
      else if (brut.includes("/")) out.push({ t: "JJMM", brut });
      else if (/^\d+(?:[.,]\d+)?$/.test(brut)) {
        out.push({ t: "NUM", val: parseFloat(brut.replace(",", ".")), brut,
          dec: brut.includes(",") || brut.includes("."), chiffres: true });
      } else if (Object.prototype.hasOwnProperty.call(MOIS, c)) out.push({ t: "MOIS", val: MOIS[c], brut });
      else if (EUROS.has(c)) out.push({ t: "EUR", brut });
      else out.push({ t: "MOT", brut, cle: c });
    }
    return nombresEnLettres(out);
  }

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const estNombre = (t) => t.t === "MOT" && (has(UNITES, t.cle) || has(DIZAINES, t.cle) || ["cent", "cents", "mille"].includes(t.cle));

  function nombresEnLettres(toks) {
    const out = [];
    let i = 0;
    while (i < toks.length) {
      const tok = toks[i];
      if (!estNombre(tok)) { out.push(tok); i += 1; continue; }
      if (tok.cle === "un" || tok.cle === "une") {
        const nxt = toks[i + 1];
        if (!nxt || !(nxt.t === "EUR" || estNombre(nxt))) { out.push(tok); i += 1; continue; }
      }
      let total = 0, cur = 0, j = i;
      const mots = [];
      while (j < toks.length) {
        const t = toks[j];
        const c = t.cle || "";
        if (c === "et" && cur && j + 1 < toks.length && ["un", "une", "onze"].includes(toks[j + 1].cle)) {
          mots.push(t.brut); j += 1; continue;
        }
        if (!estNombre(t)) break;
        if (has(DIZAINES, c)) {
          if (c.startsWith("vingt") && cur % 100 === 4) cur += 76;
          else if (cur % 100 === 0) cur += DIZAINES[c];
          else break;
        } else if (c === "cent" || c === "cents") {
          if (cur >= 10) break;
          cur = (cur || 1) * 100;
        } else if (c === "mille") {
          total += (cur || 1) * 1000;
          cur = 0;
        } else {
          const v = UNITES[c];
          if (v >= 10 && ![0, 60, 80].includes(cur % 100)) break;
          if (v < 10 && cur % 10 !== 0) break;
          cur += v;
        }
        mots.push(t.brut); j += 1;
      }
      out.push({ t: "NUM", val: total + cur, brut: mots.join(" "), dec: false, chiffres: false });
      i = j;
    }
    return out;
  }

  // ── 2. Repérage des morceaux ───────────────────────────────────────────────

  function morceaux(toks, moisDefaut, auj) {
    const n = toks.length;
    const tok = (k) => (k >= 0 && k < n ? toks[k] : { t: "FIN", brut: "", cle: "" });
    const out = [];
    const ctx = { mois: null };
    const dernier = () => out[out.length - 1];

    function ajouterDate(d, mois) {
      mois = mois || [d.y, d.m];
      out.push({ k: "DATE", d, mois });
      ctx.mois = mois;
    }
    function estSeptMois(k) {
      const t = tok(k), s = tok(k + 1);
      return t.t === "NUM" && !!t.chiffres && !t.dec && t.val >= 1 && t.val <= 31 && s.t === "NUM" && cle(s.brut) === "sept";
    }
    function lireMontant(k) {
      const t = tok(k);
      if (t.t !== "NUM" || tok(k + 1).t === "MOIS" || estSeptMois(k)) return null;
      const val = t.val;
      let j = k + 1;
      if (t.dec) return [arrondi(val), j + (tok(j).t === "EUR" ? 1 : 0)];
      if (CENTIMES.has(tok(j).cle)) return [arrondi(val / 100), j + 1];
      const virgule = tok(j).cle === "virgule";
      if (virgule || tok(j).t === "EUR") j += 1;
      const c = tok(j);
      if (c.t === "NUM" && !c.dec && c.val < 100 && tok(j + 1).t !== "MOIS" && !estSeptMois(j)) {
        const cent = virgule && c.val < 10 && !c.brut.startsWith("0") ? c.val * 10 : c.val;
        return [arrondi(val + cent / 100), j + 1];
      }
      return [arrondi(val), j];
    }

    let i = 0;
    while (i < n) {
      const t = tok(i), nxt = tok(i + 1);
      const c = t.cle || "";

      if (t.t === "NUM" && !t.dec && t.val >= 1 && t.val <= 31 && (nxt.t === "MOIS" || estSeptMois(i))) {
        const mois = nxt.t === "MOIS" ? nxt.val : 9;
        let annee = null, j = i + 2;
        if (tok(j).t === "NUM" && tok(j).val >= 2000 && tok(j).val <= 2100) { annee = Math.trunc(tok(j).val); j += 1; }
        const d = dater(Math.trunc(t.val), mois, annee, auj);
        if (d) {
          if (out.length && dernier().k === "MOT" && dernier().cle === "le") out.pop();
          ajouterDate(d);
        }
        i = j;
        continue;
      }
      if (t.t === "JJMM") {
        const p = t.brut.split("/").map(Number);
        const annee = p.length === 3 ? (p[2] < 100 ? p[2] + 2000 : p[2]) : null;
        const d = dater(p[0], p[1], annee, auj);
        if (d) {
          if (out.length && dernier().k === "MOT" && dernier().cle === "le") out.pop();
          ajouterDate(d);
        }
        i += 1;
        continue;
      }
      if (t.t === "MOIS") {
        if (out.length && dernier().k === "MOT" && ["de", "d'", "en"].includes(dernier().cle)) out.pop();
        ajouterDate(null, [anneePour(t.val, 1, auj), t.val]);
        i += 1;
        continue;
      }
      if (c === "hier" || c === "avanthier" || c === "aujourdhui") {
        ajouterDate(decaler(auj, -({ hier: 1, avanthier: 2, aujourdhui: 0 }[c])));
        i += 1;
        continue;
      }
      if (c === "le" && nxt.t === "NUM" && !nxt.dec && nxt.val >= 1 && nxt.val <= 31
          && ["MOT", "SEP", "FIN"].includes(tok(i + 2).t) && !CENTIMES.has(tok(i + 2).cle)) {
        let a, m;
        if (ctx.mois) [a, m] = ctx.mois;
        else if (moisDefaut) { a = parseInt(moisDefaut.slice(0, 4), 10); m = parseInt(moisDefaut.slice(5, 7), 10); }
        else { a = auj.y; m = auj.m; }
        const d = dater(Math.trunc(nxt.val), m, a, auj);
        if (d) { ajouterDate(d); i += 2; continue; }
      }

      if ((c === "c'" || c === "c'est") && (c === "c'est" || nxt.cle === "est")) {
        let j = i + 1 + (c === "c'" ? 1 : 0);
        const note = [];
        while (tok(j).t === "MOT" && note.length < 4) { note.push(tok(j).brut); j += 1; }
        while (out.length && ((dernier().k === "MOT" && ["ca", "donc", "et"].includes(dernier().cle))
                              || (dernier().k === "SEP" && !dernier().fort))) out.pop();
        if (note.some((w) => !["tout", "bon"].includes(cle(w)))) out.push({ k: "NOTE", texte: note.join(" ") });
        i = j;
        continue;
      }

      if (c === "rembourser") {
        let personne = null;
        if (out.length && dernier().k === "MOT" && dernier().cle === "a") out.pop();
        if (nxt.cle === "par" && tok(i + 2).t === "MOT") {
          personne = tok(i + 2).brut;
          i += 3;
        } else {
          while (out.length && dernier().k === "MOT" && ["me", "m'", "doit", "doivent", "va", "vont"].includes(dernier().cle)) {
            const verbe = ["doit", "doivent", "va", "vont"].includes(out.pop().cle);
            if (verbe && out.length && dernier().k === "MOT" && !BORDS.has(dernier().cle) && !BRUIT.has(dernier().cle)) {
              personne = out.pop().brut;
              break;
            }
          }
          i += 1;
        }
        out.push({ k: "REMB", personne: personne ? personne.charAt(0).toUpperCase() + personne.slice(1) : null });
        continue;
      }

      if (t.t === "NUM") {
        const lu = lireMontant(i);
        if (lu) { out.push({ k: "MONTANT", val: lu[0] }); i = lu[1]; continue; }
      }
      if (t.t === "SEP") out.push({ k: "SEP", fort: FIN_DE_PHRASE.has(t.brut) });
      else if (t.t === "MOT") out.push({ k: "MOT", brut: t.brut, cle: c });
      i += 1;
    }
    return out;
  }

  // ── 3. Rattachement aux dépenses ───────────────────────────────────────────

  function nettoyer(mots) {
    mots = mots.filter((m) => !BRUIT.has(cle(m)));
    while (mots.length && BORDS.has(cle(mots[0]))) mots.shift();
    while (mots.length && BORDS.has(cle(mots[mots.length - 1]))) mots.pop();
    return mots;
  }
  const joindre = (mots) => mots.join(" ").replace(/' /g, "'");

  function dateFinitLaPhrase(zone, j, finDuTexte) {
    for (const x of zone.slice(j + 1)) {
      if (x.k === "SEP" && x.fort) return true;
      if (x.k === "MOT" && nettoyer([x.brut]).length) return false;
    }
    return finDuTexte;
  }

  // Équivalent de difflib.SequenceMatcher(None, a, b).ratio()
  function ratio(a, b) {
    function blocs(alo, ahi, blo, bhi) {
      let bi = alo, bj = blo, taille = 0;
      for (let i = alo; i < ahi; i++) {
        for (let j = blo; j < bhi; j++) {
          let k = 0;
          while (i + k < ahi && j + k < bhi && a[i + k] === b[j + k]) k++;
          if (k > taille) { bi = i; bj = j; taille = k; }
        }
      }
      if (!taille) return 0;
      return taille + blocs(alo, bi, blo, bj) + blocs(bi + taille, ahi, bj + taille, bhi);
    }
    const t = a.length + b.length;
    return t ? (2 * blocs(0, a.length, 0, b.length)) / t : 1;
  }
  // Équivalent de difflib.get_close_matches(mot, possibles, n=1, cutoff)
  function plusProche(mot, possibles, seuil) {
    let meilleur = null;
    for (const x of possibles) {
      const s = ratio(x, mot);
      if (s >= seuil && (!meilleur || s > meilleur[0] || (s === meilleur[0] && x > meilleur[1]))) meilleur = [s, x];
    }
    return meilleur ? meilleur[1] : null;
  }

  function analyser(texte, moisDefaut, historique, aujourdhui) {
    const now = new Date();
    const auj = aujourdhui || { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    const connus = new Map();
    for (const [el, typ] of historique || []) if (!connus.has(cle(el))) connus.set(cle(el), [el, typ]);

    const m = morceaux(decouper(texte), moisDefaut || null, auj);
    const positions = [];
    m.forEach((x, k) => { if (x.k === "MONTANT") positions.push(k); });
    if (!positions.length) {
      const reste = joindre(nettoyer(m.filter((x) => x.k === "MOT").map((x) => x.brut)));
      return { depenses: [], non_compris: reste ? [reste] : [] };
    }

    const items = positions.map((p) => ({ montant: m[p].val, mots: [], date: null, remb: 0, personne: null, notes: [], reste: [] }));
    const bornes = [-1, ...positions, m.length];
    const zones = [];
    for (let r = 0; r < bornes.length - 1; r++) zones.push(m.slice(bornes[r] + 1, bornes[r + 1]));

    const datesApres = !zones[0].some((x) => x.k === "DATE") && zones[1].some((x) => x.k === "DATE");
    const rembourser = (it, x) => { it.remb = 1; it.personne = x.personne || it.personne; };

    zones.forEach((zoneOrig, r) => {
      const prec = r > 0 ? items[r - 1] : null;
      const cour = r < items.length ? items[r] : null;
      const zone = zoneOrig.slice();
      let k = 0;

      if (prec) {
        if (!nettoyer(prec.mots).length) {
          if (k < zone.length && zone[k].k === "SEP" && k + 1 < zone.length && ["de", "d'", "du"].includes(zone[k + 1].cle)) k += 1;
          while (k < zone.length && zone[k].k === "MOT") { prec.mots.push(zone[k].brut); k += 1; }
        }
        const passables = datesApres ? ["SEP", "REMB", "NOTE", "DATE"] : ["SEP", "REMB", "NOTE"];
        let j = k;
        while (j < zone.length && passables.includes(zone[j].k)) {
          if (zone[j].k === "REMB") { rembourser(prec, zone[j]); zone[j] = { k: "SEP", fort: false }; }
          else if (zone[j].k === "NOTE") { prec.notes.push(zone[j].texte); zone[j] = { k: "SEP", fort: false }; }
          j += 1;
        }
        const dates = [];
        for (let q = k; q < zone.length; q++) if (zone[q].k === "DATE") dates.push(q);
        if (prec.date === null && dates.length && (datesApres || dateFinitLaPhrase(zone, dates[0], cour === null))) {
          prec.date = zone[dates[0]];
          zone[dates[0]] = { k: "SEP", fort: false };
        }
      }

      for (const x of zone.slice(k)) {
        if (x.k === "DATE") { if (cour) cour.date = x; }
        else if (x.k === "MOT") {
          if (cour) cour.mots.push(x.brut);
          else if (!nettoyer(prec.mots).length) prec.mots.push(x.brut);
          else prec.reste.push(x.brut);
        } else if (x.k === "REMB") rembourser(cour || prec, x);
        else if (x.k === "NOTE") (cour || prec).notes.push(x.texte);
      }
    });

    for (let q = 1; q < items.length; q++) if (items[q].date === null) items[q].date = items[q - 1].date;

    const depenses = [], nonCompris = [];
    for (const it of items) {
      let element = joindre(nettoyer(it.mots));
      const c = cle(element);
      let typ = null;
      if (connus.has(c)) [element, typ] = connus.get(c);
      else if (c) {
        const proche = plusProche(c, [...connus.keys()], 0.85);
        if (proche) [element, typ] = connus.get(proche);
      }
      if (element && element === element.toLowerCase()) {
        element = element.split(/\s+/).map((w) => (SIGLES.has(w) ? w.toUpperCase() : w)).join(" ");
        element = element.charAt(0).toUpperCase() + element.slice(1);
      }
      typ = typ || devinerType(element);
      for (const note of it.notes) {
        const tn = devinerType(note);
        if (tn && (!typ || tn === "abonnement")) typ = tn;
      }
      const d = it.date;
      let mois, jour;
      if (d && d.d) { mois = `${d.d.y}-${deux(d.d.m)}`; jour = iso(d.d); }
      else if (d) { mois = `${d.mois[0]}-${deux(d.mois[1])}`; jour = null; }
      else { mois = moisDefaut || null; jour = null; }
      depenses.push({
        element: element || "?",
        date_echeance: jour,
        montant: it.montant,
        type_depense: typ || "autre",
        a_rembourser: it.remb,
        personne: it.personne,
        mois,
      });
      const reste = joindre(nettoyer(it.reste));
      if (reste) nonCompris.push(reste);
    }
    return { depenses, non_compris: nonCompris };
  }

  const api = { analyser, devinerType };
  racine.Dictee = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
