let currentMois = "";
let chartMensuel = null;
let chartCategories = null;
let chartRemboursements = null;

// Couleurs lues dans le CSS, pour que les graphiques suivent le thème clair / sombre
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

Chart.defaults.font.family = "'Manrope', sans-serif";
Chart.defaults.font.size   = 12;

const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

const HORS_LIGNE = window.MES_COMPTES_LOCAL
  ? "Enregistrement impossible : le stockage du navigateur est plein ou bloqué."
  : "L'application ne répond plus. Fermez cette page et relancez Mes Comptes.";

// Exports (PDF, Excel, sauvegarde) — marchent avec le serveur et en version navigateur.
// Le nom du fichier vient de l'en-tête Content-Disposition (forme UTF-8 en priorité).
async function recupererFichier(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  return { blob: await res.blob(), nom: m ? decodeURIComponent(m[1]) : "export" };
}

function enregistrerFichier({ blob, nom }) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function telecharger(url) {
  enregistrerFichier(await recupererFichier(url));
}

// Envoi vers le serveur qui échoue franchement (au lieu de faire comme si c'était enregistré)
async function envoyer(url, method, data) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error(`${method} ${url} : ${res.status}`);
  return res.json();
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ── Notification en bas d'écran, avec action facultative (« Annuler ») ────────

let toastTimer = null;
function toast(texte, action, onAction) {
  const el = document.getElementById("toast");
  const btn = document.getElementById("toast-action");
  document.getElementById("toast-text").textContent = texte;
  btn.hidden = !action;
  if (action) {
    btn.textContent = action;
    btn.onclick = () => { el.hidden = true; onAction(); };
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : 3500);
}

// ── Fenêtre de dialogue intégrée (remplace prompt / confirm) ──────────────────
// Résout avec la valeur saisie (ou true sans champ), ou null si annulé.
function ask({ titre, texte = "", champ = null, ok = "Valider", annuler = "Annuler" }) {
  return new Promise((resolve) => {
    const field = document.getElementById("dialog-field");
    const input = document.getElementById("dialog-input");
    document.getElementById("dialog-title").textContent = titre;
    document.getElementById("dialog-text").textContent = texte;
    document.getElementById("dialog-ok").textContent = ok;
    document.getElementById("dialog-cancel").textContent = annuler;
    field.hidden = !champ;
    if (champ) {
      input.type = champ.type || "text";
      input.value = champ.valeur || "";
      input.placeholder = champ.placeholder || "";
      input.maxLength = champ.max || 524288;
    }
    const fin = (v) => { document.getElementById("modal-dialog").classList.remove("open"); resolve(v); };
    document.getElementById("dialog-ok").onclick = () => fin(champ ? input.value : true);
    document.getElementById("dialog-cancel").onclick = () => fin(null);
    input.onkeydown = (e) => { if (e.key === "Enter") fin(input.value); };
    document.getElementById("modal-dialog").classList.add("open");
    (champ ? input : document.getElementById("dialog-ok")).focus();
  });
}

// ── Prénom affiché en haut à gauche ───────────────────────────────────────────

function afficherPrenom(prenom) {
  document.getElementById("logo-prenom").textContent = prenom || "Mes Comptes";
}

async function enregistrerPrenom(prenom) {
  const r = await fetch("/api/prenom", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prenom }),
  }).then((x) => x.json());
  afficherPrenom(r.prenom);
}

// Premier lancement uniquement : la réponse (même « Passer ») est mémorisée
async function demanderPrenomSiBesoin() {
  const { prenom } = await fetch("/api/prenom").then((r) => r.json());
  if (prenom !== null) return afficherPrenom(prenom);
  const v = await ask({
    titre: "Quel est votre prénom ?",
    champ: { placeholder: "Votre prénom", max: 30 },
    ok: "C'est parti", annuler: "Passer",
  });
  await enregistrerPrenom((v || "").trim());
}

async function changerPrenom() {
  const actuel = document.getElementById("logo-prenom").textContent;
  const v = await ask({
    titre: "Modifier le prénom",
    champ: { valeur: actuel === "Mes Comptes" ? "" : actuel, placeholder: "Votre prénom", max: 30 },
    ok: "Enregistrer",
  });
  if (v !== null) await enregistrerPrenom(v.trim());
}

function refreshActive() {
  refreshTab(document.querySelector(".tab.active").id.replace("tab-", ""));
}

const fmt = (n) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n ?? 0);

const fmtDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};

// ── Tabs ──────────────────────────────────────────────────────────────────────

function showTab(name, btn) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
  btn.classList.add("active");
  refreshTab(name);
}

function refreshTab(name) {
  if (name === "dashboard")      loadDashboard();
  if (name === "depenses")       loadDepenses();
  if (name === "revenus")        loadRevenus();
  if (name === "remboursements") loadRemboursements();
}

// ── Mois ──────────────────────────────────────────────────────────────────────

async function loadMois() {
  const res  = await fetch("/api/mois");
  let mois   = await res.json();

  const now     = new Date();
  const moisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (!mois.includes(moisKey)) mois.push(moisKey);
  // un mois choisi mais encore vide doit rester sélectionnable
  if (currentMois && !mois.includes(currentMois)) mois.push(currentMois);
  mois.sort();

  const sel = document.getElementById("moisSelect");
  sel.innerHTML = "";
  [...mois].reverse().forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = formatMoisLabel(m);
    sel.appendChild(opt);
  });

  if (!currentMois || !mois.includes(currentMois)) currentMois = moisKey;
  sel.value = currentMois;
  updateMoisSubs();
}

function formatMoisLabel(m) {
  if (!m) return m;
  const [y, mo] = m.split("-");
  const d = new Date(y, parseInt(mo) - 1, 1);
  return d.toLocaleString("fr-FR", { month: "long", year: "numeric" });
}

function onMoisChange() {
  currentMois = document.getElementById("moisSelect").value;
  updateMoisSubs();
  const activeTab = document.querySelector(".tab.active").id.replace("tab-", "");
  refreshTab(activeTab);
}

function updateMoisSubs() {
  const label = formatMoisLabel(currentMois);
  const el = document.getElementById("dep-mois-sub");
  if (el) el.textContent = label;
  const el2 = document.getElementById("rev-mois-sub");
  if (el2) el2.textContent = label;
}

async function addMois() {
  // Safari (Mac) n'a pas de sélecteur de mois : le champ devient du texte, d'où le format indiqué
  let val = await ask({ titre: "Afficher un autre mois", texte: "Choisissez le mois à ouvrir (format AAAA-MM, ex : 2026-07).",
                        champ: { type: "month", valeur: currentMois, placeholder: "AAAA-MM" }, ok: "Ouvrir ce mois" });
  if (!val) return;
  // accepte « 2026-07 », « 2026-7 » ou « 07/2026 »
  const t = val.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})$/);
  if (m) val = `${m[1]}-${m[2].padStart(2, "0")}`;
  else if ((m = t.match(/^(\d{1,2})[\/.-](\d{4})$/))) val = `${m[2]}-${m[1].padStart(2, "0")}`;
  else val = "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(val)) return toast("Mois non reconnu. Écrivez par exemple 2026-07.");
  currentMois = val;
  loadMois().then(refreshActive);
}

// ── Graphiques ────────────────────────────────────────────────────────────────

function destroyChart(c) { if (c) c.destroy(); }

function moisShort(m) {
  const [y, mo] = m.split("-");
  return new Date(y, parseInt(mo) - 1, 1).toLocaleString("fr-FR", { month: "short", year: "2-digit" });
}

async function loadCharts() {
  await document.fonts.ready;   // sinon la légende est mesurée avec la mauvaise police et tronquée
  const [stats, cats] = await Promise.all([
    fetch("/api/stats/mensuel").then(r => r.json()),
    fetch("/api/stats/categories").then(r => r.json()),
  ]);

  const labels   = stats.map(s => moisShort(s.mois));
  const depData  = stats.map(s => s.depenses);
  const revData  = stats.map(s => s.revenus);
  const rembData = stats.map(s => s.remboursements);

  const gridColor = cssVar("--grid");
  const tickColor = cssVar("--text-3");
  const red   = cssVar("--red");
  const green = cssVar("--green");
  const gold  = cssVar("--ink");
  Chart.defaults.color = tickColor;

  const barScales = {
    x: { grid: { display: false }, border: { display: false }, ticks: { color: tickColor } },
    y: {
      grid: { color: gridColor }, border: { display: false },
      ticks: { color: tickColor, maxTicksLimit: 5, callback: v => v + " €" },
      beginAtZero: true,
    },
  };
  const barStyle = { borderRadius: 6, borderSkipped: false, maxBarThickness: 26 };
  const euroTooltip = { callbacks: { label: ctx => ` ${ctx.dataset.label || ctx.label} : ${fmt(ctx.parsed.y ?? ctx.parsed)}` } };

  // ── Graphique 1 : Dépenses & Revenus par mois (barres groupées)
  destroyChart(chartMensuel);
  chartMensuel = new Chart(document.getElementById("chart-mensuel"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Dépenses", data: depData, backgroundColor: red,   ...barStyle },
        { label: "Revenus",  data: revData, backgroundColor: green, ...barStyle },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { align: "end", labels: { color: tickColor, usePointStyle: true, pointStyle: "rectRounded", boxWidth: 8, padding: 14 } },
        tooltip: euroTooltip,
      },
      scales: barScales,
    },
  });

  // ── Graphique 2 : Donut catégories (couleurs par rang, le reste en gris)
  destroyChart(chartCategories);
  const catLabels = cats.map(c => (TYPE_LABELS[c.type] || c.type).replace(/^[^ ]+ /, ""));
  const catData   = cats.map(c => c.total);
  const catColors = cats.map((c, i) => cssVar(`--cat-${Math.min(i + 1, 8)}`));
  const narrow = window.innerWidth < 860;
  chartCategories = new Chart(document.getElementById("chart-categories"), {
    type: "doughnut",
    data: {
      labels: catLabels,
      datasets: [{
        data: catData,
        backgroundColor: catColors,
        borderColor: cssVar("--surface"),
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "64%",
      plugins: {
        legend: {
          position: narrow ? "bottom" : "right",
          labels: { color: tickColor, usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 10 },
        },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label} : ${fmt(ctx.parsed)}` } },
      },
    },
  });

  // ── Graphique 3 : Remboursements par mois (barres)
  destroyChart(chartRemboursements);
  const rembLabels = stats.filter(s => s.remboursements > 0).map(s => moisShort(s.mois));
  const rembValues = stats.filter(s => s.remboursements > 0).map(s => s.remboursements);
  chartRemboursements = new Chart(document.getElementById("chart-remboursements"), {
    type: "bar",
    data: {
      labels: rembLabels.length ? rembLabels : labels,
      datasets: [{
        label: "Remboursements",
        data: rembLabels.length ? rembValues : rembData,
        backgroundColor: gold,
        ...barStyle,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: euroTooltip },
      scales: barScales,
    },
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function loadDashboard() {
  document.getElementById("db-mois-title").textContent = formatMoisLabel(currentMois);

  const mois = currentMois;
  const bilan = await fetch(`/api/bilan/${mois}`).then((r) => r.json());
  if (mois !== currentMois) return;   // réponse d'un mois quitté entre-temps : on l'ignore

  document.getElementById("db-depenses").textContent = fmt(bilan.total_depenses);
  document.getElementById("db-revenus").textContent  = fmt(bilan.total_revenus);
  document.getElementById("db-fixes").textContent    = fmt(bilan.fixes);
  document.getElementById("db-variables").textContent = fmt(bilan.variables);
  document.getElementById("db-remboursements").textContent = fmt(bilan.remboursements);

  const bilanEl   = document.getElementById("db-bilan");
  const bilanCard = document.getElementById("db-bilan-card");
  bilanEl.textContent = fmt(bilan.bilan);
  bilanCard.className = "card " + (bilan.bilan >= 0 ? "card-green" : "card-red");

  loadAvoirs();
  loadPrevision();
  loadBudgets();
  loadCharts();

  const deps  = await fetch(`/api/depenses/${mois}`).then((r) => r.json());
  if (mois !== currentMois) return;   // réponse d'un mois quitté entre-temps : on l'ignore
  const tbody = document.getElementById("db-recent");
  tbody.innerHTML = "";
  const recent = [...deps].slice(-8).reverse();
  if (recent.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Aucune dépense ce mois-ci. Ajoutez-en depuis l'onglet Dépenses.</td></tr>`;
    return;
  }
  recent.forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(d.element)}</td>
      <td><span class="badge ${d.categorie === 'fixe' ? 'badge-fixe' : 'badge-var'}">${d.categorie === 'fixe' ? 'Fixe' : 'Variable'}</span></td>
      <td>${fmtDate(d.date_echeance)}</td>
      <td class="amount">${fmt(d.montant)}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadAvoirs() {
  const a = await fetch("/api/avoirs").then((r) => r.json());
  const el = document.getElementById("db-avoirs");
  el.value = a.solde == null ? "" : a.solde.toFixed(2);
  ajusterLargeur(el);
}

// Le « € » suit le montant. Sans « field-sizing » (certains Safari), on calcule la largeur.
const LARGEUR_AUTO = window.CSS && CSS.supports("field-sizing", "content");
function ajusterLargeur(el) {
  if (!LARGEUR_AUTO) el.style.width = Math.max(3, (el.value || el.placeholder).length + 0.5) + "ch";
}
["db-avoirs", "dep-montant", "rev-montant"].forEach((id) =>
  document.getElementById(id).addEventListener("input", (e) => ajusterLargeur(e.target)));

async function saveAvoirs() {
  const v = parseFloat(document.getElementById("db-avoirs").value);
  if (isNaN(v)) return;
  const res = await fetch("/api/avoirs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ solde: v }),
  }).catch(() => null);
  if (!res || !res.ok) return toast("Solde non enregistré. Relancez l'application puis réessayez.");
  toast("Solde enregistré");
  loadAvoirs();
  loadPrevision();
}

async function loadPrevision() {
  const p = await fetch("/api/prevision").then((r) => r.json());
  const val = document.getElementById("db-prevision");
  const sub = document.getElementById("db-prevision-sub");
  if (p.fin_de_mois === null) {
    val.textContent = "—";
    sub.textContent = "Saisissez vos avoirs pour l'obtenir";
    return;
  }
  val.textContent = fmt(p.fin_de_mois);
  sub.textContent = `À ${fmt(p.rythme_jour)} par jour, ${p.jours_restants} j restants`
    + (p.rembours_attente > 0 ? ` (+ ${fmt(p.rembours_attente)} attendus)` : "");
}

// ── Budgets ───────────────────────────────────────────────────────────────────

async function loadBudgets() {
  const mois = currentMois;
  const rows = await fetch(`/api/budgets/${mois}`).then((r) => r.json());
  if (mois !== currentMois) return;   // réponse d'un mois quitté entre-temps : on l'ignore
  const box = document.getElementById("db-budgets");
  if (!rows.length) {
    box.innerHTML = `<p class="empty-note">Aucun budget. Fixez un plafond par catégorie avec « Gérer les budgets ».</p>`;
    return;
  }
  box.innerHTML = rows.map((b) => {
    const pct = b.budget ? (b.depense / b.budget) * 100 : 0;
    const etat = pct > 100 ? "over" : pct >= 75 ? "warn" : "ok";
    const reste = b.budget - b.depense;
    return `
      <div class="budget budget--${etat}">
        <div class="budget-head">
          <span>${typeLabel(b.type)}</span>
          <span class="budget-num"><strong>${fmt(b.depense)}</strong> / ${fmt(b.budget)}</span>
        </div>
        <div class="budget-bar"><span style="width:${Math.min(pct, 100)}%"></span></div>
        <span class="budget-note">${reste >= 0 ? `Reste ${fmt(reste)}` : `Dépassé de ${fmt(-reste)}`}</span>
      </div>`;
  }).join("");
}

async function openBudgets() {
  const actuels = await fetch("/api/budgets").then((r) => r.json());
  document.getElementById("budget-form").innerHTML = Object.keys(TYPE_LABELS).map((t) => `
    <label class="budget-input">
      <span>${TYPE_LABELS[t]}</span>
      <span class="budget-field">
        <input type="number" min="0" step="1" inputmode="decimal" data-type="${t}" value="${esc(actuels[t] ?? "")}" placeholder="—">
        <span>€</span>
      </span>
    </label>`).join("");
  openModal("modal-budgets");
}

async function saveBudgets() {
  const data = {};
  document.querySelectorAll("#budget-form input").forEach((i) => { data[i.dataset.type] = i.value; });
  const res = await fetch("/api/budgets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
    .catch(() => null);
  if (!res || !res.ok) return toast("Budgets non enregistrés. " + HORS_LIGNE);
  closeModal("modal-budgets");
  toast("Budgets enregistrés");
  loadBudgets();
}

// ── Dépenses ──────────────────────────────────────────────────────────────────

async function loadDepenses() {
  if (!document.getElementById("search-results").hidden) runSearch();
  const mois = currentMois;
  const deps = await fetch(`/api/depenses/${mois}`).then((r) => r.json());
  if (mois !== currentMois) return;   // réponse d'un mois quitté entre-temps : on l'ignore
  const fixes    = deps.filter((d) => d.categorie === "fixe");
  const variables = deps.filter((d) => d.categorie === "variable");

  renderDepTable("list-fixe",     fixes,    false);
  renderDepTable("list-variable", variables, true);

  const tFixes = fixes.reduce((s, d) => s + d.montant, 0);
  const tVars  = variables.reduce((s, d) => s + d.montant, 0);
  document.getElementById("total-fixes").textContent    = fmt(tFixes);
  document.getElementById("total-variables").textContent = fmt(tVars);
  document.getElementById("total-dep-all").textContent  = fmt(tFixes + tVars);
}

function downloadPDF() {
  telecharger(`/api/export/pdf/${currentMois}`);
}

// Filtre « personne » de l'onglet Remboursements, appliqué aux PDF et au partage
const personneChoisie = () => document.getElementById("rembours-personne").value;
function urlRemboursements(mois) {
  const p = personneChoisie();
  return (mois ? `/api/export/pdf/remboursements/${mois}` : "/api/export/pdf/remboursements")
    + (p ? `?personne=${encodeURIComponent(p)}` : "");
}

function downloadPDFRemboursements() {
  telecharger(urlRemboursements());
}

function downloadPDFRemboursementsMois(mois) {
  telecharger(urlRemboursements(mois));
}

// Partage du PDF : ouvre le menu "Partager" de Windows/Mac (choisir WhatsApp puis le contact).
// WhatsApp ne permet pas d'envoyer un fichier par lien : sans menu Partager,
// on télécharge le PDF et on ouvre WhatsApp pour le joindre à la main.
async function sharePDFRemboursements(mois) {
  const p       = personneChoisie();
  const fichier = await recupererFichier(urlRemboursements(mois));
  const file    = new File([fichier.blob], fichier.nom, { type: "application/pdf" });
  const text = `Remboursements ${mois ? formatMoisLabel(mois) : ""}${p ? " pour " + p : ""}`.replace(/\s+/g, " ").trim();

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: text, text }); } catch (e) {}
    return;
  }
  enregistrerFichier(fichier);
  window.open(`https://wa.me/?text=${encodeURIComponent(text + " (PDF en pièce jointe)")}`, "_blank");
}

function renderDepTable(id, rows, showRembours) {
  const tbody = document.getElementById(id);
  tbody.innerHTML = "";
  const cols = showRembours ? 6 : 5;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols}">${showRembours ? "Aucune dépense ce mois-ci." : "Aucune charge fixe."} Utilisez le bouton « Ajouter » ci-dessus.</td></tr>`;
    return;
  }
  rows.forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(d.element)} <span class="type-tag type-${TYPE_LABELS[d.type_depense] ? d.type_depense : "autre"}">${typeLabel(d.type_depense)}</span></td>
      <td>${fmtDate(d.date_echeance)}</td>
      <td class="amount">${fmt(d.montant)}</td>
      ${showRembours ? `<td>${d.a_rembourser ? `<span class="badge badge-rembours">À rembourser${d.personne ? " par " + esc(d.personne) : ""}</span>` : ''}</td>` : ""}
      <td>
        <button class="btn-icon" title="Modifier" aria-label="Modifier ${esc(d.element)}" onclick="editDepense(${Number(d.id)})">${icon("edit")}</button>
        <button class="btn-icon btn-icon--danger" title="Supprimer" aria-label="Supprimer ${esc(d.element)}" onclick="deleteDepense(${Number(d.id)})">${icon("trash")}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openModalDep(cat) {
  document.getElementById("dep-categorie").value = cat;
  document.getElementById("form-group-categorie").style.display = cat ? "none" : "block";
  document.getElementById("dep-cat-forced").value = cat;
  document.getElementById("modal-dep-title").textContent = cat === "fixe" ? "Nouvelle charge fixe" : "Nouvelle dépense";
  document.getElementById("modal-dep-sub").textContent = cat === "fixe"
    ? "Charge récurrente mensuelle"
    : "Dépense variable ou ponctuelle";
  openModal("modal-depense");
}

const TYPE_LABELS = {
  nourriture: "🛒 Nourriture", restaurant: "🍽️ Restaurant", sport: "⚽ Sport",
  jeux: "🎮 Jeux", cadeaux: "🎁 Cadeaux", transport: "🚆 Transport",
  logement: "🏠 Logement", sante: "💊 Santé", vetements: "👕 Vêtements",
  voyage: "✈️ Voyage", soiree: "🍻 Soirée", abonnement: "📱 Abonnement",
  etudes: "📚 Études", culture: "🎭 Culture", autre: "• Autre"
};
function typeLabel(t) { return TYPE_LABELS[t] || "• Autre"; }

function selectType(type, btn) {
  document.querySelectorAll(".type-btn").forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  document.getElementById("dep-type").value = type;
}

async function loadSuggestions() {
  const items = await fetch("/api/suggestions").then((r) => r.json());
  const dl = document.getElementById("suggestions-list");
  dl.innerHTML = "";
  items.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    dl.appendChild(opt);
  });
}

async function loadPersonnes() {
  const noms = await fetch("/api/personnes").then((r) => r.json());
  document.getElementById("personnes-list").innerHTML = noms.map((n) => `<option value="${esc(n)}">`).join("");
  return noms;
}

function togglePersonne() {
  document.getElementById("fg-personne").hidden = !document.getElementById("dep-rembours").checked;
}

function openModal(id) {
  if (id === "modal-depense") { loadSuggestions(); loadPersonnes(); togglePersonne(); }
  document.getElementById(id).classList.add("open");
}

function closeModal(id) {
  if (id === "modal-dialog") return document.getElementById("dialog-cancel").click();   // répond « Annuler »
  document.getElementById(id).classList.remove("open");
  if (id === "modal-dictee") { veutEcouter = false; if (ecoute) reco.stop(); }
  if (id === "modal-depense") {
    document.getElementById("dep-edit-id").value    = "";
    document.getElementById("dep-element").value    = "";
    document.getElementById("dep-date").value        = "";
    document.getElementById("dep-montant").value    = "";
    document.getElementById("dep-rembours").checked  = false;
    document.getElementById("dep-personne").value   = "";
    document.getElementById("dep-error").textContent = "";
    document.getElementById("dep-categorie").value   = "variable";
    selectType("autre", document.querySelector('[data-type="autre"]'));
    document.getElementById("dep-cat-forced").value = "";
    document.getElementById("form-group-categorie").style.display = "block";
    document.getElementById("modal-dep-title").textContent = "Nouvelle dépense";
  }
  if (id === "modal-revenu") {
    document.getElementById("rev-element").value = "";
    document.getElementById("rev-date").value     = "";
    document.getElementById("rev-montant").value  = "";
    document.getElementById("rev-fixe").checked   = false;
    document.getElementById("rev-edit-id").value  = "";
    document.getElementById("rev-error").textContent = "";
    document.getElementById("modal-rev-title").textContent = "Nouveau revenu";
    document.getElementById("modal-rev-sub").textContent   = "Ajoutez une entrée d'argent";
  }
}

async function saveDepense() {
  const id  = document.getElementById("dep-edit-id").value;
  const cat = document.getElementById("dep-cat-forced").value || document.getElementById("dep-categorie").value;
  const data = {
    mois:          currentMois,
    element:       document.getElementById("dep-element").value.trim(),
    categorie:     cat,
    date_echeance: document.getElementById("dep-date").value || null,
    montant:       parseFloat(document.getElementById("dep-montant").value) || 0,
    a_rembourser:  document.getElementById("dep-rembours").checked ? 1 : 0,
    type_depense:  document.getElementById("dep-type").value || "autre",
    personne:      document.getElementById("dep-personne").value.trim(),
  };
  // en modification, garder le statut « déjà remboursé » (2)
  if (id && data.a_rembourser && depEnCours && depEnCours.a_rembourser === 2) data.a_rembourser = 2;
  const err = document.getElementById("dep-error");
  if (!data.montant) return (err.textContent = "Indiquez un montant.");
  if (!data.element) return (err.textContent = "Indiquez ce que vous avez payé (élément).");

  const url    = id ? `/api/depenses/${id}` : "/api/depenses";
  const method = id ? "PUT" : "POST";
  await envoyer(url, method, data);

  closeModal("modal-depense");
  toast(id ? "Dépense modifiée" : "Dépense ajoutée");
  refreshActive();
}

let depEnCours = null;

async function editDepense(id) {
  const deps = await fetch(`/api/depenses/${currentMois}`).then((r) => r.json());
  const d = deps.find((x) => x.id === id) || resultatsRecherche.find((x) => x.id === id);
  if (!d) return;
  depEnCours = d;
  document.getElementById("dep-edit-id").value    = d.id;
  document.getElementById("dep-personne").value   = d.personne || "";
  document.getElementById("dep-element").value    = d.element;
  document.getElementById("dep-categorie").value  = d.categorie;
  document.getElementById("dep-date").value        = d.date_echeance || "";
  document.getElementById("dep-montant").value    = d.montant;
  document.getElementById("dep-rembours").checked = !!d.a_rembourser;
  const typ = TYPE_LABELS[d.type_depense] ? d.type_depense : "autre";
  selectType(typ, document.querySelector(`[data-type="${typ}"]`));
  document.getElementById("dep-cat-forced").value = "";
  document.getElementById("form-group-categorie").style.display = "block";
  document.getElementById("modal-dep-title").textContent = "Modifier la dépense";
  document.getElementById("modal-dep-sub").textContent   = d.element;
  openModal("modal-depense");
}


// Suppression immédiate, avec « Annuler » pendant quelques secondes
async function deleteDepense(id) {
  const { supprime: d } = await fetch(`/api/depenses/${id}`, { method: "DELETE" }).then((r) => r.json());
  refreshActive();
  if (!d) return;
  toast(`« ${d.element} » supprimée`, "Annuler", async () => {
    await fetch("/api/depenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
    toast("Dépense rétablie");
    refreshActive();
  });
}

// ── Recherche (tous les mois) ─────────────────────────────────────────────────

let resultatsRecherche = [];
let searchTimer = null;

function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
}

function clearSearch() {
  document.getElementById("search-q").value = "";
  document.getElementById("search-type").value = "";
  runSearch();
}

async function runSearch() {
  const q = document.getElementById("search-q").value.trim();
  const type = document.getElementById("search-type").value;
  const actif = !!(q || type);
  document.getElementById("search-results").hidden = !actif;
  document.getElementById("dep-mois-view").hidden = actif;
  if (!actif) { resultatsRecherche = []; return; }

  resultatsRecherche = await fetch(`/api/depenses/recherche?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`).then((r) => r.json());
  const total = resultatsRecherche.reduce((s, d) => s + d.montant, 0);
  document.getElementById("search-title").textContent =
    `${resultatsRecherche.length} résultat${resultatsRecherche.length > 1 ? "s" : ""}, ${fmt(total)}`;
  const tbody = document.getElementById("list-recherche");
  if (!resultatsRecherche.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Aucune dépense ne correspond, tous mois confondus.</td></tr>`;
    return;
  }
  tbody.innerHTML = resultatsRecherche.map((d) => `
    <tr>
      <td>${esc(d.element)} <span class="type-tag">${typeLabel(d.type_depense)}${d.personne ? ", " + esc(d.personne) : ""}</span></td>
      <td class="cap">${formatMoisLabel(d.mois)}</td>
      <td>${fmtDate(d.date_echeance)}</td>
      <td class="amount">${fmt(d.montant)}</td>
      <td>
        <button class="btn-icon" title="Modifier" aria-label="Modifier ${esc(d.element)}" onclick="editDepense(${Number(d.id)})">${icon("edit")}</button>
        <button class="btn-icon btn-icon--danger" title="Supprimer" aria-label="Supprimer ${esc(d.element)}" onclick="deleteDepense(${Number(d.id)})">${icon("trash")}</button>
      </td>
    </tr>`).join("");
}

// ── Remboursements ────────────────────────────────────────────────────────────

let allRembours = [];
let currentFilter = "tous";

async function loadRemboursements() {
  allRembours = await fetch("/api/remboursements").then((r) => r.json());
  const sel = document.getElementById("rembours-personne");
  const choix = sel.value;
  const noms = [...new Set(allRembours.map((d) => d.personne).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">Toutes les personnes</option>`
    + noms.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  sel.value = noms.includes(choix) ? choix : "";
  sel.hidden = !noms.length;
  renderRemboursements();
}

function filterRembours(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderRemboursements();
}

function renderRemboursements() {
  const p = personneChoisie();
  const base = p ? allRembours.filter((d) => d.personne === p) : allRembours;
  const filtered = base.filter((d) => {
    if (currentFilter === "attente") return d.a_rembourser === 1;
    if (currentFilter === "recu")    return d.a_rembourser === 2;
    return true;
  });

  const attente = base.filter((d) => d.a_rembourser === 1).reduce((s, d) => s + d.montant, 0);
  const recu    = base.filter((d) => d.a_rembourser === 2).reduce((s, d) => s + d.montant, 0);
  document.getElementById("rembours-attente").textContent = fmt(attente);
  document.getElementById("rembours-recu").textContent    = fmt(recu);
  document.getElementById("rembours-total").textContent   = fmt(attente + recu);

  const liste = document.getElementById("list-remboursements");
  if (filtered.length === 0) {
    liste.innerHTML = `<div class="table-wrap"><table class="table"><tbody><tr class="empty-row"><td>Rien ici. Activez « Quelqu'un doit me rembourser » sur une dépense pour la suivre ici.</td></tr></tbody></table></div>`;
    return;
  }

  // Une carte par mois, du plus récent au plus ancien
  const parMois = {};
  filtered.forEach((d) => { (parMois[d.mois] = parMois[d.mois] || []).push(d); });
  const ligne = (d) => {
    const rembourse = d.a_rembourser === 2;
    const action = rembourse ? "Marquer en attente" : "Marquer comme remboursé";
    return `
      <tr class="${rembourse ? "row-rembourse" : ""}">
        <td>${esc(d.element)}${d.personne ? ` <span class="type-tag">${esc(d.personne)}</span>` : ""}</td>
        <td>${fmtDate(d.date_echeance)}</td>
        <td class="amount">${fmt(d.montant)}</td>
        <td><span class="badge ${rembourse ? "badge-green" : "badge-orange"}">${rembourse ? "Remboursé" : "En attente"}</span></td>
        <td><button class="btn-icon ${rembourse ? "" : "btn-icon--ok"}" title="${action}" aria-label="${action}" onclick="toggleRembourse(${Number(d.id)})">${icon(rembourse ? "undo" : "check")}</button></td>
      </tr>`;
  };
  liste.innerHTML = Object.keys(parMois).sort((a, b) => b.localeCompare(a)).map((mois) => {
    const items = parMois[mois];
    const enAttente = items.filter((d) => d.a_rembourser === 1).reduce((s, d) => s + d.montant, 0);
    const total = items.reduce((s, d) => s + d.montant, 0);
    return `
    <article class="table-wrap rembours-mois${enAttente ? "" : " rembours-mois--solde"}">
      <header class="rembours-mois-head">
        <div>
          <h3 class="rembours-mois-titre">${formatMoisLabel(mois)}</h3>
          <p class="rembours-mois-resume">${items.length} dépense${items.length > 1 ? "s" : ""} · ${enAttente ? `<span class="rembours-mois-attente">${fmt(enAttente)} en attente</span>` : "tout est remboursé"}</p>
        </div>
        <div class="rembours-mois-actions">
          <strong class="rembours-mois-total">${fmt(total)}</strong>
          <button class="btn-pdf btn-pdf--sm" onclick="downloadPDFRemboursementsMois(${esc(JSON.stringify(mois))})">${icon("download")} PDF</button>
          <button class="btn-pdf btn-pdf--sm btn-pdf--share" onclick="sharePDFRemboursements(${esc(JSON.stringify(mois))})" title="Envoyer par WhatsApp" aria-label="Envoyer par WhatsApp">${icon("share")}</button>
        </div>
      </header>
      <table class="table"><tbody>${items.map(ligne).join("")}</tbody></table>
    </article>`;
  }).join("");
}

async function toggleRembourse(id) {
  await fetch(`/api/depenses/${id}/toggle-rembourse`, { method: "POST" });
  loadRemboursements();
}

// ── Revenus ───────────────────────────────────────────────────────────────────

function openModalRev(fixe) {
  document.getElementById("rev-fixe").checked = fixe;
  openModal("modal-revenu");
}

let revenusAffiches = [];

function editRevenu(id) {
  const r = revenusAffiches.find((x) => x.id === id);
  if (!r) return;
  document.getElementById("rev-edit-id").value  = r.id;
  document.getElementById("rev-element").value  = r.element;
  document.getElementById("rev-date").value     = r.date_revenu || "";
  document.getElementById("rev-montant").value  = r.montant;
  document.getElementById("modal-rev-title").textContent = "Modifier le revenu";
  document.getElementById("modal-rev-sub").textContent   = r.element;
  openModalRev(!!r.fixe);
}

async function loadRevenus() {
  const mois = currentMois;
  const revs  = await fetch(`/api/revenus/${mois}`).then((r) => r.json());
  if (mois !== currentMois) return;   // réponse d'un mois quitté entre-temps : on l'ignore
  revenusAffiches = revs;
  const lignes = (rows, vide) => rows.length ? rows.map((r) => `
    <tr>
      <td>${esc(r.element)}</td>
      <td>${fmtDate(r.date_revenu)}</td>
      <td class="amount">${fmt(r.montant)}</td>
      <td>
        <button class="btn-icon" title="Modifier" aria-label="Modifier ${esc(r.element)}" onclick="editRevenu(${Number(r.id)})">${icon("edit")}</button>
        <button class="btn-icon btn-icon--danger" title="Supprimer" aria-label="Supprimer ${esc(r.element)}" onclick="deleteRevenu(${Number(r.id)})">${icon("trash")}</button>
      </td>
    </tr>`).join("") : `<tr class="empty-row"><td colspan="4">${vide}</td></tr>`;
  document.getElementById("list-revenus").innerHTML =
    lignes(revs.filter((r) => !r.fixe), "Aucun revenu ce mois-ci. Utilisez « Ajouter un revenu » ou « Dicter » ci-dessus.");
  document.getElementById("list-revenus-fixes").innerHTML =
    lignes(revs.filter((r) => r.fixe), "Aucun revenu fixe. Un salaire ajouté ici revient automatiquement chaque mois.");
  const total = revs.reduce((s, r) => s + r.montant, 0);
  document.getElementById("total-revenus").textContent     = fmt(total);
  document.getElementById("total-revenus-bar").textContent = fmt(total);
}

async function saveRevenu() {
  const id = document.getElementById("rev-edit-id").value;
  const data = {
    mois:        currentMois,
    element:     document.getElementById("rev-element").value.trim(),
    date_revenu: document.getElementById("rev-date").value || null,
    montant:     parseFloat(document.getElementById("rev-montant").value) || 0,
    fixe:        document.getElementById("rev-fixe").checked ? 1 : 0,
  };
  const err = document.getElementById("rev-error");
  if (!data.montant) return (err.textContent = "Indiquez un montant.");
  if (!data.element) return (err.textContent = "Indiquez l'origine de ce revenu (élément).");
  await envoyer(id ? `/api/revenus/${id}` : "/api/revenus", id ? "PUT" : "POST", data);
  closeModal("modal-revenu");
  toast(id ? "Revenu modifié" : "Revenu ajouté");
  loadRevenus();
}

async function deleteRevenu(id) {
  const { supprime: r } = await fetch(`/api/revenus/${id}`, { method: "DELETE" }).then((x) => x.json());
  loadRevenus();
  if (!r) return;
  toast(`« ${r.element} » supprimé`, "Annuler", async () => {
    await envoyer("/api/revenus", "POST", r);
    toast("Revenu rétabli");
    loadRevenus();
  });
}

// ── Dictée vocale ─────────────────────────────────────────────────────────────
// 1. Le navigateur transcrit la voix (Web Speech API, Chrome / Edge).
// 2. Le serveur découpe le texte en dépenses (dictee.py, règles locales).
// 3. L'utilisateur vérifie la liste, puis tout est enregistré via /api/depenses,
//    exactement comme une saisie à la main.

let reco = null;
let ecoute = false;
let dicteeItems = [];
// Ce que la dictée remplit, avec ses textes (e : accord au féminin)
const DICTEE = {
  depense: { nom: "dépense", un: "une dépense", e: "e", ecoute: "ce que vous avez payé et le prix",
    exemple: "Dites par exemple : « 4 septembre, Carrefour, 45 euros 20. Le 6, machine à laver, 3 euros. »" },
  revenu: { revenu: true, nom: "revenu", un: "un revenu", e: "", ecoute: "ce que vous avez reçu et le montant",
    exemple: "Dites par exemple : « Le 5, salaire, 1500 euros. Le 12, virement de Paul, 20 euros. »" },
};
let dictee = DICTEE.depense;
const nDicte = (n) => `${n} ${dictee.nom}${n > 1 ? "s" : ""}`;
const accord = (n) => dictee.e + (n > 1 ? "s" : "");
// Revenus qui reviennent chaque mois : cochés « fixe » d'office dans la liste à vérifier
const REVENU_FIXE = /salaire|paie|paye|apl|caf|bourse|pension|allocation|loyer/i;

function dicteeStatus(texte) { document.getElementById("dictee-status").textContent = texte; }

function openDictee(mode) {
  dictee = DICTEE[mode] || DICTEE.depense;
  document.getElementById("dictee-quoi").textContent = dictee.nom + "s";
  document.getElementById("dictee-exemple").textContent = dictee.exemple;
  document.getElementById("dictee-texte").value = "";
  document.getElementById("dictee-error").textContent = "";
  document.getElementById("dictee-etape1").hidden = false;
  document.getElementById("dictee-etape2").hidden = true;
  openModal("modal-dictee");
  if (navigateurSansVoix()) dicteeSysteme();
  else dicteeStatus("Appuyez sur le micro et parlez. Appuyez à nouveau pour arrêter.");
}

function setEcoute(on) {
  ecoute = on;
  const btn = document.getElementById("dictee-mic");
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", on);
}

// Opera, Brave et Firefox n'ont pas de reconnaissance vocale qui marche
// (Opera et Brave exposent l'API mais ne renvoient jamais de texte).
// On passe alors par la dictée du système, qui écrit dans la zone de texte.
// Chrome, Edge et Safari (Mac, iPhone) utilisent le micro intégré.
function navigateurSansVoix() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  return !SR || /OPR\/|Opera|Firefox|FxiOS/.test(navigator.userAgent) || !!navigator.brave;
}

function dicteeSysteme() {
  document.getElementById("dictee-texte").focus();
  const apple = /Mac|iPhone|iPad/.test(navigator.userAgent);
  dicteeStatus(apple
    ? "Ce navigateur ne reconnaît pas la voix. Utilisez la dictée du Mac : appuyez deux fois sur la touche Fn (ou 🌐) et parlez, le texte s'écrit ci-dessous. Ou ouvrez l'appli dans Safari."
    : "Ce navigateur ne reconnaît pas la voix. Utilisez la dictée de Windows : appuyez sur Windows + H et parlez, le texte s'écrit ci-dessous. Ou ouvrez l'appli dans Edge ou Chrome.");
}

let veutEcouter = false;   // l'utilisateur n'a pas encore appuyé sur « arrêter »

function toggleMicro() {
  if (navigateurSansVoix()) return dicteeSysteme();
  if (ecoute || veutEcouter) { veutEcouter = false; if (reco) reco.stop(); return; }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const zone = document.getElementById("dictee-texte");
  let base = zone.value.trim();   // texte déjà présent avant cette écoute
  let session = "";

  const demarrer = () => {
    reco = new SR();
    reco.lang = "fr-FR";
    reco.continuous = true;
    reco.interimResults = true;
    // Le texte est reconstruit à partir de tous les résultats à chaque fois :
    // Safari renvoie parfois des résultats déjà donnés, ce qui évite les doublons.
    reco.onresult = (e) => {
      let fin = "", enCours = "";
      for (let i = 0; i < e.results.length; i++) {
        const phrase = e.results[i][0].transcript.trim();
        if (!phrase) continue;
        // chaque pause devient une virgule : ça aide l'analyse à séparer les dépenses
        if (e.results[i].isFinal) fin += " " + phrase.replace(/[.,]?$/, ",");
        else enCours += " " + phrase;
      }
      session = fin.trim();
      zone.value = [base, session, enCours.trim()].filter(Boolean).join(" ");
    };
    reco.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;   // silence : on relance
      veutEcouter = false;
      dicteeStatus({
        "not-allowed": "Le micro est bloqué. Autorisez-le pour ce site dans le navigateur (et dans Réglages > Confidentialité > Micro sur Mac), puis réessayez.",
        "service-not-allowed": "La reconnaissance vocale est désactivée. Sur Mac, activez Siri ou la Dictée dans les Réglages Système, puis réessayez.",
        "network": "Pas de connexion : la reconnaissance vocale du navigateur a besoin d'internet.",
        "audio-capture": "Aucun micro trouvé. Vérifiez qu'un micro est branché et choisi par défaut.",
      }[e.error] || `La dictée s'est arrêtée (${e.error}).`);
    };
    // Edge et Safari coupent après un silence : on reprend tant que l'utilisateur n'a pas arrêté
    reco.onend = () => {
      base = [base, session].filter(Boolean).join(" ");
      session = "";
      zone.value = base;
      if (veutEcouter) {
        try { demarrer(); return; } catch (err) { veutEcouter = false; }
      }
      setEcoute(false);
      if (base) dicteeStatus("Dictée arrêtée. Relisez le texte puis cliquez sur « Analyser le texte ».");
    };
    reco.start();
  };

  veutEcouter = true;
  demarrer();
  setEcoute(true);
  dicteeStatus(`À l'écoute… Dites la date, ${dictee.ecoute}. Appuyez à nouveau sur le micro pour arrêter.`);
}

async function analyserDictee() {
  veutEcouter = false;
  if (ecoute) reco.stop();
  const texte = document.getElementById("dictee-texte").value.trim();
  const err = document.getElementById("dictee-error");
  if (!texte) return (err.textContent = `Dictez ou tapez au moins ${dictee.un}.`);
  const r = await fetch("/api/dictee", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texte, mois: currentMois }),
  }).then((x) => x.json());
  if (!r.depenses.length) return (err.textContent = `Aucun montant reconnu. Précisez le montant de chaque ${dictee.nom}, par exemple « 12 euros 50 ».`);
  err.textContent = "";
  dicteeItems = r.depenses;
  if (dictee.revenu) dicteeItems.forEach((d) => { d.fixe = REVENU_FIXE.test(d.element) ? 1 : 0; });
  document.getElementById("dictee-noncompris").textContent = r.non_compris.length
    ? `Pas de montant compris pour : « ${r.non_compris.join(" », « ")} ». Ajoutez-le à la main si besoin.` : "";
  renderDicteeListe();
  await loadPersonnes();
  document.getElementById("dictee-etape1").hidden = true;
  document.getElementById("dictee-etape2").hidden = false;
}

function renderDicteeListe() {
  const options = (t) => Object.keys(TYPE_LABELS)
    .map((k) => `<option value="${k}"${k === t ? " selected" : ""}>${TYPE_LABELS[k]}</option>`).join("");
  // champs propres au mode : « fixe » pour un revenu ; type et remboursement pour une dépense
  const champs = (d) => dictee.revenu ? `
      <label class="dr-remb dr-fixe"><input type="checkbox" ${d.fixe ? "checked" : ""}> Fixe, recopié chaque mois</label>` : `
      <select class="dr-type" aria-label="Type">${options(d.type_depense)}</select>
      <label class="dr-remb"><input type="checkbox" ${d.a_rembourser ? "checked" : ""} onchange="this.closest('.dictee-row').querySelector('.dr-personne').hidden = !this.checked"> À rembourser</label>
      <input class="dr-personne" list="personnes-list" aria-label="Qui doit rembourser" placeholder="Par qui ?" value="${esc(d.personne || "")}" ${d.a_rembourser ? "" : "hidden"}>`;
  document.getElementById("dictee-liste").innerHTML = dicteeItems.map((d, i) => `
    <div class="dictee-row" data-i="${i}">
      <input class="dr-element" aria-label="Élément" value="${esc(d.element === "?" ? "" : d.element)}" placeholder="Élément">
      <span class="dr-montant"><input type="number" step="0.01" aria-label="Montant" value="${(+d.montant).toFixed(2)}"><span>€</span></span>
      <input class="dr-date" type="date" aria-label="Date" value="${esc(d.date_echeance || "")}">${champs(d)}
      <button class="btn-icon btn-icon--danger dr-suppr" title="Retirer cette ligne" aria-label="Retirer cette ligne" onclick="retirerDictee(${i})">${icon("x")}</button>
    </div>`).join("");
  const n = dicteeItems.length;
  const total = dicteeItems.reduce((s, d) => s + (+d.montant || 0), 0);
  document.getElementById("dictee-resume").textContent =
    `${nDicte(n)} compris${dictee.e && accord(n)}, ${fmt(total)}. Vérifiez et corrigez si besoin.`;
  document.getElementById("dictee-save").textContent = `Enregistrer ${nDicte(n)}`;
}

function lireDicteeListe() {
  document.querySelectorAll(".dictee-row").forEach((row) => {
    const d = dicteeItems[+row.dataset.i];
    d.element       = row.querySelector(".dr-element").value.trim();
    d.montant       = parseFloat(row.querySelector(".dr-montant input").value) || 0;
    d.date_echeance = row.querySelector(".dr-date").value || null;
    if (dictee.revenu) { d.fixe = row.querySelector(".dr-fixe input").checked ? 1 : 0; return; }
    d.type_depense  = row.querySelector(".dr-type").value;
    d.a_rembourser  = row.querySelector(".dr-remb input").checked ? 1 : 0;
    d.personne      = row.querySelector(".dr-personne").value.trim();
  });
}

function retirerDictee(i) {
  lireDicteeListe();
  dicteeItems.splice(i, 1);
  if (!dicteeItems.length) return dicteeRetour();
  renderDicteeListe();
}

function dicteeRetour() {
  document.getElementById("dictee-etape1").hidden = false;
  document.getElementById("dictee-etape2").hidden = true;
}

async function enregistrerDictee() {
  lireDicteeListe();
  const err = document.getElementById("dictee-error2");
  const incomplete = dicteeItems.findIndex((d) => !d.element || !d.montant);
  if (incomplete >= 0) return (err.textContent = `Ligne ${incomplete + 1} : il manque l'élément ou le montant.`);
  err.textContent = "";
  for (const d of dicteeItems) {
    const mois = d.date_echeance ? d.date_echeance.slice(0, 7) : (d.mois || currentMois);
    if (dictee.revenu) {
      await envoyer("/api/revenus", "POST", { mois, element: d.element, date_revenu: d.date_echeance, montant: d.montant, fixe: d.fixe });
    } else {
      await envoyer("/api/depenses", "POST", { ...d, categorie: "variable", mois });
    }
  }
  const n = dicteeItems.length;
  closeModal("modal-dictee");
  toast(`${nDicte(n)} ajouté${accord(n)}`);
  loadMois().then(refreshActive);
}

// ── Fermer modal au clic extérieur ────────────────────────────────────────────

document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(overlay.id);   // remet aussi le formulaire à zéro
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────

// Signal de vie pour le serveur : au chargement, toutes les 5 s, et au retour sur l'onglet
// (en arrière-plan, le navigateur espace les signaux à ~1 par minute).
// Version navigateur : pas de serveur à garder en vie.
if (!window.MES_COMPTES_LOCAL) {
  const ping = () => fetch("/ping", { method: "POST" }).catch(() => toast(HORS_LIGNE));
  ping();
  setInterval(ping, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) ping(); });
  // Fermeture de la page : le serveur s'arrêtera si aucune page ne revient dans les 90 s
  window.addEventListener("pagehide", () => navigator.sendBeacon("/bye"));
}
// Toute requête qui échoue sans être gérée prévient l'utilisateur au lieu d'afficher du vide
window.addEventListener("unhandledrejection", () => toast(HORS_LIGNE));

document.getElementById("search-type").insertAdjacentHTML("beforeend",
  Object.keys(TYPE_LABELS).map((t) => `<option value="${t}">${TYPE_LABELS[t]}</option>`).join(""));

// Échap ferme la fenêtre ouverte
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = [...document.querySelectorAll(".modal-overlay.open")].pop();
  if (!open) return;
  closeModal(open.id);
});

// ── Sauvegarde / restauration (version navigateur : les données sont dans le navigateur) ──

async function sauvegarderDonnees() {
  await telecharger("/api/sauvegarde");
  toast("Sauvegarde téléchargée. Gardez ce fichier en lieu sûr.");
}

function restaurerDonnees() {
  const champ = document.createElement("input");
  champ.type = "file";
  champ.accept = ".json,application/json";
  champ.onchange = async () => {
    const f = champ.files[0];
    if (!f) return;
    let contenu;
    try { contenu = JSON.parse(await f.text()); } catch (e) { return toast("Ce fichier n'est pas une sauvegarde de Mes Comptes."); }
    const ok = await ask({ titre: "Restaurer cette sauvegarde ?",
      texte: "Les données actuelles de cet appareil seront remplacées par celles du fichier.", ok: "Restaurer" });
    if (!ok) return;
    const r = await fetch("/api/restauration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(contenu) });
    const rep = await r.json();
    if (!rep.ok) return toast(rep.erreur);
    toast(`Sauvegarde restaurée : ${rep.depenses} dépenses, ${rep.revenus} revenus.`
      + (rep.ignorees ? ` ${rep.ignorees} ligne(s) invalide(s) ignorée(s).` : ""));
    currentMois = "";
    await loadMois();
    refreshActive();
    demanderPrenomSiBesoin();
  };
  champ.click();
}

// Sauvegarde automatique (version navigateur)
async function sauvegardeAuOuverture() {
  try {
    await telecharger("/api/sauvegarde");
    toast("Sauvegarde automatique enregistrée dans vos Téléchargements.");
  } catch (e) {
    toast("Vos données ne sont que dans ce navigateur. Pensez à les sauvegarder.", "Sauvegarder", sauvegarderDonnees);
  }
}

function majBoutonAuto({ fichierPossible, active, bloquee }) {
  const b = document.getElementById("btn-auto");
  if (!b) return;
  b.hidden = !fichierPossible;
  b.textContent = !active ? "Activer la sauvegarde automatique"
    : bloquee ? "Reprendre la sauvegarde automatique" : "Sauvegarde automatique activée ✓";
}

async function reprendreSauvegardeAuto() {
  await window.MesComptesAuto.reprendre();
}

async function basculerSauvegardeAuto() {
  const etat = await window.MesComptesAuto.etat();
  if (etat.active && !etat.bloquee) return toast("Vos données sont enregistrées automatiquement dans le fichier choisi.");
  try {
    if (etat.active) await window.MesComptesAuto.reprendre();
    else await window.MesComptesAuto.activer();
    toast("Sauvegarde automatique activée : le fichier sera mis à jour à chaque modification.");
  } catch (e) {
    if (e.name !== "AbortError") toast("Sauvegarde automatique impossible ici. Utilisez « Sauvegarder mes données ».");
  }
}

if (window.MesComptesAuto) {
  window.addEventListener("sauvegarde-auto", () => window.MesComptesAuto.etat().then(majBoutonAuto));
}

// ── Notes de version ─────────────────────────────────────────────────────────
// Après une mise à jour automatique, les nouveautés s'affichent une seule fois.

let notesData = null;
const dateVersion = (id) => { const [a, m, j] = id.split(".")[0].split("-"); return `${j}/${m}/${a}`; };

function afficherNotes(notes, sousTitre) {
  document.getElementById("notes-sub").textContent = sousTitre;
  document.getElementById("notes-liste").innerHTML = notes.map((n) => `
    <section class="note">
      <h3>${esc(n.titre)} <span>${dateVersion(n.id)}</span></h3>
      <ul>${n.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
    </section>`).join("");
  openModal("modal-notes");
}

async function chargerNotes() {
  notesData = await fetch("/api/notes").then((r) => r.json());
  if (notesData.version) document.getElementById("version-app").textContent = `(${dateVersion(notesData.version)})`;
  if (notesData.nouvelles.length) afficherNotes(notesData.nouvelles, "L'application vient d'être mise à jour.");
  // Version navigateur : sauvegarde automatique (fichier choisi, ou téléchargement à l'ouverture)
  const s = notesData.sauvegarde;
  if (s) {
    majBoutonAuto(s);
    if (s.bloquee) toast("La sauvegarde automatique est en pause.", "Reprendre", reprendreSauvegardeAuto);
    else if (s.due) setTimeout(sauvegardeAuOuverture, 2500);
  }
}

function ouvrirNotes() {
  if (notesData && notesData.toutes.length) afficherNotes(notesData.toutes, "Les dernières versions de l'application.");
}

function fermerNotes() {
  closeModal("modal-notes");
  if (notesData && notesData.nouvelles.length) {
    notesData.nouvelles = [];
    fetch("/api/notes/vues", { method: "PUT" });
  }
}

// Fenêtres d'accueil l'une après l'autre (prénom puis nouveautés), sans bloquer le chargement
(async () => {
  await demanderPrenomSiBesoin();
  chargerNotes();
})();

(async () => {
  await loadMois();
  loadDashboard();
})();
