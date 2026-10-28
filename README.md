# Mes Comptes

**Une application de budget personnel qu'on remplit en parlant.**
Dictez vos dépenses comme vous les diriez à quelqu'un, vérifiez la liste, et tout est classé : montants, dates, catégories, remboursements.
Sans compte, sans abonnement, sans publicité : vos données restent sur votre appareil.

👉 **Essayer tout de suite, sans rien installer : https://croquettemagique.github.io/mes-comptes/**

---

## Ce qui la rend différente

**🎙️ La dictée vocale.** Dites « *4 septembre, Carrefour, 45 euros 20. Le 6, laverie, 3 euros. Pizza 12 euros, Julie doit me rembourser.* » : l'appli en tire trois dépenses, avec la date, le montant, la catégorie et la personne qui doit rembourser. Elle comprend les nombres en toutes lettres (« soixante-dix », « quatre-vingt-un »), « hier », « le 1er », « j'ai payé … chez … », la date dite avant ou après le prix, et reprend l'orthographe et la catégorie de vos dépenses habituelles. L'analyse se fait sur votre appareil, et tout passe par une liste à vérifier avant d'être enregistré.

**💶 Des avoirs qui se tiennent à jour tout seuls.** Indiquez une fois ce que vous avez sur votre compte : le montant suit ensuite chaque dépense, chaque revenu et chaque remboursement reçu. L'appli estime aussi votre solde de fin de mois d'après votre rythme de dépenses.

**🤝 Les remboursements par personne.** Marquez ce que vous avez avancé pour quelqu'un, filtrez par personne, et envoyez-lui le récapitulatif en PDF par WhatsApp en un clic.

**Et aussi**
- **Budgets par catégorie**, avec une barre qui passe à l'orange puis au rouge.
- **Charges et revenus fixes** (loyer, abonnements, salaire, bourse…) recopiés automatiquement chaque mois.
- **Dictée des revenus** aussi : « Le 5, salaire, 1500 euros. »
- **Recherche** sur tous les mois, par nom, personne ou catégorie.
- **Exports** PDF du mois et Excel de toutes les données.
- **Annuler** après une suppression.
- **Mises à jour automatiques**, avec une fenêtre « Nouveautés » qui présente les changements.
- Interface sombre noir et or, adaptée à l'ordinateur comme au téléphone.

---

## Deux façons de l'utiliser

| | Version navigateur | Version installée |
|---|---|---|
| Installation | Aucune : une adresse web | Python et quelques minutes de mise en place |
| Où sont les données | Dans le navigateur de l'appareil | Dans un fichier sur l'ordinateur (`comptes.db`) |
| Sauvegardes | Automatiques, dans un fichier (Chrome, Edge) ou dans Téléchargements (Safari) | Copie automatique chaque jour |
| Fonctionnalités | Toutes | Toutes |
| Mises à jour | Automatiques | Automatiques, au lancement |

Les deux versions partagent la même interface et les mêmes règles de calcul. Dans aucun cas les données ne sont envoyées sur internet.

---

## Version navigateur (sans rien installer)

Adresse : **https://croquettemagique.github.io/mes-comptes/**

**Sur Mac (Safari)**
1. Ouvrir l'adresse dans Safari.
2. Menu **Fichier → Ajouter au Dock** (macOS 14 Sonoma ou plus récent). Une icône « Mes Comptes » apparaît dans le Dock.
3. Ouvrir l'appli **toujours par cette icône** : elle a sa propre fenêtre et garde ses données à part.

**Sur iPhone / iPad** : Safari → bouton **Partager** → **Sur l'écran d'accueil**.

**Sur PC** : ouvrir l'adresse dans Edge ou Chrome, puis menu **⋯ → Applications → Installer ce site en tant qu'application**.

**À savoir**
- Les données restent dans le navigateur de l'appareil et ne passent pas d'un appareil à l'autre. Pour les transférer : « Sauvegarder mes données », puis « Restaurer une sauvegarde » sur l'autre appareil.
- **Sauvegarde automatique** : avec Chrome ou Edge, « Activer la sauvegarde automatique » met à jour un fichier de votre choix à chaque modification ; avec Safari, une sauvegarde est téléchargée à l'ouverture (au plus tous les 3 jours, si vos comptes ont changé). Effacer les données du navigateur efface vos comptes, mais pas ces fichiers : « Restaurer une sauvegarde » les recharge.

---

## Version installée

### Mac

1. **Installer les outils.** Ouvrir le **Terminal** (⌘ + Espace, taper « Terminal », Entrée) et taper :
   ```bash
   xcode-select --install
   ```
   Cliquer sur **Installer** et attendre la fin (5 à 15 minutes). Si le Terminal répond « already installed », passer à la suite.
2. **Télécharger l'appli :**
   ```bash
   cd ~/Documents
   git clone https://github.com/CroquetteMagique/mes-comptes.git MesComptes
   ```
3. **Installer (une seule fois) :**
   ```bash
   bash ~/Documents/MesComptes/installer_mac.command
   ```
   Le script prépare tout et crée l'icône **« Mes Comptes »** sur le bureau.
4. **Lancer :** double-clic sur l'icône (la première fois : clic droit → **Ouvrir** → **Ouvrir**). Safari s'ouvre sur l'appli, vide, qui demande votre prénom.
5. **Dictée vocale (facultatif) :** **Réglages Système → Clavier → Dictée**, activer, puis autoriser le micro quand Safari le demande.

### Windows

1. Installer [Python 3](https://www.python.org) et [Git](https://git-scm.com).
2. Dans un terminal :
   ```bash
   git clone https://github.com/CroquetteMagique/mes-comptes.git MesComptes
   pip install -r MesComptes/requirements.txt
   ```
3. Double-cliquer sur `lancer_silent.vbs`. L'appli s'ouvre dans Microsoft Edge (la dictée vocale y fonctionne).

> Raccourci bureau : clic droit sur `lancer_silent.vbs` → Envoyer vers → Bureau (créer un raccourci).

### Mises à jour de la version installée

À chaque lancement, l'appli vérifie s'il existe une nouvelle version et l'installe avant de démarrer. Pour l'obtenir : fermer l'onglet de l'appli, attendre deux minutes (elle s'arrête seule), puis la relancer.

- Vos données (`comptes.db`, `sauvegardes/`) ne sont jamais modifiées, et une copie de la base est faite juste avant.
- Si un fichier de l'appli a été modifié à la main, ou si la nouvelle version ne passe pas les vérifications, rien n'est changé.
- Sans internet, l'appli démarre normalement avec la version déjà installée.

Journal : `sauvegardes/mises_a_jour.log`. Mise à jour manuelle : `mise_a_jour_mac.command` ou `mise_a_jour_windows.bat`.

### Dictée selon le navigateur

Le micro de l'appli fonctionne dans **Chrome, Edge et Safari** (la reconnaissance vocale du navigateur demande une connexion internet). Dans Opera ou Firefox, l'appli propose la dictée du système : **Windows + H**, ou deux fois **Fn** sur Mac.

---

## Pour les développeurs

```
├── app.py                      # Serveur Flask : API et exports (version installée)
├── dictee.py                   # Analyse du texte dicté (règles, sans IA)
├── mise_a_jour.py              # Mise à jour automatique au démarrage
├── notes_de_version.json       # Nouveautés affichées après une mise à jour
├── requirements.txt            # Dépendances Python
├── templates/index.html        # Interface (commune aux deux versions)
├── static/
│   ├── css/style.css
│   ├── icones/                 # Icônes de l'appli
│   └── js/
│       ├── app.js              # Interface
│       ├── local-api.js        # Version navigateur : remplace le serveur, données dans le navigateur
│       └── dictee.js           # Dictée en JavaScript (mêmes règles que dictee.py)
├── outils/construire_site.py   # Construit la version navigateur
├── .github/workflows/site.yml  # Met en ligne la version navigateur à chaque push
├── installer_mac.command       # Installation Mac (une fois)
├── lancer_mac.command          # Lanceur Mac
├── lancer_silent.vbs           # Lanceur Windows (sans terminal)
├── mise_a_jour_mac.command     # Mise à jour manuelle Mac
└── mise_a_jour_windows.bat     # Mise à jour manuelle Windows
```

**Technique** : Python 3.9+ et Flask, SQLite, HTML/CSS/JavaScript sans framework, Chart.js pour les graphiques, fpdf2 et jsPDF pour les PDF, police Manrope.
