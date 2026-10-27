"""Construit la version navigateur (site statique) dans _site/.

Utilisé par GitHub (.github/workflows/site.yml) à chaque push sur main ;
peut aussi se lancer à la main : python outils/construire_site.py
Le même gabarit que l'appli Python est utilisé, avec mode_local=True :
les données sont alors gardées dans le navigateur (static/js/local-api.js).
"""
import json
import os
import shutil
import subprocess
import time

from jinja2 import Environment, FileSystemLoader, TemplateNotFound


class SansPerso(FileSystemLoader):
    """Les parties perso (templates/perso/) ne vont jamais dans la version publiée."""
    def get_source(self, environment, template):
        if template.startswith("perso/"):
            raise TemplateNotFound(template)
        return super().get_source(environment, template)

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SORTIE = os.path.join(RACINE, "_site")


def version():
    try:
        return subprocess.run(["git", "-C", RACINE, "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return str(int(time.time()))


def construire():
    shutil.rmtree(SORTIE, ignore_errors=True)
    os.makedirs(SORTIE)
    env = Environment(loader=SansPerso(os.path.join(RACINE, "templates")))
    html = env.get_template("index.html").render(version=version(), mode_local=True)
    with open(os.path.join(SORTIE, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    shutil.copytree(os.path.join(RACINE, "static"), os.path.join(SORTIE, "static"))
    shutil.copy(os.path.join(RACINE, "notes_de_version.json"), SORTIE)
    manifeste = {
        "name": "Mes Comptes", "short_name": "Mes Comptes", "lang": "fr",
        "start_url": "./", "scope": "./", "display": "standalone",
        "background_color": "#050505", "theme_color": "#050505",
        "icons": [{"src": f"static/icones/icone-{t}.png", "sizes": f"{t}x{t}", "type": "image/png"} for t in (192, 512)],
    }
    with open(os.path.join(SORTIE, "manifest.webmanifest"), "w", encoding="utf-8") as f:
        json.dump(manifeste, f, ensure_ascii=False, indent=1)
    open(os.path.join(SORTIE, ".nojekyll"), "w").close()
    print("Site construit dans", SORTIE)


if __name__ == "__main__":
    construire()
