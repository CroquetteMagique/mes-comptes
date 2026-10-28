"""Analyse d'une dictée de dépenses en français, sans service externe.

Exemple : « 4 septembre, Carrefour, 45,20 euros. Le 6, machine à laver, trois euros. »
donne deux dépenses avec date, élément, montant et type devinés.

Principe :
  1. découpage du texte en mots, nombres, mois, « euros » et séparateurs ;
     les nombres écrits en lettres (« soixante dix ») deviennent des chiffres ;
  2. repérage des morceaux utiles : dates, montants, « à rembourser (par X) »,
     remarques (« ça c'est la cantine ») ; le reste est du texte ;
  3. chaque montant est une dépense ; les morceaux situés entre deux montants
     sont rattachés à la dépense d'avant ou à celle d'après :
       - un nom ou une remarque dits juste après un prix complètent cette dépense
         (« 1,40 € de café », « 42 €, Julie doit me rembourser ») ;
       - une date va à la dépense qui la suit (« 4 septembre, Carrefour, 30 € »),
         sauf si la personne dit ses dates après le prix (« SNCF 19 € le 24 septembre »)
         ou si la date termine la phrase ;
       - une dépense sans date reprend celle de la dépense précédente ;
  4. le type est deviné via l'historique des dépenses, sinon via des mots-clés.

ponytail: analyse par règles, pas d'IA. Une phrase très libre peut demander une
correction dans la liste de vérification affichée avant l'enregistrement.
"""
import re
import unicodedata
from datetime import date, timedelta
from difflib import get_close_matches

MOIS = {
    "janvier": 1, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7,
    "aout": 8, "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12,
    # abréviations écrites (« sept » est traité à part : c'est aussi le chiffre 7)
    "janv": 1, "fev": 2, "fevr": 2, "avr": 4, "juil": 7, "oct": 10, "nov": 11, "dec": 12,
}
_NOMS_MOIS = r"janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre"
UNITES = {
    "zero": 0, "un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4, "cinq": 5, "six": 6,
    "sept": 7, "huit": 8, "neuf": 9, "dix": 10, "onze": 11, "douze": 12, "treize": 13,
    "quatorze": 14, "quinze": 15, "seize": 16,
}
DIZAINES = {"vingt": 20, "vingts": 20, "trente": 30, "quarante": 40, "cinquante": 50, "soixante": 60}
SIGLES = {"sncf", "ratp", "edf", "kfc", "sfr", "tgv", "ter", "rer", "caf", "h&m"}
EUROS = {"euro", "euros", "eur", "€", "balles"}
CENTIMES = {"centime", "centimes"}
FIN_DE_PHRASE = {".", "!", "?", ";", ":"}
# Mots sans intérêt, retirés partout dans un nom
BRUIT = {"euh", "heu", "hum", "bah", "ben", "bon", "alors", "voila", "ok", "rien", "puis", "ensuite",
         "aussi", "et", "enfin"}
# Mots retirés au début ou à la fin d'un nom (« j'ai payé ... chez Carrefour » -> « Carrefour »)
BORDS = {"de", "d'", "du", "des", "le", "la", "les", "l'", "un", "une", "a", "au", "aux", "pour", "donc",
         "ca", "en", "dans", "sur", "chez", "c'est", "tout", "j'", "j'ai", "ai", "on", "il", "elle",
         "paye", "payer", "depense", "depenses", "achete", "acheter", "pris", "mis", "fait", "coute",
         "me", "m'", "moi", "suis", "y", "avec", "par",
         "recu", "touche", "percu", "gagne", "ma", "mon", "mes"}

MOTS_CLES = {
    "nourriture": ["intermarche", "carrefour", "lidl", "leclerc", "auchan", "aldi", "monoprix", "franprix",
                   "tesco", "courses", "supermarche", "boulangerie", "cantine", "cafe", "epicerie", "marche",
                   "pain", "picard", "biocoop"],
    "restaurant": ["resto", "restaurant", "mcdo", "mcdonald", "burger", "pizza", "kebab", "wolt",
                   "uber eats", "deliveroo", "sushi", "brasserie", "kfc", "tacos", "crous"],
    "transport": ["sncf", "train", "bus", "metro", "ratp", "taxi", "uber", "bolt", "essence", "blablacar",
                  "ouigo", "tram", "navigo", "peage", "parking", "velo", "trottinette", "carburant"],
    "abonnement": ["abonnement", "netflix", "spotify", "claude", "anthropic", "deezer", "forfait",
                   "disney", "amazon prime", "icloud", "chatgpt", "youtube"],
    "logement": ["loyer", "edf", "electricite", "gaz", "internet", "box", "laverie", "machine a laver", "caution"],
    "sante": ["pharmacie", "medecin", "docteur", "dentiste", "mutuelle", "osteo", "kine", "lunettes"],
    "vetements": ["vetement", "vetements", "zara", "h&m", "chaussures", "uniqlo", "primark", "pull", "jean"],
    "sport": ["sport", "salle", "basic fit", "piscine", "foot", "tennis", "escalade", "fitness"],
    "soiree": ["bar", "soiree", "biere", "boite", "club", "verre", "apero"],
    "cadeaux": ["cadeau", "anniversaire", "fleurs"],
    "culture": ["cinema", "cine", "musee", "concert", "theatre", "livre", "expo", "spectacle", "pop corn"],
    "jeux": ["jeu", "jeux", "steam", "playstation", "xbox", "nintendo"],
    "etudes": ["fournitures", "inscription", "universite", "fac", "cours", "photocopies", "ecole"],
    "voyage": ["avion", "hotel", "airbnb", "ryanair", "easyjet", "vol", "auberge", "valise"],
}


def sans_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _cle(s):
    return sans_accents(s).lower().strip()


def deviner_type(texte):
    k = " " + _cle(texte) + " "
    for typ, mots in MOTS_CLES.items():
        for m in mots:
            if re.search(r"(?<![a-z])" + re.escape(m) + r"(?![a-z])", k):
                return typ
    return None


# ── 1. Découpage ──────────────────────────────────────────────────────────────

# Un mot mêlant lettres et chiffres (« e2e », « 4G », « Fnac2 ») reste un mot, pas un prix.
_TOKEN = re.compile(r"\d{1,2}/\d{1,2}(?:/\d{2,4})?"
                    r"|(?:[A-Za-zÀ-ÿ]+\d|\d+(?!euros?\b|eur\b|e\b)[A-Za-zÀ-ÿ])[A-Za-zÀ-ÿ\d]*"
                    r"|\d+(?:[.,]\d+)?|€|[A-Za-zÀ-ÿ&]+'?|[.;:!?,]")


def _normaliser(texte):
    t = texte.replace("’", "'").replace("-", " ")
    t = re.sub(r"(?i)aujourd\s*'?\s*hui", " aujourdhui ", t)
    t = re.sub(r"(?i)avant\s+hier", " avanthier ", t)
    t = re.sub(r"(?i)\b1\s?(?:er|re|ère)\b", "1", t)                                   # « 1er octobre »
    t = re.sub(r"(?i)\bpremi(?:er|ère|ere)\b(?=\s+(?:" + _NOMS_MOIS + r"))", "1", t)   # « premier octobre »
    return t


def _decouper(texte):
    out = []
    for m in _TOKEN.finditer(_normaliser(texte)):
        brut = m.group()
        cle = _cle(brut)
        if brut in ".;:!?,":
            out.append({"t": "SEP", "brut": brut})
        elif "/" in brut:
            out.append({"t": "JJMM", "brut": brut})
        elif re.fullmatch(r"\d+(?:[.,]\d+)?", brut):
            out.append({"t": "NUM", "val": float(brut.replace(",", ".")), "brut": brut,
                        "dec": "," in brut or "." in brut, "chiffres": True})
        elif cle in MOIS:
            out.append({"t": "MOIS", "val": MOIS[cle], "brut": brut})
        elif cle in EUROS:
            out.append({"t": "EUR", "brut": brut})
        else:
            out.append({"t": "MOT", "brut": brut, "cle": cle})
    return _nombres_en_lettres(out)


# ── Nombres en lettres -> chiffres ────────────────────────────────────────────

def _est_nombre(tok):
    return tok["t"] == "MOT" and (tok["cle"] in UNITES or tok["cle"] in DIZAINES or tok["cle"] in ("cent", "cents", "mille"))


def _nombres_en_lettres(toks):
    out, i = [], 0
    while i < len(toks):
        tok = toks[i]
        if not _est_nombre(tok):
            out.append(tok); i += 1
            continue
        # « un » / « une » seuls sont des articles, sauf devant un autre nombre ou « euros »
        if tok["cle"] in ("un", "une"):
            nxt = toks[i + 1] if i + 1 < len(toks) else None
            if not nxt or not (nxt["t"] == "EUR" or _est_nombre(nxt)):
                out.append(tok); i += 1
                continue
        total, cur, mots, j = 0, 0, [], i
        while j < len(toks):
            t = toks[j]
            c = t.get("cle", "")
            # « vingt et un », « soixante et onze »
            if c == "et" and cur and j + 1 < len(toks) and toks[j + 1].get("cle") in ("un", "une", "onze"):
                mots.append(t["brut"]); j += 1
                continue
            if not _est_nombre(t):
                break
            if c in DIZAINES:
                if c.startswith("vingt") and cur % 100 == 4:      # quatre-vingt
                    cur += 76
                elif cur % 100 == 0:
                    cur += DIZAINES[c]
                else:
                    break                                         # « vingt et un soixante » = 21 puis 60
            elif c in ("cent", "cents"):
                if cur >= 10:
                    break
                cur = (cur or 1) * 100
            elif c == "mille":
                total += (cur or 1) * 1000
                cur = 0
            else:
                v = UNITES[c]
                if v >= 10 and cur % 100 not in (0, 60, 80):
                    break
                if v < 10 and cur % 10 != 0:
                    break
                cur += v
            mots.append(t["brut"]); j += 1
        out.append({"t": "NUM", "val": float(total + cur), "brut": " ".join(mots), "dec": False, "chiffres": False})
        i = j
    return out


# ── Dates ─────────────────────────────────────────────────────────────────────

def _annee_pour(mois, jour, aujourdhui):
    """Année la plus récente qui ne place pas la date dans le futur."""
    a = aujourdhui.year
    try:
        if date(a, mois, jour) > aujourdhui + timedelta(days=1):
            a -= 1
    except ValueError:
        pass
    return a


def _date(jour, mois, annee, aujourdhui):
    try:
        return date(annee or _annee_pour(mois, jour, aujourdhui), mois, jour)
    except ValueError:
        return None


# ── 2. Repérage des morceaux ──────────────────────────────────────────────────

def _morceaux(toks, mois_defaut, aujourdhui):
    """Liste de morceaux : DATE, MONTANT, REMB, NOTE, SEP (fort = fin de phrase) et MOT."""
    n = len(toks)
    tok = lambda k: toks[k] if 0 <= k < n else {"t": "FIN", "brut": "", "cle": ""}
    out = []
    contexte = {"mois": None}      # dernier mois entendu, pour « le 6 »

    def ajouter_date(d, mois=None):
        mois = mois or (d.year, d.month)
        out.append({"k": "DATE", "d": d, "mois": mois})
        contexte["mois"] = mois

    def est_sept_mois(k):
        """« 4 sept » : jour en chiffres suivi de « sept » = septembre, pas 4,07 €."""
        t, s = tok(k), tok(k + 1)
        return (t["t"] == "NUM" and t.get("chiffres") and not t["dec"] and 1 <= t["val"] <= 31
                and s["t"] == "NUM" and _cle(s["brut"]) == "sept")

    def lire_montant(k):
        t = tok(k)
        if t["t"] != "NUM" or tok(k + 1)["t"] == "MOIS" or est_sept_mois(k):
            return None
        val, j = t["val"], k + 1
        if t["dec"]:
            return round(val, 2), j + (tok(j)["t"] == "EUR")
        if tok(j).get("cle") in CENTIMES:
            return round(val / 100, 2), j + 1
        virgule = tok(j).get("cle") == "virgule"
        if virgule or tok(j)["t"] == "EUR":
            j += 1
        c = tok(j)
        # centimes : « 15 euros 10 », « vingt et un soixante », « 19 virgule 20 »
        if (c["t"] == "NUM" and not c["dec"] and c["val"] < 100 and tok(j + 1)["t"] != "MOIS"
                and not est_sept_mois(j)):
            cent = c["val"] * 10 if virgule and c["val"] < 10 and not c["brut"].startswith("0") else c["val"]
            return round(val + cent / 100, 2), j + 1
        return round(val, 2), j

    i = 0
    while i < n:
        t, nxt = tok(i), tok(i + 1)
        c = t.get("cle", "")

        # « 4 septembre [2026] », « 4 sept »
        if t["t"] == "NUM" and not t["dec"] and 1 <= t["val"] <= 31 and (nxt["t"] == "MOIS" or est_sept_mois(i)):
            mois = nxt["val"] if nxt["t"] == "MOIS" else 9
            annee, j = None, i + 2
            if tok(j)["t"] == "NUM" and 2000 <= tok(j)["val"] <= 2100:
                annee, j = int(tok(j)["val"]), j + 1
            d = _date(int(t["val"]), mois, annee, aujourdhui)
            if d:
                if out and out[-1]["k"] == "MOT" and out[-1]["cle"] == "le":
                    out.pop()
                ajouter_date(d)
            i = j
            continue
        if t["t"] == "JJMM":                                       # « 22/09 »
            p = [int(x) for x in t["brut"].split("/")]
            annee = (p[2] + 2000 if p[2] < 100 else p[2]) if len(p) == 3 else None
            d = _date(p[0], p[1], annee, aujourdhui)
            if d:
                if out and out[-1]["k"] == "MOT" and out[-1]["cle"] == "le":
                    out.pop()
                ajouter_date(d)
            i += 1
            continue
        if t["t"] == "MOIS":                                       # mois seul : « de septembre »
            if out and out[-1]["k"] == "MOT" and out[-1]["cle"] in ("de", "d'", "en"):
                out.pop()
            ajouter_date(None, (_annee_pour(t["val"], 1, aujourdhui), t["val"]))
            i += 1
            continue
        if c in ("hier", "avanthier", "aujourdhui"):
            ajouter_date(aujourdhui - timedelta(days={"hier": 1, "avanthier": 2, "aujourdhui": 0}[c]))
            i += 1
            continue
        # « le 6 » (mois déjà entendu, sinon mois affiché)
        if (c == "le" and nxt["t"] == "NUM" and not nxt["dec"] and 1 <= nxt["val"] <= 31
                and tok(i + 2)["t"] in ("MOT", "SEP", "FIN") and tok(i + 2).get("cle") not in CENTIMES):
            if contexte["mois"]:
                a, m = contexte["mois"]
            elif mois_defaut:
                a, m = int(mois_defaut[:4]), int(mois_defaut[5:7])
            else:
                a, m = aujourdhui.year, aujourdhui.month
            d = _date(int(nxt["val"]), m, a, aujourdhui)
            if d:
                ajouter_date(d)
                i += 2
                continue

        # Remarque « (donc) ça c'est la cantine »
        if c in ("c'", "c'est") and (c == "c'est" or nxt.get("cle") == "est"):
            j = i + 1 + (c == "c'")
            note = []
            while tok(j)["t"] == "MOT" and len(note) < 4:
                note.append(tok(j)["brut"]); j += 1
            while out and ((out[-1]["k"] == "MOT" and out[-1]["cle"] in ("ca", "donc", "et"))
                           or (out[-1]["k"] == "SEP" and not out[-1]["fort"])):
                out.pop()
            if [w for w in note if _cle(w) not in ("tout", "bon")]:
                out.append({"k": "NOTE", "texte": " ".join(note)})
            i = j
            continue

        # « à rembourser (par Julie) », « Julie doit me rembourser »
        if c == "rembourser":
            personne = None
            if out and out[-1]["k"] == "MOT" and out[-1]["cle"] == "a":
                out.pop()
            if nxt.get("cle") == "par" and tok(i + 2)["t"] == "MOT":
                personne = tok(i + 2)["brut"]
                i += 3
            else:
                while out and out[-1]["k"] == "MOT" and out[-1]["cle"] in ("me", "m'", "doit", "doivent", "va", "vont"):
                    verbe = out.pop()["cle"] in ("doit", "doivent", "va", "vont")
                    if verbe and out and out[-1]["k"] == "MOT" and out[-1]["cle"] not in BORDS | BRUIT:
                        personne = out.pop()["brut"]
                        break
                i += 1
            out.append({"k": "REMB", "personne": personne[:1].upper() + personne[1:] if personne else None})
            continue

        if t["t"] == "NUM":
            lu = lire_montant(i)
            if lu:
                out.append({"k": "MONTANT", "val": lu[0]})
                i = lu[1]
                continue
        if t["t"] == "SEP":
            out.append({"k": "SEP", "fort": t["brut"] in FIN_DE_PHRASE})
        elif t["t"] == "MOT":
            out.append({"k": "MOT", "brut": t["brut"], "cle": c})
        i += 1
    return out


# ── 3. Rattachement aux dépenses ──────────────────────────────────────────────

def _nettoyer(mots):
    mots = [m for m in mots if _cle(m) not in BRUIT]
    while mots and _cle(mots[0]) in BORDS:
        mots.pop(0)
    while mots and _cle(mots[-1]) in BORDS:
        mots.pop()
    return mots


def _joindre(mots):
    return re.sub(r"' ", "'", " ".join(mots))


def _date_finit_la_phrase(zone, j, fin_du_texte):
    """Aucun mot utile après la date, puis un point (ou la fin du texte).
    Une date suivie directement du prix suivant appartient à ce prix."""
    for x in zone[j + 1:]:
        if x["k"] == "SEP" and x["fort"]:
            return True
        if x["k"] == "MOT" and _nettoyer([x["brut"]]):
            return False
    return fin_du_texte


def analyser(texte, mois_defaut=None, historique=None, aujourdhui=None):
    """Retourne {"depenses": [...], "non_compris": [...]}.

    historique : liste de (element, type_depense) déjà saisis, pour reprendre
    l'orthographe et le type habituels (« sncf » -> « SNCF », transport).
    """
    aujourdhui = aujourdhui or date.today()
    connus = {}
    for el, typ in historique or []:
        connus.setdefault(_cle(el), (el, typ))

    m = _morceaux(_decouper(texte), mois_defaut, aujourdhui)
    positions = [k for k, x in enumerate(m) if x["k"] == "MONTANT"]
    if not positions:
        reste = _joindre(_nettoyer([x["brut"] for x in m if x["k"] == "MOT"]))
        return {"depenses": [], "non_compris": [reste] if reste else []}

    items = [{"montant": m[p]["val"], "mots": [], "date": None, "remb": 0, "personne": None,
              "notes": [], "reste": []} for p in positions]
    # zones[r] = morceaux entre le montant r-1 et le montant r
    # (zones[0] : avant le premier montant, zones[-1] : après le dernier)
    bornes = [-1] + positions + [len(m)]
    zones = [m[bornes[r] + 1:bornes[r + 1]] for r in range(len(bornes) - 1)]

    # La personne dit-elle ses dates après le prix ? (« SNCF 19 € le 24 septembre »)
    dates_apres = (not any(x["k"] == "DATE" for x in zones[0])
                   and any(x["k"] == "DATE" for x in zones[1]))

    def rembourser(it, x):
        it["remb"] = 1
        it["personne"] = x["personne"] or it["personne"]

    for r, zone in enumerate(zones):
        prec = items[r - 1] if r > 0 else None
        cour = items[r] if r < len(items) else None
        zone = list(zone)
        k = 0

        if prec is not None:
            # a) nom dit juste après le prix d'une dépense qui n'en a pas (« 1,40 €. De café »)
            if not _nettoyer(prec["mots"]):
                if (k < len(zone) and zone[k]["k"] == "SEP" and k + 1 < len(zone)
                        and zone[k + 1].get("cle") in ("de", "d'", "du")):
                    k += 1
                while k < len(zone) and zone[k]["k"] == "MOT":
                    prec["mots"].append(zone[k]["brut"]); k += 1
            # b) remboursement / remarque dits juste après le prix : dépense d'avant
            #    (on passe aussi les dates quand la personne les dit après le prix)
            j = k
            passables = ("SEP", "REMB", "NOTE", "DATE") if dates_apres else ("SEP", "REMB", "NOTE")
            while j < len(zone) and zone[j]["k"] in passables:
                if zone[j]["k"] == "REMB":
                    rembourser(prec, zone[j]); zone[j] = {"k": "SEP", "fort": False}
                elif zone[j]["k"] == "NOTE":
                    prec["notes"].append(zone[j]["texte"]); zone[j] = {"k": "SEP", "fort": False}
                j += 1
            # c) date pour la dépense d'avant
            dates = [j for j in range(k, len(zone)) if zone[j]["k"] == "DATE"]
            if prec["date"] is None and dates and (dates_apres or _date_finit_la_phrase(zone, dates[0], cour is None)):
                prec["date"] = zone[dates[0]]
                zone[dates[0]] = {"k": "SEP", "fort": False}

        # d) le reste va à la dépense suivante (ou, après le dernier prix, à la dernière)
        for x in zone[k:]:
            if x["k"] == "DATE":
                if cour is not None:
                    cour["date"] = x                              # la dernière date dite avant le prix
            elif x["k"] == "MOT":
                if cour is not None:
                    cour["mots"].append(x["brut"])
                elif not _nettoyer(prec["mots"]):
                    prec["mots"].append(x["brut"])
                else:
                    prec["reste"].append(x["brut"])
            elif x["k"] == "REMB":
                rembourser(cour or prec, x)
            elif x["k"] == "NOTE":
                (cour or prec)["notes"].append(x["texte"])

    # Une dépense sans date reprend celle de la précédente
    for a, b in zip(items, items[1:]):
        if b["date"] is None:
            b["date"] = a["date"]

    depenses, non_compris = [], []
    for it in items:
        element = _joindre(_nettoyer(it["mots"]))
        cle = _cle(element)
        typ = None
        if cle in connus:
            element, typ = connus[cle]
        elif cle:
            proche = get_close_matches(cle, list(connus), n=1, cutoff=0.85)
            if proche:
                element, typ = connus[proche[0]]
        if element and element == element.lower():
            element = " ".join(w.upper() if w in SIGLES else w for w in element.split())
            element = element[0].upper() + element[1:]
        typ = typ or deviner_type(element)
        for note in it["notes"]:                                  # « ça c'est l'abonnement Claude »
            t_note = deviner_type(note)
            if t_note and (not typ or t_note == "abonnement"):
                typ = t_note
        d = it["date"]
        if d and d["d"]:
            mois, jour = d["d"].strftime("%Y-%m"), d["d"].isoformat()
        elif d:
            mois, jour = "%d-%02d" % d["mois"], None
        else:
            mois, jour = mois_defaut, None
        depenses.append({
            "element": element or "?",
            "date_echeance": jour,
            "montant": it["montant"],
            "type_depense": typ or "autre",
            "a_rembourser": it["remb"],
            "personne": it["personne"],
            "mois": mois,
        })
        reste = _joindre(_nettoyer(it["reste"]))
        if reste:
            non_compris.append(reste)
    return {"depenses": depenses, "non_compris": non_compris}
