# Mes Comptes

Application de gestion de finances personnelles — suivi des dépenses, revenus et remboursements.

---

## Fonctionnalités

- **Tableau de bord** : avoirs (saisis une fois, puis recalculés à chaque dépense ou revenu), bilan du mois, fin de mois estimée, graphiques
- **Dictée vocale** : dictez vos dépenses (« 4 mars, Carrefour, 45 euros 20 »), vérifiez la liste, tout est enregistré d'un coup (micro intégré dans Chrome, Edge et Safari ; dans Opera ou Firefox, dictée du système : Windows + H ou deux fois Fn sur Mac)
- **Dépenses** fixes et variables, classées par catégorie, avec recherche sur tous les mois
- **Budgets par catégorie** avec alerte orange puis rouge
- **Revenus** mensuels
- **Remboursements** par personne, avec export PDF et envoi par WhatsApp
- **Export** PDF du mois et export Excel (CSV) de toutes les données
- **Sauvegarde automatique** quotidienne de la base (dossier `sauvegardes/`, 30 jours gardés)
- Votre prénom affiché en haut à gauche (demandé au premier lancement, cliquez dessus pour le changer)
- Création automatique du mois en cours (avec copie des charges fixes)

---

## Version navigateur (sans rien installer)

Adresse : **https://croquettemagique.github.io/mes-comptes/**

**Sur Mac (Safari)**
1. Ouvrir l'adresse dans Safari.
2. Menu **Fichier → Ajouter au Dock** (macOS 14 Sonoma ou plus récent). Une icône « Mes Comptes » apparaît dans le Dock.
3. Utiliser **toujours cette icône** : l'appli s'ouvre dans sa propre fenêtre et garde ses données à part.

**Sur iPhone / iPad** : Safari → bouton **Partager** → **Sur l'écran d'accueil**.

**À savoir**
- Les données restent sur l'appareil (dans le navigateur) : rien n'est envoyé sur internet.
- Elles ne passent pas d'un appareil à l'autre ; pour les transférer : « Sauvegarder mes données » puis « Restaurer une sauvegarde » sur l'autre appareil.
- Faites une sauvegarde de temps en temps (l'appli le rappelle) : effacer les données de Safari les supprime aussi.
- Les mises à jour sont automatiques : la nouvelle version s'affiche à l'ouverture suivante, avec la fenêtre « Nouveautés ».

---

## Installation

### Mac (Safari) — pas à pas

Le dépôt est privé : il faut un compte GitHub qui y a accès, et un **jeton d'accès** (une sorte de mot de passe en lecture seule) pour que le Mac puisse télécharger l'appli et ses mises à jour.

**1. Créer le jeton d'accès** (sur github.com, connecté au compte qui a accès au dépôt)

1. Photo de profil (en haut à droite) → **Settings** → tout en bas à gauche **Developer settings**.
2. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
3. *Token name* : `Mes Comptes Mac` ; *Expiration* : la durée maximale proposée.
4. *Repository access* : **Only select repositories** → choisir le dépôt de l'appli.
5. *Permissions* → *Repository permissions* → **Contents : Read-only**.
6. **Generate token**, puis copier le jeton (il commence par `github_pat_`). Il ne sera plus affiché ensuite.

**2. Installer les outils (git et Python)**

Ouvrir le **Terminal** (⌘ + Espace, taper « Terminal », Entrée) et taper :

```bash
xcode-select --install
```

Une fenêtre s'ouvre : **Installer**, puis attendre la fin (5 à 15 min). Si le Terminal répond « already installed », passer à la suite.

**3. Télécharger l'appli**

Sur la page GitHub du dépôt, bouton vert **Code** → copier l'adresse **HTTPS**. Dans le Terminal :

```bash
cd ~/Documents
git clone <adresse copiée> MesComptes
```

- *Username* : votre nom d'utilisateur GitHub
- *Password* : **coller le jeton** (rien ne s'affiche pendant la saisie, c'est normal), puis Entrée

Le Mac retient le jeton dans le trousseau : il ne sera plus demandé, même pour les mises à jour.

**4. Installer l'appli** (une seule fois)

```bash
bash ~/Documents/MesComptes/installer_mac.command
```

Le script installe ce qu'il faut et crée l'icône **« Mes Comptes »** sur le bureau.

**5. Lancer**

Double-clic sur l'icône **Mes Comptes** du bureau (la première fois : clic droit → **Ouvrir** → **Ouvrir**). Safari s'ouvre sur l'appli, **vide**, qui demande votre prénom.

**6. Dictée vocale** (facultatif)

**Réglages Système → Clavier → Dictée** : activer. Au premier usage du micro dans l'appli, Safari demande l'autorisation : **Autoriser**.

Vos données restent sur votre Mac, dans `~/Documents/MesComptes/comptes.db` (copie automatique chaque jour dans `sauvegardes/`).

---

### Windows

1. Installer [Python 3](https://www.python.org) et [Git](https://git-scm.com).
2. Dans un terminal : `git clone <adresse du dépôt> AppComptes`, puis `pip install -r AppComptes/requirements.txt`.
3. Double-cliquer sur `lancer_silent.vbs` (sans fenêtre de terminal). L'appli s'ouvre dans Microsoft Edge (la dictée vocale y fonctionne), ou dans le navigateur par défaut si Edge est absent.

> Raccourci bureau : clic droit sur `lancer_silent.vbs` → Envoyer vers → Bureau (créer un raccourci).

---

## Mises à jour

**Automatiques.** À chaque lancement, l'appli regarde s'il existe une nouvelle version sur GitHub et l'installe avant de démarrer. Une fenêtre **« Nouveautés »** présente alors les changements (vous pouvez la rouvrir depuis le lien « Nouveautés » en bas à gauche).

Une nouvelle version se télécharge au **lancement suivant** : fermez l'onglet de l'appli, attendez 2 minutes (l'appli s'arrête seule), puis relancez-la.

Garanties :
- vos données (`comptes.db`, `sauvegardes/`) ne sont jamais modifiées par une mise à jour, et une copie de la base est faite juste avant ;
- si un fichier de l'appli a été modifié à la main, ou si la nouvelle version ne passe pas les vérifications, rien n'est changé ;
- sans internet, l'appli démarre normalement avec la version déjà installée.

Journal des mises à jour : `sauvegardes/mises_a_jour.log`.
Mise à jour manuelle possible : `mise_a_jour_mac.command` (Mac) ou `mise_a_jour_windows.bat` (Windows).

---

## Structure du projet

```
AppComptes/
├── app.py                      # Serveur Flask (backend + API)
├── dictee.py                   # Analyse du texte dicté
├── mise_a_jour.py              # Mise à jour automatique au démarrage
├── notes_de_version.json       # Nouveautés affichées après une mise à jour
├── requirements.txt            # Dépendances Python
├── outils/construire_site.py   # Construit la version navigateur (GitHub Pages)
├── static/js/local-api.js      # Version navigateur : remplace le serveur
├── static/js/dictee.js         # Dictée en JavaScript (mêmes règles que dictee.py)
├── comptes.db                  # Base de données SQLite (non partagée)
├── templates/
│   └── index.html              # Interface utilisateur
├── static/
│   ├── css/style.css
│   └── js/app.js
├── installer_mac.command       # Installateur Mac (une seule fois)
├── lancer_mac.command          # Lanceur Mac alternatif
├── lancer_silent.vbs           # Lanceur Windows (sans terminal)
├── mise_a_jour_mac.command     # Mise à jour Mac
└── mise_a_jour_windows.bat     # Mise à jour Windows
```

---

## Stack technique

- **Backend** : Python 3 / Flask
- **Base de données** : SQLite
- **Frontend** : HTML / CSS / JavaScript (vanilla)
- **Graphiques** : Chart.js
- **Export PDF** : fpdf2
- **Fonts** : Playfair Display, Outfit, JetBrains Mono (Google Fonts)
