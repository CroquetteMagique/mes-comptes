/* Version navigateur : remplace le serveur Python (app.py).
 *
 * Toutes les requêtes /api/... de app.js sont servies ici, avec la même logique que
 * app.py, et les données sont gardées dans le navigateur (localStorage). Rien n'est
 * envoyé sur internet. Toute évolution d'une route de app.py doit être reportée ici.
 *
 * Règle de mise à jour : le format des données ne fait que s'enrichir (champ v),
 * jamais de suppression ni de renommage, pour ne rien casser chez personne.
 */
(function () {
  "use strict";
  window.MES_COMPTES_LOCAL = true;

  const CLE = "mes-comptes-donnees";
  const VERSION_DONNEES = 1;
  const vide = () => ({ v: VERSION_DONNEES, seq: { depenses: 0, revenus: 0 }, depenses: [], revenus: [],
    avoirs: null, budgets: {}, reglages: {} });
  const fetchReseau = window.fetch.bind(window);

  // ── Stockage ───────────────────────────────────────────────────────────────

  // Complète des données (lues ou restaurées) au format actuel
  function normaliser(d) {
    d = Object.assign(vide(), d);
    d.seq = Object.assign({ depenses: 0, revenus: 0 }, d.seq);
    // migrations futures : if (d.v < 2) { ... ajouter des champs ... }
    d.v = VERSION_DONNEES;
    return d;
  }
  function charger() {
    try { return normaliser(JSON.parse(localStorage.getItem(CLE) || "null")); } catch (e) { return normaliser(null); }
  }
  let db = charger();
  function enregistrer() {
    localStorage.setItem(CLE, JSON.stringify(db));          // lève une erreur si le stockage est plein
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ── Outils ─────────────────────────────────────────────────────────────────

  const deux = (n) => String(n).padStart(2, "0");
  const moisCourant = () => { const t = new Date(); return `${t.getFullYear()}-${deux(t.getMonth() + 1)}`; };
  const somme = (rows) => rows.reduce((s, r) => s + r.montant, 0);
  const r2 = window.Dictee.arrondi;                          // même arrondi que round(x, 2) dans app.py
  const nocase = (a, b) => a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase());
  // tri comme SQLite : NULL avant les valeurs en ordre croissant
  const cmp = (a, b) => (a === b ? 0 : a === null || a === undefined ? -1 : b === null || b === undefined ? 1 : a < b ? -1 : 1);
  const tri = (rows, ...cles) => rows.map((r, i) => [r, i]).sort((x, y) => {
    for (const [k, sens] of cles) { const c = cmp(x[0][k], y[0][k]) * sens; if (c) return c; }
    return x[1] - y[1];
  }).map((x) => x[0]);
  const aRembourser = (rows) => tri(rows.filter((d) => d.a_rembourser >= 1), ["a_rembourser", 1], ["mois", -1], ["date_echeance", -1]);

  function personne(d) {
    const p = String(d.personne || "").trim();
    return p && Number(d.a_rembourser || 0) ? p.charAt(0).toUpperCase() + p.slice(1) : null;
  }
  function ajouterDepense(d) {
    db.seq.depenses += 1;
    db.depenses.push({
      id: db.seq.depenses, mois: d.mois, categorie: d.categorie, element: d.element,
      date_echeance: d.date_echeance || null, montant: Number(d.montant), a_rembourser: Number(d.a_rembourser || 0),
      type_depense: d.type_depense || "autre", personne: personne(d), created_at: new Date().toISOString(),
    });
  }

  // Création du mois en cours, avec copie des charges fixes du dernier mois saisi (comme app.py)
  function creerMoisCourant() {
    const m = moisCourant();
    if (db.depenses.some((d) => d.mois === m)) return;
    const prec = db.depenses.filter((d) => d.mois < m).map((d) => d.mois).sort().pop();
    if (!prec) return;
    db.depenses.filter((d) => d.mois === prec && d.categorie === "fixe")
      .forEach((f) => ajouterDepense({ mois: m, categorie: "fixe", element: f.element, montant: f.montant, a_rembourser: 0 }));
    enregistrer();
  }
  creerMoisCourant();

  const net = () => somme(db.revenus) - somme(db.depenses) + somme(db.depenses.filter((d) => d.a_rembourser === 2));
  const solde = () => (db.avoirs ? r2(db.avoirs.solde_saisi + net() - db.avoirs.net_ref) : null);
  const moisListe = () => [...new Set([...db.depenses, ...db.revenus].map((x) => x.mois))].sort();

  // ── Notes de version (fichier publié avec le site) ─────────────────────────

  let notesCache = null;
  async function notes() {
    if (!notesCache) {
      try {
        const r = await fetchReseau("notes_de_version.json", { cache: "no-store" });
        notesCache = (await r.json()).sort((a, b) => (a.id < b.id ? 1 : -1));
      } catch (e) { notesCache = []; }
    }
    return notesCache;
  }

  // ── Exports (CSV, PDF) ─────────────────────────────────────────────────────

  const nombreFr = (n) => n.toFixed(2).replace(".", ",");
  const euro = (n) => nombreFr(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " €";
  const dateFr = (s) => (s ? s.split("-").reverse().join("/") : "-");
  const nomMois = (m) => {
    const [y, mo] = m.split("-");
    const t = new Date(y, mo - 1, 1).toLocaleString("fr-FR", { month: "long", year: "numeric" });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  function csv() {
    const ligne = (cols) => cols.map((c) => { const s = String(c ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(";");
    const statut = { 0: "", 1: "En attente", 2: "Remboursé" };
    const out = [ligne(["Sens", "Mois", "Date", "Élément", "Catégorie", "Type", "Montant", "À rembourser", "Personne"])];
    tri(db.depenses, ["mois", 1], ["date_echeance", 1]).forEach((r) => out.push(ligne(["Dépense", r.mois, r.date_echeance || "",
      r.element, r.categorie, r.type_depense || "", nombreFr(r.montant), statut[r.a_rembourser] || "", r.personne || ""])));
    tri(db.revenus, ["mois", 1], ["date_revenu", 1]).forEach((r) => out.push(ligne(["Revenu", r.mois, r.date_revenu || "",
      r.element, "", "", nombreFr(r.montant), "", ""])));
    return new Blob(["﻿" + out.join("\r\n") + "\r\n"], { type: "text/csv" });
  }

  function pdfBase(titre) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    pdf.setFillColor(12, 13, 18); pdf.rect(0, 0, 210, 30, "F");
    pdf.setTextColor(201, 164, 92); pdf.setFont("helvetica", "bold"); pdf.setFontSize(16);
    pdf.text(`Mes Comptes - ${titre}`, 15, 15);
    pdf.setTextColor(152, 150, 160); pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
    const t = new Date();
    pdf.text(`Exporté le ${deux(t.getDate())}/${deux(t.getMonth() + 1)}/${t.getFullYear()} à ${deux(t.getHours())}:${deux(t.getMinutes())}`, 15, 22);
    return pdf;
  }
  function carte(pdf, x, y, label, valeur, couleur) {
    pdf.setFillColor(...couleur); pdf.rect(x, y, 55, 18, "F");
    pdf.setFontSize(7); pdf.setTextColor(100, 100, 100); pdf.setFont("helvetica", "normal"); pdf.text(label.toUpperCase(), x + 3, y + 6);
    pdf.setFontSize(11); pdf.setTextColor(30, 30, 30); pdf.setFont("helvetica", "bold"); pdf.text(valeur, x + 3, y + 13);
  }
  function tableau(pdf, y, titre, colonnes, largeurs, lignes, total) {
    const finColonnes = 15 + largeurs.slice(0, -1).reduce((a, b) => a + b, 0);
    const saut = (h) => { if (y + h <= 285) return false; pdf.addPage(); y = 15; return true; };   // nouvelle page si besoin
    saut(20);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(10); pdf.setTextColor(30, 30, 30); pdf.text(titre, 15, y + 5); y += 8;
    const entete = () => {
      pdf.setFillColor(230, 230, 240); pdf.rect(15, y, 180, 7, "F");
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.setTextColor(80, 80, 100);
      let x = 15; colonnes.forEach((c, i) => { pdf.text(c, x + 1.5, y + 4.8); x += largeurs[i]; });
      y += 7;
    };
    entete();
    lignes.forEach((l, i) => {
      if (saut(6)) entete();
      pdf.setFillColor(...(i % 2 ? [245, 245, 248] : [252, 252, 252])); pdf.rect(15, y, 180, 6, "F");
      let x = 15;
      l.cellules.forEach((c, k) => {
        pdf.setFont("helvetica", k === l.gras ? "bold" : "normal");
        pdf.setTextColor(...((l.couleurs && l.couleurs[k]) || [40, 40, 40]));
        pdf.text(String(c).slice(0, 45), x + 1.5, y + 4.2); x += largeurs[k];
      });
      y += 6;
    });
    if (total) {
      saut(8);
      pdf.setFillColor(210, 210, 230); pdf.rect(15, y, 180, 7, "F");
      pdf.setFont("helvetica", "bold"); pdf.setTextColor(30, 30, 80); pdf.setFontSize(8);
      pdf.text(total[0], finColonnes - 2, y + 4.8, { align: "right" });
      pdf.text(total[1], finColonnes + 1.5, y + 4.8);
      y += 10;
    }
    return y;
  }

  function pdfMois(mois) {
    const dep = tri(db.depenses.filter((d) => d.mois === mois), ["categorie", 1], ["date_echeance", 1]);
    const rev = tri(db.revenus.filter((r) => r.mois === mois), ["date_revenu", 1]);
    const fixes = dep.filter((d) => d.categorie === "fixe"), vars = dep.filter((d) => d.categorie === "variable");
    const tDep = somme(dep), tRev = somme(rev), bilan = tRev - tDep;
    const pdf = pdfBase(nomMois(mois));
    carte(pdf, 15, 38, "Dépenses totales", euro(tDep), [255, 220, 220]);
    carte(pdf, 75, 38, "Revenus", euro(tRev), [220, 245, 230]);
    carte(pdf, 135, 38, "Bilan du mois", euro(bilan), bilan >= 0 ? [220, 235, 255] : [255, 220, 220]);
    carte(pdf, 15, 62, "Charges fixes", euro(somme(fixes)), [240, 240, 255]);
    carte(pdf, 75, 62, "Variables", euro(somme(vars)), [255, 245, 220]);
    let y = 90;
    if (fixes.length) y = tableau(pdf, y, "Charges fixes", ["Élément", "Échéance", "Montant"], [110, 40, 30],
      fixes.map((d) => ({ cellules: [d.element, dateFr(d.date_echeance), euro(d.montant)], gras: 2 })), ["TOTAL", euro(somme(fixes))]);
    if (vars.length) y = tableau(pdf, y, "Dépenses variables", ["Élément", "Date", "Remboursement", "Montant"], [90, 35, 30, 25],
      vars.map((d) => ({ cellules: [d.element, dateFr(d.date_echeance), d.a_rembourser ? "Oui" : "", euro(d.montant)], gras: 3 })), ["TOTAL", euro(somme(vars))]);
    if (rev.length) tableau(pdf, y, "Revenus", ["Élément", "Date", "Montant"], [110, 40, 30],
      rev.map((r) => ({ cellules: [r.element, dateFr(r.date_revenu), euro(r.montant)], gras: 2 })), ["TOTAL", euro(tRev)]);
    return pdf.output("blob");
  }

  function pdfRemboursements(mois, qui) {
    const rows = aRembourser(db.depenses.filter((d) => (!mois || d.mois === mois) && (!qui || d.personne === qui)));
    const attente = somme(rows.filter((r) => r.a_rembourser === 1)), recu = somme(rows.filter((r) => r.a_rembourser === 2));
    const pdf = pdfBase(`Remboursements - ${mois ? nomMois(mois) : "Tous les mois"}${qui ? " - " + qui : ""}`);
    carte(pdf, 15, 38, "En attente", euro(attente), [255, 245, 210]);
    carte(pdf, 75, 38, "Déjà remboursé", euro(recu), [220, 245, 230]);
    carte(pdf, 135, 38, "Total avancé", euro(attente + recu), [230, 230, 245]);
    let y = 66;
    const parMois = new Map();
    rows.forEach((r) => { if (!parMois.has(r.mois)) parMois.set(r.mois, []); parMois.get(r.mois).push(r); });
    for (const [m, items] of parMois) {
      y = tableau(pdf, y, `${nomMois(m)} - Total : ${euro(somme(items))} | En attente : ${euro(somme(items.filter((r) => r.a_rembourser === 1)))}`,
        ["Élément", "Date", "Montant", "Statut"], [90, 30, 30, 30],
        items.map((r) => ({ cellules: [r.element, dateFr(r.date_echeance), euro(r.montant), r.a_rembourser === 2 ? "Remboursé" : "En attente"],
          gras: 2, couleurs: { 3: r.a_rembourser === 2 ? [100, 150, 100] : [180, 120, 40] } })),
        ["TOTAL DU MOIS", euro(somme(items))]);
    }
    return pdf.output("blob");
  }

  // ── Routes (mêmes adresses et mêmes réponses que app.py) ──────────────────

  const json = (o, statut = 200) => new Response(JSON.stringify(o), { status: statut, headers: { "Content-Type": "application/json" } });
  const fichier = (blob, nom) => new Response(blob, { headers: {
    "Content-Type": blob.type, "Content-Disposition": `attachment; filename="${nom}"` } });

  const routes = [
    ["GET", /^\/api\/depenses\/recherche$/, (m, q) => {
      const t = (q.get("q") || "").trim().toLowerCase(), typ = q.get("type") || "";
      const rows = db.depenses.filter((d) => (!t || d.element.toLowerCase().includes(t) || (d.personne || "").toLowerCase().includes(t))
        && (!typ || d.type_depense === typ));
      return json(tri(rows, ["mois", -1], ["date_echeance", -1]).slice(0, 500));
    }],
    ["GET", /^\/api\/depenses\/([^/]+)$/, (m) => json(tri(db.depenses.filter((d) => d.mois === m[1]), ["categorie", 1], ["date_echeance", 1]))],
    ["POST", /^\/api\/depenses$/, (m, q, b) => { ajouterDepense(b); enregistrer(); return json({ ok: true }); }],
    ["PUT", /^\/api\/depenses\/(\d+)$/, (m, q, b) => {
      const d = db.depenses.find((x) => x.id === Number(m[1]));
      if (d) Object.assign(d, { element: b.element, date_echeance: b.date_echeance || null, montant: Number(b.montant), categorie: b.categorie,
        a_rembourser: Number(b.a_rembourser || 0), type_depense: b.type_depense || "autre", personne: personne(b) });
      enregistrer(); return json({ ok: true });
    }],
    ["DELETE", /^\/api\/(depenses|revenus)\/(\d+)$/, (m) => {
      const liste = db[m[1]], i = liste.findIndex((x) => x.id === Number(m[2]));
      const sup = i >= 0 ? liste.splice(i, 1)[0] : null;
      enregistrer(); return json({ ok: true, supprime: sup });
    }],
    ["POST", /^\/api\/depenses\/(\d+)\/toggle-rembourse$/, (m) => {
      const d = db.depenses.find((x) => x.id === Number(m[1]));
      if (d) d.a_rembourser = d.a_rembourser === 1 ? 2 : 1;
      enregistrer(); return json({ ok: true, rembourse: !!d && d.a_rembourser === 2 });
    }],
    ["GET", /^\/api\/remboursements$/, () => json(aRembourser(db.depenses))],
    ["GET", /^\/api\/suggestions$/, () => json([...new Set(db.depenses.map((d) => d.element))].sort(nocase))],
    ["GET", /^\/api\/personnes$/, () => json([...new Set(db.depenses.map((d) => d.personne).filter(Boolean))].sort(nocase))],

    ["GET", /^\/api\/revenus\/([^/]+)$/, (m) => json(tri(db.revenus.filter((r) => r.mois === m[1]), ["date_revenu", 1]))],
    ["POST", /^\/api\/revenus$/, (m, q, b) => {
      db.seq.revenus += 1;
      db.revenus.push({ id: db.seq.revenus, mois: b.mois, element: b.element, date_revenu: b.date_revenu || null,
        montant: Number(b.montant), created_at: new Date().toISOString() });
      enregistrer(); return json({ ok: true });
    }],

    ["GET", /^\/api\/bilan\/([^/]+)$/, (m) => {
      const dep = db.depenses.filter((d) => d.mois === m[1]), rev = db.revenus.filter((r) => r.mois === m[1]);
      return json({ total_depenses: somme(dep), total_revenus: somme(rev), bilan: somme(rev) - somme(dep),
        fixes: somme(dep.filter((d) => d.categorie === "fixe")), variables: somme(dep.filter((d) => d.categorie === "variable")),
        remboursements: somme(dep.filter((d) => d.a_rembourser === 1)) });
    }],
    ["GET", /^\/api\/mois$/, () => { creerMoisCourant(); return json(moisListe()); }],
    ["GET", /^\/api\/stats\/mensuel$/, () => json(moisListe().map((m) => {
      const dep = db.depenses.filter((d) => d.mois === m);
      return { mois: m, depenses: r2(somme(dep)), revenus: r2(somme(db.revenus.filter((r) => r.mois === m))),
        remboursements: r2(somme(dep.filter((d) => d.a_rembourser >= 1))) };
    }))],
    ["GET", /^\/api\/stats\/categories$/, () => {
      const t = new Map();
      db.depenses.forEach((d) => t.set(d.type_depense, (t.get(d.type_depense) || 0) + d.montant));
      return json([...t].sort((a, b) => b[1] - a[1]).map(([type, total]) => ({ type: type || "autre", total: r2(total) })));
    }],

    ["GET", /^\/api\/avoirs$/, () => json({ solde: solde() })],
    ["PUT", /^\/api\/avoirs$/, (m, q, b) => { db.avoirs = { solde_saisi: Number(b.solde), net_ref: net() }; enregistrer(); return json({ ok: true }); }],
    ["GET", /^\/api\/prevision$/, () => {
      const t = new Date(), mois = moisCourant();
      const variables = somme(db.depenses.filter((d) => d.mois === mois && d.categorie === "variable"));
      const rythme = variables / t.getDate();
      const restants = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate() - t.getDate();
      const s = solde();
      return json({ solde: s, rythme_jour: r2(rythme), jours_restants: restants,
        fin_de_mois: s === null ? null : r2(s - rythme * restants), rembours_attente: r2(somme(db.depenses.filter((d) => d.a_rembourser === 1))) });
    }],

    ["GET", /^\/api\/prenom$/, () => json({ prenom: db.reglages.prenom ?? null })],
    ["PUT", /^\/api\/prenom$/, (m, q, b) => {
      const p = String((b || {}).prenom || "").split(/\s+/).filter(Boolean).join(" ").slice(0, 30);
      db.reglages.prenom = p; enregistrer(); return json({ ok: true, prenom: p });
    }],
    ["GET", /^\/api\/notes$/, async () => {
      const n = await notes();
      // rappel de sauvegarde : des dépenses, et aucune sauvegarde depuis 14 jours (champ absent côté app.py)
      const derniere = db.reglages.derniere_sauvegarde;
      const rappel_sauvegarde = db.depenses.length > 0 && !(derniere && Date.now() - Date.parse(derniere) < 14 * 864e5);
      if (!n.length) return json({ nouvelles: [], toutes: [], version: null, rappel_sauvegarde });
      let nouvelles = [];
      if (db.reglages.notes_vues === undefined) { db.reglages.notes_vues = n[0].id; enregistrer(); }
      else nouvelles = n.filter((x) => x.id > (db.reglages.notes_vues || ""));
      return json({ nouvelles, toutes: n.slice(0, 10), version: n[0].id, rappel_sauvegarde });
    }],
    ["PUT", /^\/api\/notes\/vues$/, async () => {
      const n = await notes();
      if (n.length) { db.reglages.notes_vues = n[0].id; enregistrer(); }
      return json({ ok: true });
    }],

    ["GET", /^\/api\/budgets$/, () => json(db.budgets)],
    ["PUT", /^\/api\/budgets$/, (m, q, b) => {
      Object.entries(b || {}).forEach(([typ, montant]) => {
        if (montant === null || montant === "" || Number(montant) <= 0) delete db.budgets[typ];
        else db.budgets[typ] = Number(montant);
      });
      enregistrer(); return json({ ok: true });
    }],
    ["GET", /^\/api\/budgets\/([^/]+)$/, (m) => json(Object.keys(db.budgets).sort().map((typ) => ({ type: typ, budget: db.budgets[typ],
      depense: r2(somme(db.depenses.filter((d) => d.mois === m[1] && d.type_depense === typ))) })))],

    ["POST", /^\/api\/dictee$/, (m, q, b) => {
      const compte = new Map();
      db.depenses.forEach((d) => { const k = JSON.stringify([d.element, d.type_depense]); compte.set(k, (compte.get(k) || 0) + 1); });
      const historique = [...compte].sort((a, c) => c[1] - a[1]).map(([k]) => JSON.parse(k));
      return json(window.Dictee.analyser((b || {}).texte || "", (b || {}).mois, historique));
    }],

    ["GET", /^\/api\/export\/csv$/, () => fichier(csv(), `mes_comptes_${new Date().toISOString().slice(0, 10)}.csv`)],
    ["GET", /^\/api\/export\/pdf\/remboursements(?:\/([^/]+))?$/, (m, q) => {
      const qui = q.get("personne") || null;
      return fichier(pdfRemboursements(m[1] || null, qui), `remboursements_${m[1] || "tous"}${qui ? "_" + qui : ""}.pdf`);
    }],
    ["GET", /^\/api\/export\/pdf\/([^/]+)$/, (m) => fichier(pdfMois(m[1]), `comptes_${m[1]}.pdf`)],

    // Sauvegarde / restauration des données (fichier sur l'ordinateur)
    ["GET", /^\/api\/sauvegarde$/, () => {
      db.reglages.derniere_sauvegarde = new Date().toISOString(); enregistrer();
      return fichier(new Blob([JSON.stringify({ application: "mes-comptes", exporte_le: db.reglages.derniere_sauvegarde, donnees: db }, null, 1)],
        { type: "application/json" }), `mes_comptes_sauvegarde_${new Date().toISOString().slice(0, 10)}.json`);
    }],
    ["POST", /^\/api\/restauration$/, (m, q, b) => {
      const d = b && b.application === "mes-comptes" && b.donnees;
      if (!d || !Array.isArray(d.depenses) || !Array.isArray(d.revenus)) {
        return json({ ok: false, erreur: "Ce fichier n'est pas une sauvegarde de Mes Comptes." }, 400);
      }
      const ancien = db;
      try {
        db = normaliser(d); enregistrer();          // si l'écriture échoue, le stockage garde l'ancienne version
      } catch (e) {
        db = ancien;
        return json({ ok: false, erreur: "Restauration impossible : le stockage du navigateur est plein." }, 500);
      }
      return json({ ok: true, depenses: db.depenses.length, revenus: db.revenus.length });
    }],
  ];

  // ── Interception des requêtes ──────────────────────────────────────────────

  window.fetch = async function (entree, options) {
    const url = new URL(typeof entree === "string" ? entree : entree.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) {
      return fetchReseau(entree, options);
    }
    const methode = ((options && options.method) || "GET").toUpperCase();
    for (const [meth, motif, action] of routes) {
      const m = url.pathname.match(motif);
      if (m && meth === methode) {
        let corps = null;
        if (options && typeof options.body === "string") { try { corps = JSON.parse(options.body); } catch (e) { corps = null; } }
        return action(m, url.searchParams, corps);      // une erreur d'enregistrement rejette la promesse
      }
    }
    return json({ erreur: "introuvable" }, 404);
  };
})();
