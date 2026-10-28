import sqlite3
import os
import csv
import glob
import platform
import threading
import time
from calendar import monthrange
from datetime import datetime, date
from flask import Flask, render_template, request, jsonify, g, send_file, Response
from fpdf import FPDF
import io
import json
import math
import re

from dictee import analyser, MOTS_CLES
import mise_a_jour


def _find_arial():
    """Retourne (regular, bold) selon l'OS, ou (None, None) si absent."""
    if platform.system() == "Windows":
        base = "C:\\Windows\\Fonts\\"
        r, b = base + "arial.ttf", base + "arialbd.ttf"
    elif platform.system() == "Darwin":
        candidates = [
            "/Library/Fonts/",
            "/System/Library/Fonts/Supplemental/",
        ]
        r = b = None
        for d in candidates:
            if os.path.exists(d + "Arial.ttf"):
                r, b = d + "Arial.ttf", d + "Arial Bold.ttf"
                break
        if not r:
            return None, None
    else:
        return None, None
    return (r if os.path.exists(r) else None, b if os.path.exists(b) else None)

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024     # aucune requête de l'appli n'approche cette taille
DB_PATH = os.path.join(os.path.dirname(__file__), "comptes.db")


# ── Sécurité ───────────────────────────────────────────────────────────────────
# Le serveur n'écoute que sur 127.0.0.1, mais une page web ouverte dans le même
# navigateur peut quand même lui envoyer des requêtes :
# - DNS rebinding : un faux nom de domaine qui pointe sur 127.0.0.1 permettrait de
#   lire les comptes -> seuls les noms d'hôte locaux sont servis ;
# - CSRF : un autre site déclencherait une écriture -> refusée si elle vient d'ailleurs.
HOTES_LOCAUX = {"127.0.0.1", "localhost"}
CSP = ("default-src 'self'; "
       "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
       "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; "
       "form-action 'self'; frame-ancestors 'none'")


@app.before_request
def _protection():
    if request.host.rsplit(":", 1)[0] not in HOTES_LOCAUX:
        return "Hôte non autorisé", 403
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        site, origine = request.headers.get("Sec-Fetch-Site"), request.headers.get("Origin")
        if (site and site not in ("same-origin", "none")) or (origine and origine != request.host_url.rstrip("/")):
            return "Requête d'un autre site refusée", 403


@app.after_request
def _entetes(r):
    r.headers.setdefault("Content-Security-Policy", CSP)
    r.headers["X-Content-Type-Options"] = "nosniff"
    r.headers["X-Frame-Options"] = "DENY"
    r.headers["Referrer-Policy"] = "no-referrer"
    return r


# ── Validation des données reçues ──────────────────────────────────────────────

TYPES = set(MOTS_CLES) | {"autre"}
RE_MOIS = re.compile(r"\d{4}-(0[1-9]|1[0-2])")
RE_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


class Invalide(ValueError):
    """Donnée reçue refusée : réponse 400 avec un message lisible."""


@app.errorhandler(Invalide)
def _invalide(e):
    return jsonify({"ok": False, "erreur": str(e)}), 400


def _corps():
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        raise Invalide("Données illisibles.")
    return d


def _mois(v):
    if not isinstance(v, str) or not RE_MOIS.fullmatch(v):
        raise Invalide("Mois invalide.")
    return v


def _date(v):
    if v in (None, ""):
        return None
    try:
        if isinstance(v, str) and RE_DATE.fullmatch(v):
            datetime.strptime(v, "%Y-%m-%d")
            return v
    except ValueError:
        pass
    raise Invalide("Date invalide.")


def _montant(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise Invalide("Montant invalide.")
    if not math.isfinite(x) or abs(x) > 1e9:
        raise Invalide("Montant invalide.")
    return x


def _texte(v, longueur, requis=True):
    s = str(v if v is not None else "").strip()[:longueur]
    if requis and not s:
        raise Invalide("Nom manquant.")
    return s


def _lire_depense(d):
    if d.get("categorie") not in ("fixe", "variable"):
        raise Invalide("Catégorie invalide.")
    remb = d.get("a_rembourser") or 0
    if remb not in (0, 1, 2):
        raise Invalide("Statut de remboursement invalide.")
    v = {"mois": _mois(d.get("mois")), "categorie": d["categorie"], "element": _texte(d.get("element"), 200),
         "date_echeance": _date(d.get("date_echeance")), "montant": _montant(d.get("montant")),
         "a_rembourser": remb, "type_depense": d.get("type_depense") if d.get("type_depense") in TYPES else "autre",
         "personne": _texte(d.get("personne"), 60, requis=False)}
    v["personne"] = _personne(v)
    return v


def _lire_revenu(d):
    return {"element": _texte(d.get("element"), 200), "date_revenu": _date(d.get("date_revenu")),
            "montant": _montant(d.get("montant")), "fixe": 1 if d.get("fixe") else 0}

last_ping = time.time()
fermeture = None          # moment où la page a signalé sa fermeture (/bye)

# L'appli s'arrête toute seule quand sa page est fermée.
# - Signal de fermeture reçu : arrêt si aucune page ne se manifeste dans les 90 s
#   (un rechargement envoie un ping tout de suite et annule l'arrêt).
# - Sans signal (plantage du navigateur) : arrêt après 6 h sans ping.
#   Les onglets en arrière-plan pingent rarement (≈ 1/min sur Opera, Chrome, Edge,
#   parfois plus du tout sur Safari) : un délai court arrêtait l'appli page encore ouverte.
DELAI_APRES_FERMETURE = 90
DELAI_SANS_PING = 6 * 60 * 60


def doit_s_arreter(maintenant):
    if fermeture and last_ping < fermeture and maintenant - fermeture > DELAI_APRES_FERMETURE:
        return True
    return maintenant - last_ping > DELAI_SANS_PING


def watchdog():
    while True:
        time.sleep(3)
        if doit_s_arreter(time.time()):
            os._exit(0)

threading.Thread(target=watchdog, daemon=True).start()


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(e=None):
    db = g.pop("db", None)
    if db:
        db.close()


SAUVEGARDES = 30   # nombre de copies quotidiennes gardées
# Pas 5000 : sur macOS 12+, ce port est pris par le récepteur AirPlay.
PORT = 5757


def sauvegarde_quotidienne():
    """Copie la base une fois par jour dans sauvegardes/ (avant toute migration)."""
    if not os.path.exists(DB_PATH):
        return
    dossier = os.path.join(os.path.dirname(DB_PATH), "sauvegardes")
    os.makedirs(dossier, exist_ok=True)
    cible = os.path.join(dossier, f"comptes_{date.today().isoformat()}.db")
    if not os.path.exists(cible):
        src, dst = sqlite3.connect(DB_PATH), sqlite3.connect(cible)
        with dst:
            src.backup(dst)
        src.close(); dst.close()
    for vieux in sorted(glob.glob(os.path.join(dossier, "comptes_*.db")))[:-SAUVEGARDES]:
        os.remove(vieux)


def init_db():
    sauvegarde_quotidienne()
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS depenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mois TEXT NOT NULL,
            categorie TEXT NOT NULL,
            element TEXT NOT NULL,
            date_echeance TEXT,
            montant REAL NOT NULL,
            a_rembourser INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS revenus (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mois TEXT NOT NULL,
            element TEXT NOT NULL,
            date_revenu TEXT,
            montant REAL NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS avoirs (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            solde_saisi REAL NOT NULL,
            net_ref REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS budgets (
            type TEXT PRIMARY KEY,
            montant REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reglages (
            cle TEXT PRIMARY KEY,
            valeur TEXT
        );
    """)
    # Migrations
    cols = [r[1] for r in db.execute("PRAGMA table_info(depenses)").fetchall()]
    if "type_depense" not in cols:
        db.execute("ALTER TABLE depenses ADD COLUMN type_depense TEXT DEFAULT 'autre'")
    if "personne" not in cols:
        db.execute("ALTER TABLE depenses ADD COLUMN personne TEXT")
    cols_rev = [r[1] for r in db.execute("PRAGMA table_info(revenus)").fetchall()]
    if "fixe" not in cols_rev:
        db.execute("ALTER TABLE revenus ADD COLUMN fixe INTEGER DEFAULT 0")
    db.execute("UPDATE depenses SET a_rembourser = 0 WHERE a_rembourser IS NULL")
    db.execute("UPDATE depenses SET type_depense = 'autre' WHERE type_depense IS NULL")
    db.commit()
    _auto_create_current_month(db)
    db.close()


def _auto_create_current_month(db):
    """Crée le mois en cours s'il n'existe pas, en copiant les charges fixes du mois précédent."""
    _copier_revenus_fixes(db)
    mois_actuel = date.today().strftime("%Y-%m")
    exists = db.execute("SELECT 1 FROM depenses WHERE mois=? LIMIT 1", (mois_actuel,)).fetchone()
    if exists:
        return

    # Trouver le mois précédent qui a des données
    precedent = db.execute(
        "SELECT mois FROM depenses WHERE mois<? ORDER BY mois DESC LIMIT 1", (mois_actuel,)
    ).fetchone()
    if not precedent:
        return

    fixes = db.execute(
        "SELECT element, montant FROM depenses WHERE mois=? AND categorie='fixe'",
        (precedent[0],)
    ).fetchall()

    for f in fixes:
        db.execute(
            "INSERT INTO depenses (mois, categorie, element, date_echeance, montant, a_rembourser) VALUES (?,?,?,?,?,?)",
            (mois_actuel, "fixe", f[0], None, f[1], 0)
        )
    db.commit()


def _copier_revenus_fixes(db):
    """Le mois en cours reprend les revenus fixes (salaire…) du dernier mois saisi.
    Une seule fois par mois : un revenu fixe supprimé ce mois-ci ne revient pas."""
    mois_actuel = date.today().strftime("%Y-%m")
    deja = db.execute("SELECT valeur FROM reglages WHERE cle='revenus_fixes_mois'").fetchone()
    if deja and deja[0] == mois_actuel:
        return
    prec = db.execute("SELECT MAX(mois) FROM revenus WHERE mois<?", (mois_actuel,)).fetchone()[0]
    if prec and not db.execute("SELECT 1 FROM revenus WHERE mois=? AND fixe=1", (mois_actuel,)).fetchone():
        db.execute("INSERT INTO revenus (mois, element, montant, fixe) "
                   "SELECT ?, element, montant, 1 FROM revenus WHERE mois=? AND fixe=1", (mois_actuel, prec))
    _regler(db, "revenus_fixes_mois", mois_actuel)


# ── Pages ──────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    # Version = date de modification des fichiers : le navigateur recharge le CSS/JS
    # dès qu'ils changent, au lieu de garder une ancienne copie en cache.
    static = os.path.join(os.path.dirname(__file__), "static")
    version = int(max(os.path.getmtime(os.path.join(static, f)) for f in ("css/style.css", "js/app.js")))
    return render_template("index.html", version=version, mode_local=False)

@app.route("/ping", methods=["POST"])
def ping():
    global last_ping
    last_ping = time.time()
    return "", 204


@app.route("/bye", methods=["POST"])
def bye():
    global fermeture
    fermeture = time.time()
    return "", 204


# ── API dépenses ───────────────────────────────────────────────────────────────

@app.route("/api/depenses/<mois>")
def get_depenses(mois):
    db = get_db()
    rows = db.execute(
        "SELECT * FROM depenses WHERE mois=? ORDER BY categorie, date_echeance", (mois,)
    ).fetchall()
    return jsonify([dict(r) for r in rows])


def _personne(d):
    """Nom de la personne qui doit rembourser, seulement si la dépense est à rembourser."""
    p = (d.get("personne") or "").strip()
    return p[:1].upper() + p[1:] if p and int(d.get("a_rembourser", 0)) else None


@app.route("/api/depenses", methods=["POST"])
def add_depense():
    v = _lire_depense(_corps())
    db = get_db()
    db.execute(
        "INSERT INTO depenses (mois, categorie, element, date_echeance, montant, a_rembourser, type_depense, personne) VALUES (?,?,?,?,?,?,?,?)",
        (v["mois"], v["categorie"], v["element"], v["date_echeance"], v["montant"], v["a_rembourser"], v["type_depense"], v["personne"])
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/depenses/recherche")
def recherche_depenses():
    """Recherche sur tous les mois : texte (nom ou personne), type."""
    q, typ = request.args.get("q", "").strip(), request.args.get("type", "")
    sql, params = "SELECT * FROM depenses WHERE 1=1", []
    if q:
        sql += " AND (element LIKE ? OR personne LIKE ?)"
        params += [f"%{q}%", f"%{q}%"]
    if typ:
        sql += " AND type_depense = ?"
        params.append(typ)
    rows = get_db().execute(sql + " ORDER BY mois DESC, date_echeance DESC LIMIT 500", params).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/personnes")
def get_personnes():
    rows = get_db().execute(
        "SELECT DISTINCT personne FROM depenses WHERE personne IS NOT NULL AND personne != '' ORDER BY personne COLLATE NOCASE"
    ).fetchall()
    return jsonify([r[0] for r in rows])



@app.route("/api/remboursements")
def get_remboursements():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM depenses WHERE a_rembourser>=1 ORDER BY a_rembourser ASC, mois DESC, date_echeance DESC"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/depenses/<int:dep_id>/toggle-rembourse", methods=["POST"])
def toggle_rembourse(dep_id):
    db = get_db()
    # On marque comme remboursé en mettant a_rembourser à 2 (remboursé) ou 1 (en attente)
    cur = db.execute("SELECT a_rembourser FROM depenses WHERE id=?", (dep_id,)).fetchone()
    if cur is None:
        return jsonify({"ok": False, "erreur": "Dépense introuvable."}), 404
    nouveau = 2 if cur[0] == 1 else 1
    db.execute("UPDATE depenses SET a_rembourser=? WHERE id=?", (nouveau, dep_id))
    db.commit()
    return jsonify({"ok": True, "rembourse": nouveau == 2})


@app.route("/api/depenses/<int:dep_id>", methods=["DELETE"])
def delete_depense(dep_id):
    db = get_db()
    row = db.execute("SELECT * FROM depenses WHERE id=?", (dep_id,)).fetchone()
    db.execute("DELETE FROM depenses WHERE id=?", (dep_id,))
    db.commit()
    # La ligne supprimée est renvoyée pour permettre « Annuler »
    return jsonify({"ok": True, "supprime": dict(row) if row else None})


@app.route("/api/depenses/<int:dep_id>", methods=["PUT"])
def update_depense(dep_id):
    d = _corps()
    v = _lire_depense(dict(d, mois=d.get("mois") or "2000-01"))       # le mois ne change pas en modification
    db = get_db()
    db.execute(
        "UPDATE depenses SET element=?, date_echeance=?, montant=?, categorie=?, a_rembourser=?, type_depense=?, personne=? WHERE id=?",
        (v["element"], v["date_echeance"], v["montant"], v["categorie"], v["a_rembourser"], v["type_depense"], v["personne"], dep_id)
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/suggestions")
def get_suggestions():
    db = get_db()
    rows = db.execute("SELECT DISTINCT element FROM depenses ORDER BY element COLLATE NOCASE").fetchall()
    return jsonify([r[0] for r in rows])


# ── API revenus ────────────────────────────────────────────────────────────────

@app.route("/api/revenus/<mois>")
def get_revenus(mois):
    db = get_db()
    rows = db.execute("SELECT * FROM revenus WHERE mois=? ORDER BY date_revenu", (mois,)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/revenus", methods=["POST"])
def add_revenu():
    d = _corps()
    v = _lire_revenu(d)
    db = get_db()
    db.execute(
        "INSERT INTO revenus (mois, element, date_revenu, montant, fixe) VALUES (?,?,?,?,?)",
        (_mois(d.get("mois")), v["element"], v["date_revenu"], v["montant"], v["fixe"])
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/revenus/<int:rev_id>", methods=["PUT"])
def update_revenu(rev_id):
    v = _lire_revenu(_corps())
    db = get_db()
    db.execute(
        "UPDATE revenus SET element=?, date_revenu=?, montant=?, fixe=? WHERE id=?",
        (v["element"], v["date_revenu"], v["montant"], v["fixe"], rev_id)
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/revenus/<int:rev_id>", methods=["DELETE"])
def delete_revenu(rev_id):
    db = get_db()
    row = db.execute("SELECT * FROM revenus WHERE id=?", (rev_id,)).fetchone()
    db.execute("DELETE FROM revenus WHERE id=?", (rev_id,))
    db.commit()
    return jsonify({"ok": True, "supprime": dict(row) if row else None})


# ── API bilan ──────────────────────────────────────────────────────────────────

@app.route("/api/bilan/<mois>")
def get_bilan(mois):
    db = get_db()
    dep = db.execute("SELECT SUM(montant) FROM depenses WHERE mois=?", (mois,)).fetchone()[0] or 0
    rev = db.execute("SELECT SUM(montant) FROM revenus WHERE mois=?", (mois,)).fetchone()[0] or 0
    fixes = db.execute("SELECT SUM(montant) FROM depenses WHERE mois=? AND categorie='fixe'", (mois,)).fetchone()[0] or 0
    variables = db.execute("SELECT SUM(montant) FROM depenses WHERE mois=? AND categorie='variable'", (mois,)).fetchone()[0] or 0
    remboursements = db.execute("SELECT SUM(montant) FROM depenses WHERE mois=? AND a_rembourser=1", (mois,)).fetchone()[0] or 0
    # a_rembourser=2 = déjà remboursé, on l'exclut du total à récupérer
    return jsonify({
        "total_depenses": dep,
        "total_revenus": rev,
        "bilan": rev - dep,
        "fixes": fixes,
        "variables": variables,
        "remboursements": remboursements,
    })


@app.route("/api/mois")
def get_mois():
    db = get_db()
    _auto_create_current_month(db)
    rows = db.execute("SELECT DISTINCT mois FROM depenses UNION SELECT DISTINCT mois FROM revenus ORDER BY mois").fetchall()
    return jsonify([r[0] for r in rows])


@app.route("/api/stats/mensuel")
def stats_mensuel():
    db = get_db()
    mois_list = db.execute(
        "SELECT DISTINCT mois FROM depenses UNION SELECT DISTINCT mois FROM revenus ORDER BY mois"
    ).fetchall()
    result = []
    for (mois,) in mois_list:
        dep = db.execute("SELECT SUM(montant) FROM depenses WHERE mois=?", (mois,)).fetchone()[0] or 0
        rev = db.execute("SELECT SUM(montant) FROM revenus WHERE mois=?", (mois,)).fetchone()[0] or 0
        remb = db.execute("SELECT SUM(montant) FROM depenses WHERE mois=? AND a_rembourser>=1", (mois,)).fetchone()[0] or 0
        result.append({"mois": mois, "depenses": round(dep, 2), "revenus": round(rev, 2), "remboursements": round(remb, 2)})
    return jsonify(result)


@app.route("/api/stats/categories")
def stats_categories():
    db = get_db()
    rows = db.execute(
        "SELECT type_depense, SUM(montant) as total FROM depenses GROUP BY type_depense ORDER BY total DESC"
    ).fetchall()
    return jsonify([{"type": r[0] or "autre", "total": round(r[1], 2)} for r in rows])


# ── API avoirs ─────────────────────────────────────────────────────────────────
# On mémorise le solde saisi + le "net" (revenus - dépenses + remboursements reçus)
# à ce moment-là. Solde actuel = solde saisi + variation du net depuis la saisie.

def _net(db):
    return db.execute("""
        SELECT (SELECT COALESCE(SUM(montant), 0) FROM revenus)
             - (SELECT COALESCE(SUM(montant), 0) FROM depenses)
             + (SELECT COALESCE(SUM(montant), 0) FROM depenses WHERE a_rembourser=2)
    """).fetchone()[0]


def _solde(db):
    row = db.execute("SELECT solde_saisi, net_ref FROM avoirs WHERE id=1").fetchone()
    return round(row[0] + _net(db) - row[1], 2) if row else None


@app.route("/api/avoirs")
def get_avoirs():
    return jsonify({"solde": _solde(get_db())})


@app.route("/api/avoirs", methods=["PUT"])
def update_avoirs():
    solde = _montant(_corps().get("solde"))
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO avoirs (id, solde_saisi, net_ref) VALUES (1, ?, ?)",
        (solde, _net(db))
    )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/prevision")
def get_prevision():
    """Fin de mois estimée = avoirs - (dépenses variables par jour jusqu'ici x jours restants).
    Les charges fixes sont déjà déduites des avoirs dès le début du mois."""
    db, today = get_db(), date.today()
    mois = today.strftime("%Y-%m")
    variables = db.execute(
        "SELECT COALESCE(SUM(montant), 0) FROM depenses WHERE mois=? AND categorie='variable'", (mois,)
    ).fetchone()[0]
    rythme = variables / today.day
    restants = monthrange(today.year, today.month)[1] - today.day
    attente = db.execute("SELECT COALESCE(SUM(montant), 0) FROM depenses WHERE a_rembourser=1").fetchone()[0]
    solde = _solde(db)
    return jsonify({
        "solde": solde,
        "rythme_jour": round(rythme, 2),
        "jours_restants": restants,
        "fin_de_mois": round(solde - rythme * restants, 2) if solde is not None else None,
        "rembours_attente": round(attente, 2),
    })


# ── Prénom (demandé une seule fois, au premier lancement) ──────────────────────

@app.route("/api/prenom")
def get_prenom():
    """prenom = None : jamais demandé ; "" : l'utilisateur a passé la question."""
    row = get_db().execute("SELECT valeur FROM reglages WHERE cle='prenom'").fetchone()
    return jsonify({"prenom": row[0] if row else None})


@app.route("/api/prenom", methods=["PUT"])
def update_prenom():
    prenom = " ".join(str((request.json or {}).get("prenom", "")).split())[:30]
    db = get_db()
    db.execute("INSERT OR REPLACE INTO reglages (cle, valeur) VALUES ('prenom', ?)", (prenom,))
    db.commit()
    return jsonify({"ok": True, "prenom": prenom})


# ── Notes de version (affichées une fois après une mise à jour) ────────────────

def _notes():
    try:
        with open(os.path.join(os.path.dirname(__file__), "notes_de_version.json"), encoding="utf-8") as f:
            return sorted(json.load(f), key=lambda n: n["id"], reverse=True)
    except (OSError, ValueError, KeyError):
        return []


def _regler(db, cle, valeur):
    db.execute("INSERT OR REPLACE INTO reglages (cle, valeur) VALUES (?, ?)", (cle, valeur))
    db.commit()


@app.route("/api/notes")
def get_notes():
    """nouvelles = notes pas encore vues. Première installation : rien à montrer."""
    db, notes = get_db(), _notes()
    if not notes:
        return jsonify({"nouvelles": [], "toutes": [], "version": None})
    row = db.execute("SELECT valeur FROM reglages WHERE cle='notes_vues'").fetchone()
    if row is None:
        _regler(db, "notes_vues", notes[0]["id"])
        nouvelles = []
    else:
        nouvelles = [n for n in notes if n["id"] > (row[0] or "")]
    return jsonify({"nouvelles": nouvelles, "toutes": notes[:10], "version": notes[0]["id"]})


@app.route("/api/notes/vues", methods=["PUT"])
def notes_vues():
    notes = _notes()
    if notes:
        _regler(get_db(), "notes_vues", notes[0]["id"])
    return jsonify({"ok": True})


# ── API budgets ────────────────────────────────────────────────────────────────

@app.route("/api/budgets")
def get_budgets():
    return jsonify({r[0]: r[1] for r in get_db().execute("SELECT type, montant FROM budgets")})


@app.route("/api/budgets", methods=["PUT"])
def update_budgets():
    """{type: montant} ; un montant vide ou nul retire le budget."""
    db = get_db()
    for typ, montant in _corps().items():
        if typ not in TYPES:
            continue
        if montant in (None, "") or _montant(montant) <= 0:
            db.execute("DELETE FROM budgets WHERE type=?", (typ,))
        else:
            db.execute("INSERT OR REPLACE INTO budgets (type, montant) VALUES (?, ?)", (typ, float(montant)))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/budgets/<mois>")
def get_budgets_mois(mois):
    rows = get_db().execute("""
        SELECT b.type, b.montant,
               (SELECT COALESCE(SUM(d.montant), 0) FROM depenses d WHERE d.mois=? AND d.type_depense=b.type)
        FROM budgets b ORDER BY b.type
    """, (mois,)).fetchall()
    return jsonify([{"type": r[0], "budget": r[1], "depense": round(r[2], 2)} for r in rows])


# ── Dictée ─────────────────────────────────────────────────────────────────────

@app.route("/api/dictee", methods=["POST"])
def post_dictee():
    """Transforme un texte dicté en liste de dépenses à vérifier (rien n'est enregistré ici)."""
    d = _corps()
    mois = d.get("mois") if isinstance(d.get("mois"), str) and RE_MOIS.fullmatch(d["mois"]) else None
    historique = get_db().execute("""
        SELECT element, type_depense FROM depenses
        GROUP BY element, type_depense ORDER BY COUNT(*) DESC
    """).fetchall()
    return jsonify(analyser(str(d.get("texte") or "")[:20000], mois, [tuple(r) for r in historique]))


# ── Export pour Excel ──────────────────────────────────────────────────────────

@app.route("/api/export/csv")
def export_csv():
    """Toutes les dépenses et tous les revenus, au format CSV français (s'ouvre dans Excel)."""
    db = get_db()
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["Sens", "Mois", "Date", "Élément", "Catégorie", "Type", "Montant", "À rembourser", "Personne"])
    statut = {0: "", 1: "En attente", 2: "Remboursé"}
    euro = lambda n: f"{n:.2f}".replace(".", ",")
    # Une cellule qui commence par = + - @ serait exécutée comme une formule par Excel
    texte = lambda s: "'" + s if s and s[0] in "=+-@\t\r" else (s or "")
    for r in db.execute("SELECT * FROM depenses ORDER BY mois, date_echeance"):
        w.writerow(["Dépense", r["mois"], r["date_echeance"] or "", texte(r["element"]), r["categorie"],
                    r["type_depense"] or "", euro(r["montant"]), statut.get(r["a_rembourser"], ""), texte(r["personne"])])
    for r in db.execute("SELECT * FROM revenus ORDER BY mois, date_revenu"):
        w.writerow(["Revenu", r["mois"], r["date_revenu"] or "", texte(r["element"]), "", "", euro(r["montant"]), "", ""])
    return Response("﻿" + buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=mes_comptes_{date.today().isoformat()}.csv"})


# ── Export PDF ────────────────────────────────────────────────────────────────

@app.route("/api/export/pdf/<mois>")
def export_pdf(mois):
    _mois(mois)
    db  = get_db()
    dep = db.execute("SELECT * FROM depenses WHERE mois=? ORDER BY categorie, date_echeance", (mois,)).fetchall()
    rev = db.execute("SELECT * FROM revenus WHERE mois=? ORDER BY date_revenu", (mois,)).fetchall()

    # Calculs
    total_fixes    = sum(d["montant"] for d in dep if d["categorie"] == "fixe")
    total_variables = sum(d["montant"] for d in dep if d["categorie"] == "variable")
    total_dep      = total_fixes + total_variables
    total_rev      = sum(r["montant"] for r in rev)
    bilan          = total_rev - total_dep

    # Label mois
    y, m = mois.split("-")
    from datetime import date as dt
    mois_label = dt(int(y), int(m), 1).strftime("%B %Y").capitalize()

    def fmt(n):
        return f"{n:,.2f} €".replace(",", " ")

    def fmt_date(s):
        if not s: return "-"
        parts = s.split("-")
        return f"{parts[2]}/{parts[1]}/{parts[0]}"

    pdf = FPDF()
    font_r, font_b = _find_arial()
    if font_r:
        pdf.add_font("Arial", "",  font_r, uni=True)
        pdf.add_font("Arial", "B", font_b, uni=True)
        FONT = "Arial"
    else:
        FONT = "Helvetica"
    pdf.add_page()
    pdf.set_margins(15, 15, 15)

    # ── En-tête
    pdf.set_fill_color(12, 13, 18)
    pdf.rect(0, 0, 210, 30, "F")
    pdf.set_text_color(232, 184, 109)
    pdf.set_font(FONT, "B", 16)
    pdf.set_xy(15, 8)
    pdf.cell(0, 10, f"Mes Comptes - {mois_label}", ln=True)
    pdf.set_text_color(152, 150, 160)
    pdf.set_font(FONT, "", 9)
    pdf.set_x(15)
    pdf.cell(0, 6, f"Exporte le {datetime.now().strftime('%d/%m/%Y a %H:%M')}", ln=True)

    pdf.set_text_color(30, 30, 30)
    pdf.ln(8)

    # ── Cartes bilan
    def bilan_card(x, y, label, value, color):
        pdf.set_fill_color(*color)
        pdf.set_xy(x, y)
        pdf.cell(55, 18, "", border=0, fill=True)
        pdf.set_xy(x + 3, y + 3)
        pdf.set_font(FONT, "", 7)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(49, 4, label.upper(), ln=True)
        pdf.set_xy(x + 3, y + 8)
        pdf.set_font(FONT, "B", 11)
        pdf.set_text_color(30, 30, 30)
        pdf.cell(49, 7, value)

    bilan_card(15,  38, "Depenses totales", fmt(total_dep),  (255, 220, 220))
    bilan_card(75,  38, "Revenus",          fmt(total_rev),  (220, 245, 230))
    bilan_card(135, 38, "Bilan du mois",    fmt(bilan),      (220, 235, 255) if bilan >= 0 else (255, 220, 220))

    pdf.set_xy(15, 62)
    bilan_card(15,  62, "Charges fixes",    fmt(total_fixes),    (240, 240, 255))
    bilan_card(75,  62, "Variables",        fmt(total_variables),(255, 245, 220))

    pdf.ln(48)

    # ── Fonction tableau
    def draw_table(title, rows, cols, col_widths, col_keys):
        pdf.set_font(FONT, "B", 10)
        pdf.set_text_color(30, 30, 30)
        pdf.cell(0, 8, title, ln=True)

        # Header
        pdf.set_fill_color(230, 230, 240)
        pdf.set_font(FONT, "B", 8)
        pdf.set_text_color(80, 80, 100)
        for col, w in zip(cols, col_widths):
            pdf.cell(w, 7, col, border=0, fill=True, align="L")
        pdf.ln()

        # Lignes
        pdf.set_font(FONT, "", 8)
        for i, row in enumerate(rows):
            pdf.set_fill_color(252, 252, 252) if i % 2 == 0 else pdf.set_fill_color(245, 245, 248)
            pdf.set_text_color(40, 40, 40)
            for key, w in zip(col_keys, col_widths):
                val = row[key] if row[key] else "-"
                if key == "montant":
                    val = fmt(row[key])
                    pdf.set_font(FONT, "B", 8)
                    pdf.cell(w, 6, val, fill=True, align="L")
                    pdf.set_font(FONT, "", 8)
                elif key in ("date_echeance", "date_revenu"):
                    pdf.cell(w, 6, fmt_date(row[key]), fill=True)
                elif key == "a_rembourser":
                    pdf.cell(w, 6, "Oui" if row[key] else "", fill=True)
                else:
                    txt = str(row[key] or "")
                    pdf.cell(w, 6, txt[:35], fill=True)
            pdf.ln()

        # Ligne total
        pdf.set_fill_color(210, 210, 230)
        pdf.set_font(FONT, "B", 8)
        pdf.set_text_color(30, 30, 80)
        total = sum(r["montant"] for r in rows)
        pdf.cell(sum(col_widths[:-1]), 7, "TOTAL", fill=True, align="R")
        pdf.cell(col_widths[-1], 7, fmt(total), fill=True)
        pdf.ln(10)

    # ── Charges fixes
    fixes = [d for d in dep if d["categorie"] == "fixe"]
    if fixes:
        draw_table(
            "Charges fixes",
            fixes,
            ["Élément", "Échéance", "Montant"],
            [110, 40, 30],
            ["element", "date_echeance", "montant"]
        )

    # ── Dépenses variables
    variables = [d for d in dep if d["categorie"] == "variable"]
    if variables:
        draw_table(
            "Dépenses variables",
            variables,
            ["Élément", "Date", "Remboursement", "Montant"],
            [90, 35, 30, 25],
            ["element", "date_echeance", "a_rembourser", "montant"]
        )

    # ── Revenus
    if rev:
        draw_table(
            "Revenus",
            rev,
            ["Élément", "Date", "Montant"],
            [110, 40, 30],
            ["element", "date_revenu", "montant"]
        )

    buf = io.BytesIO(pdf.output())
    buf.seek(0)
    filename = f"comptes_{mois}.pdf"
    return send_file(buf, mimetype="application/pdf",
                     as_attachment=True, download_name=filename)


@app.route("/api/export/pdf/remboursements")
@app.route("/api/export/pdf/remboursements/<mois_filtre>")
def export_pdf_remboursements(mois_filtre=None):
    if mois_filtre:
        _mois(mois_filtre)
    db  = get_db()
    personne = request.args.get("personne") or None
    sql, params = "SELECT * FROM depenses WHERE a_rembourser >= 1", []
    if mois_filtre:
        sql += " AND mois=?"; params.append(mois_filtre)
    if personne:
        sql += " AND personne=?"; params.append(personne)
    rows = db.execute(sql + " ORDER BY a_rembourser ASC, mois DESC, date_echeance DESC", params).fetchall()

    total_attente  = sum(r["montant"] for r in rows if r["a_rembourser"] == 1)
    total_recu     = sum(r["montant"] for r in rows if r["a_rembourser"] == 2)
    total_global   = total_attente + total_recu

    def fmt(n):
        return f"{n:,.2f} EUR".replace(",", " ")

    def fmt_date(s):
        if not s: return "-"
        parts = s.split("-")
        return f"{parts[2]}/{parts[1]}/{parts[0]}"

    def mois_label(m):
        y, mo = m.split("-")
        from datetime import date as dt
        return dt(int(y), int(mo), 1).strftime("%B %Y").capitalize()

    pdf = FPDF()
    font_r, font_b = _find_arial()
    if font_r:
        pdf.add_font("Arial", "",  font_r, uni=True)
        pdf.add_font("Arial", "B", font_b, uni=True)
        FONT = "Arial"
    else:
        FONT = "Helvetica"
    pdf.add_page()
    pdf.set_margins(15, 15, 15)

    # ── En-tête
    pdf.set_fill_color(12, 13, 18)
    pdf.rect(0, 0, 210, 30, "F")
    titre = f"Remboursements — {mois_label(mois_filtre)}" if mois_filtre else "Remboursements — Tous les mois"
    if personne:
        titre += f" — {personne}"
    pdf.set_text_color(232, 184, 109)
    pdf.set_font(FONT, "B", 16)
    pdf.set_xy(15, 8)
    pdf.cell(0, 10, f"Mes Comptes - {titre}", ln=True)
    pdf.set_text_color(152, 150, 160)
    pdf.set_font(FONT, "", 9)
    pdf.set_x(15)
    pdf.cell(0, 6, f"Exporte le {datetime.now().strftime('%d/%m/%Y a %H:%M')}", ln=True)
    pdf.ln(8)

    # ── Cartes récap
    def summary_card(x, y, label, value, color):
        pdf.set_fill_color(*color)
        pdf.set_xy(x, y)
        pdf.cell(55, 18, "", border=0, fill=True)
        pdf.set_xy(x + 3, y + 3)
        pdf.set_font(FONT, "", 7)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(49, 4, label.upper(), ln=True)
        pdf.set_xy(x + 3, y + 8)
        pdf.set_font(FONT, "B", 11)
        pdf.set_text_color(30, 30, 30)
        pdf.cell(49, 7, value)

    summary_card(15,  38, "En attente",     fmt(total_attente), (255, 245, 210))
    summary_card(75,  38, "Deja rembourse", fmt(total_recu),    (220, 245, 230))
    summary_card(135, 38, "Total avance",   fmt(total_global),  (230, 230, 245))
    pdf.ln(30)

    # ── Tableaux par mois
    from collections import OrderedDict
    par_mois = OrderedDict()
    for r in rows:
        if r["mois"] not in par_mois:
            par_mois[r["mois"]] = []
        par_mois[r["mois"]].append(r)

    pdf.set_text_color(30, 30, 30)

    for mois, items in par_mois.items():
        total_mois = sum(r["montant"] for r in items)
        attente_mois = sum(r["montant"] for r in items if r["a_rembourser"] == 1)

        # Titre du mois
        pdf.set_font(FONT, "B", 10)
        pdf.set_fill_color(230, 230, 245)
        pdf.set_text_color(30, 30, 80)
        pdf.cell(0, 8, f"  {mois_label(mois)}   —   Total : {fmt(total_mois)}   |   En attente : {fmt(attente_mois)}", fill=True, ln=True)
        pdf.ln(1)

        # En-tête tableau
        pdf.set_fill_color(242, 242, 248)
        pdf.set_font(FONT, "B", 8)
        pdf.set_text_color(80, 80, 100)
        pdf.cell(90, 6, "Element",   fill=True)
        pdf.cell(30, 6, "Date",      fill=True)
        pdf.cell(30, 6, "Montant",   fill=True)
        pdf.cell(30, 6, "Statut",    fill=True)
        pdf.ln()

        # Lignes
        pdf.set_font(FONT, "", 8)
        for i, r in enumerate(items):
            statut   = "Rembourse" if r["a_rembourser"] == 2 else "En attente"
            is_remb  = r["a_rembourser"] == 2
            pdf.set_fill_color(248, 248, 248) if i % 2 == 0 else pdf.set_fill_color(242, 242, 245)
            pdf.set_text_color(120, 120, 120) if is_remb else pdf.set_text_color(40, 40, 40)
            pdf.cell(90, 6, str(r["element"] or "")[:40], fill=True)
            pdf.cell(30, 6, fmt_date(r["date_echeance"]),  fill=True)
            pdf.set_font(FONT, "B", 8)
            pdf.cell(30, 6, fmt(r["montant"]),             fill=True)
            pdf.set_font(FONT, "", 8)
            pdf.set_text_color(100, 150, 100) if is_remb else pdf.set_text_color(180, 120, 40)
            pdf.cell(30, 6, statut, fill=True)
            pdf.ln()

        # Ligne total mois
        pdf.set_fill_color(210, 210, 235)
        pdf.set_font(FONT, "B", 8)
        pdf.set_text_color(30, 30, 80)
        pdf.cell(120, 6, "TOTAL DU MOIS", fill=True, align="R")
        pdf.cell(30,  6, fmt(total_mois),    fill=True)
        pdf.cell(30,  6, "",                fill=True)
        pdf.ln(8)

    filename = f"remboursements_{mois_filtre or 'tous'}{'_' + personne if personne else ''}.pdf"
    buf = io.BytesIO(pdf.output())
    buf.seek(0)
    return send_file(buf, mimetype="application/pdf",
                     as_attachment=True, download_name=filename)


def ouvrir_navigateur(url):
    """Windows : Edge si installé (la dictée vocale y fonctionne), sinon le navigateur par défaut.
    Mac / Linux : navigateur par défaut (Safari sur Mac)."""
    import webbrowser
    if platform.system() == "Windows":
        for base in (os.environ.get("ProgramFiles(x86)", ""), os.environ.get("ProgramFiles", ""),
                     os.environ.get("LOCALAPPDATA", "")):
            edge = os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe")
            if base and os.path.exists(edge):
                webbrowser.BackgroundBrowser(edge).open(url)
                return
    webbrowser.open(url)


def deja_lancee():
    """Vrai si l'appli tourne déjà (Windows laisserait démarrer un second serveur sur le même port)."""
    import socket
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


if __name__ == "__main__":
    # Déjà ouverte : rouvrir la fenêtre, sans mise à jour ni second serveur
    if deja_lancee():
        ouvrir_navigateur(f"http://127.0.0.1:{PORT}")
        raise SystemExit
    # Mise à jour depuis GitHub avant de démarrer (jamais pendant que l'appli tourne)
    if mise_a_jour.appliquer():
        mise_a_jour.relancer()
    init_db()
    threading.Timer(1, lambda: ouvrir_navigateur(f"http://127.0.0.1:{PORT}")).start()
    app.run(port=PORT, debug=False)
