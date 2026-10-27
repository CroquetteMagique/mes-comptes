"""Mise à jour automatique depuis GitHub, au démarrage de l'appli.

Règle : une mise à jour ne doit jamais casser l'appli ni toucher aux données.
  - uniquement au démarrage, avant que le serveur ne réponde (jamais à chaud) ;
  - uniquement si elle s'applique sans conflit (« fast-forward ») et si aucun
    fichier de l'appli n'a été modifié à la main dans ce dossier ;
  - copie de la base dans sauvegardes/ avant d'appliquer ;
  - le nouveau code est vérifié (compilation, dépendances) ; en cas de problème,
    retour immédiat à la version d'avant ;
  - pas de git, pas de réseau, pas d'accès au dépôt : l'appli démarre telle quelle.
Les données (comptes.db, sauvegardes/, templates/perso/) sont ignorées par git :
une mise à jour ne les modifie jamais.
"""
import glob
import os
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime

DOSSIER = os.path.dirname(os.path.abspath(__file__))
JOURNAL = os.path.join(DOSSIER, "sauvegardes", "mises_a_jour.log")
GARDER_AVANT_MAJ = 5          # copies « avant mise à jour » conservées


def _journal(msg):
    try:
        os.makedirs(os.path.dirname(JOURNAL), exist_ok=True)
        with open(JOURNAL, "a", encoding="utf-8") as f:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}\n")
    except OSError:
        pass


def _git(*args, timeout=15):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never")  # jamais de fenêtre de connexion
    flags = 0x08000000 if os.name == "nt" else 0                                # CREATE_NO_WINDOW sous Windows
    return subprocess.run(["git", "-C", DOSSIER, *args], capture_output=True, text=True,
                          timeout=timeout, env=env, creationflags=flags)


def _sauvegarder_base(version):
    base = os.path.join(DOSSIER, "comptes.db")
    if not os.path.exists(base):
        return
    dossier = os.path.join(DOSSIER, "sauvegardes")
    os.makedirs(dossier, exist_ok=True)
    cible = os.path.join(dossier, f"avant_maj_{datetime.now():%Y-%m-%d_%H%M}_{version[:7]}.db")
    src, dst = sqlite3.connect(base), sqlite3.connect(cible)
    with dst:
        src.backup(dst)
    src.close(); dst.close()
    for vieux in sorted(glob.glob(os.path.join(dossier, "avant_maj_*.db")))[:-GARDER_AVANT_MAJ]:
        os.remove(vieux)


def _code_valide():
    fichiers = glob.glob(os.path.join(DOSSIER, "*.py"))
    r = subprocess.run([sys.executable, "-m", "py_compile", *fichiers], capture_output=True, text=True, timeout=60)
    return r.returncode == 0


def appliquer():
    """Retourne True si une nouvelle version a été installée (il faut alors relancer)."""
    if not shutil.which("git") or not os.path.isdir(os.path.join(DOSSIER, ".git")):
        return False                                   # installation par ZIP : pas de mise à jour auto
    avant = None
    try:
        if _git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip() != "main":
            return False
        if _git("status", "--porcelain", "--untracked-files=no").stdout.strip():
            _journal("fichiers modifiés à la main : mise à jour ignorée")
            return False
        if _git("fetch", "--quiet", "origin", "main", timeout=20).returncode != 0:
            return False                               # hors ligne ou accès refusé
        avant = _git("rev-parse", "HEAD").stdout.strip()
        apres = _git("rev-parse", "origin/main").stdout.strip()
        if not avant or not apres or avant == apres:
            return False
        if _git("merge-base", "--is-ancestor", avant, apres).returncode != 0:
            _journal("version locale différente du dépôt : mise à jour ignorée")
            return False

        _sauvegarder_base(avant)
        if _git("merge", "--ff-only", "--quiet", "origin/main").returncode != 0:
            return False
        changes = _git("diff", "--name-only", avant, apres).stdout.split()
        ok = _code_valide()
        if ok and "requirements.txt" in changes:
            r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "-r",
                                os.path.join(DOSSIER, "requirements.txt")], capture_output=True, timeout=300)
            ok = r.returncode == 0
        if not ok:
            _git("reset", "--hard", "--quiet", avant)
            _journal(f"nouvelle version {apres[:7]} refusée (vérification échouée), retour à {avant[:7]}")
            return False
        _journal(f"mise à jour {avant[:7]} -> {apres[:7]}")
        return True
    except (subprocess.TimeoutExpired, OSError, sqlite3.Error) as e:
        _journal(f"mise à jour interrompue : {e}")
        try:
            if avant and _git("rev-parse", "HEAD").stdout.strip() != avant:
                _git("reset", "--hard", "--quiet", avant)
        except (subprocess.TimeoutExpired, OSError):
            pass
        return False


def relancer():
    """Redémarre l'appli avec le nouveau code (le serveur n'a pas encore démarré)."""
    if os.name == "nt":
        subprocess.Popen([sys.executable, *sys.argv], cwd=DOSSIER)
        os._exit(0)
    os.execv(sys.executable, [sys.executable, *sys.argv])
