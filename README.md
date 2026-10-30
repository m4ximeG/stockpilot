# StockPilot — Gestion de stock sur NAS / Portainer

Application web complète, accessible sur PC et téléphone, avec **stock centralisé**, **comptes employés**, **entrées/sorties**, **étiquettes QR imprimables** et **plan interactif d'une petite réserve**.

> **Projet pilote** : réserve fictive préconfigurée (6 étagères A–F, 4 niveaux par étagère, 13 références). Les opérations enregistrées sont réelles dans une base SQLite persistante. Le plan, les références et les règles sont destinés à être adaptés au vrai magasin avant exploitation.

## Fonctionnalités

- Tableau de bord : pièces présentes, modèles, places libres, mouvements du jour
- Catalogue : créer et modifier des références (marque, modèle, catégorie, référence et zone conseillée)
- Réception : sélection du modèle, numéro de série, état et localisation facultative ou guidée
- Stock individuel : un identifiant `STK-000263` par appareil, **plusieurs produits sur un même niveau d'étagère**
- Impression : étiquette 70 × 50 mm avec QR code réel, modèle et case
- Sortie : douchette, saisie d'identifiant ou scan de QR caméra (selon navigateur HTTPS)
- Plan de la petite réserve : couloir central, étagères A, B, C à gauche et D, E, F à droite, 4 niveaux repérés par étagère (`A-1`, `A-2`…), avec nombre de produits par niveau
- Déplacement d'un produit vers un niveau d'étagère ou suppression facultative de sa localisation, avec historique
- Configuration admin : **Suivi uniquement** (localisation facultative) ou **Rangement guidé** (localisation requise pour les entrées et déplacements)
- Interface entreprise repensée avec micro-animations et navigation responsive
- Accès : administrateur / employé, connexion par mot de passe et journal des opérateurs
- Sauvegarde administrateur : export SQL téléchargeable, volume Docker persistant
- Inventaire et historique : recherche, filtres et exports CSV
- Interface responsive PC/mobile, connexion sécurisée par cookie de session

### Limites à connaître

Le dessin de la réserve (6 étagères de 4 niveaux) est **fictif** et devra être adapté à la pièce réelle. Plusieurs articles peuvent partager un niveau, mais il n'y a pas de calcul de capacité physique. Les anciens emplacements au format `A-1-1` restent enregistrés pour ne pas perdre les données ; ils sont regroupés visuellement au niveau `A-1`, et pourront être réattribués via « Déplacer ». La personnalisation du nombre de niveaux et des noms d'étagères, les retours avancés et l'intégration avec un modèle précis d'imprimante restent des évolutions. Les scans caméra utilisent `BarcodeDetector` s'il est pris en charge ; sinon une douchette ou la saisie manuelle fonctionne. Les changements sont centralisés, actualisation automatique des vues toutes les 20 secondes (hors formulaires actifs).

## Version 2 — déploiement sans perte de données

Le code migre automatiquement l'index SQLite qui limitait à une unité par emplacement ; **aucun appareil ni mouvement historique n'est effacé**. Les anciens emplacements sont préservés tels quels. Le nouveau mode par défaut est **Suivi uniquement** ; il peut être changé à tout moment dans **Configuration** par un administrateur.

**Avant la première mise à jour**, exportez la sauvegarde SQL depuis l'application et/ou faites une sauvegarde du volume Docker `stockpilot_data`. Ensuite, attendez la réussite du build GitHub Actions et demandez à Portainer de **récupérer la nouvelle image**, puis redéployez sans supprimer le volume. Si le déploiement utilise la stack Git, vérifiez que le bouton de mise à jour récupère bien le tag `latest` (un tag SHA est plus sûr pour figer une version).

## Première connexion

Variables indispensables au premier lancement :

- `STOCKPILOT_ADMIN_PASSWORD` : mot de passe admin **de 12 caractères minimum**, à garder secret
- `STOCKPILOT_SECRET_KEY` : secret de session unique (par exemple `openssl rand -hex 32`)
- `STOCKPILOT_ADMIN_USERNAME` : par défaut `admin`
- `STOCKPILOT_SECURE_COOKIES` : `1` en HTTPS derrière Nginx Proxy Manager, `0` seulement pendant un test local HTTP
- `STOCKPILOT_DEMO_SEED` : `1` pour remplir un nouveau stock avec les références fictives ; `0` pour une base neuve vide. **Ne réinitialise jamais une base déjà créée.**
- `STOCKPILOT_ALLOW_RESET` : `0` recommandé, `1` affiche un bouton de réinitialisation fictive admin, destructif

La base est `/data/stockpilot.sqlite3`, montée dans le volume `stockpilot_data`. **Ne supprimez pas ce volume lors des mises à jour.**

## Mettre sur GitHub

Le nouveau dépôt public à créer s'appelle `stockpilot` sous `m4ximeG` : [Créer un dépôt GitHub](https://github.com/new). Ne cochez pas « Initialize with README » si vous poussez ce projet complet.

Depuis le dossier décompressé sur Mac, avec GitHub CLI installé (`brew install gh`), une seule commande (le script propose la connexion si nécessaire) :

```bash
bash scripts/publier-github.sh
```

Ou, pour publier manuellement :

```bash
git init -b main && git add . && git commit -m "Initial StockPilot NAS" && gh repo create m4ximeG/stockpilot --public --source=. --remote=origin --push
```

L'action GitHub `Build Docker multi-architecture` construit automatiquement une image `linux/amd64` et `linux/arm64` sur chaque `push` vers `main`, puis la publie en `ghcr.io/m4ximeg/stockpilot:latest`.

**Important :** rendez le package GHCR public dans GitHub → Packages → `stockpilot` → Package settings → Change visibility → Public, sinon un Portainer non authentifié ne pourra pas télécharger l'image.

## Déploiement Portainer avec dépôt Git

1. Une fois le dépôt créé et la première action GitHub terminée, dans Portainer, ouvrir **Stacks → Add stack → Repository**.
2. Repository URL : `https://github.com/m4ximeG/stockpilot` ; branche/référence `refs/heads/main` ; Compose path : `compose.yaml`.
3. Dans **Environment variables** de la stack, définir `STOCKPILOT_ADMIN_PASSWORD` et `STOCKPILOT_SECRET_KEY` ainsi que les options ci-dessus. Ne stockez pas les secrets dans Git.
4. Déployer. Le conteneur écoute sur le **port 8787 du NAS** vers 8080 dans le conteneur.
5. Dans Nginx Proxy Manager, pointer un domaine HTTPS vers `http://IP_LOCALE_DU_NAS:8787`. Activez certificat SSL / Force SSL. `STOCKPILOT_SECURE_COOKIES=1` est adapté à cet accès HTTPS.
6. Depuis les paramètres de Portainer, réactivez la récupération des nouvelles images lors des mises à jour GitOps si votre version le propose.

**Si vous testez d'abord via `http://IP_DU_NAS:8787` sans HTTPS**, réglez `STOCKPILOT_SECURE_COOKIES=0`, sinon le navigateur n'enverra pas le cookie de connexion sur HTTP. Remettez la valeur à `1` derrière le domaine HTTPS.

### Alternative : construire sur le NAS sans GitHub Actions

```bash
cp .env.example .env
# éditer .env pour remplacer les secrets puis mettre STOCKPILOT_SECURE_COOKIES=0 si HTTP

docker compose -f compose.local.yaml up -d --build
```

Le compose local utilise `build: .` et s'adresse plutôt à un terminal Docker sur le NAS, **pas** à une stack Portainer Git qui ne construit pas toujours les images.

## Sauvegardes / mises à jour

- Sauvegarde régulière du volume `stockpilot_data` (SQLite DB + fichiers `-wal` et `-shm` si présents). Mettre en pause ou arrêter le conteneur pour une sauvegarde à froid, ou utiliser l'**export SQL admin** depuis l'interface.
- Il est possible de recréer le conteneur en gardant le volume sans perdre le stock.
- L'application **ne synchronise pas le stock fictif avec un logiciel de caisse** : les sorties se font via la page Sortie/Scanner.
- Évitez une exposition directe du port 8787 à Internet ; exposez le domaine via votre reverse proxy HTTPS et limitez l'accès aux personnes autorisées.

## Tests

```bash
pip install -r requirements.txt
STOCKPILOT_DATA_DIR=/tmp/stockpilot-test STOCKPILOT_ADMIN_PASSWORD='UnMotDePasseFort123!' STOCKPILOT_SECRET_KEY='long-secret-de-test' python -m unittest discover -s tests -v
```

L'action GitHub `Tests StockPilot` exécute ces tests automatiquement. La configuration `.env` n'est **jamais envoyée** au dépôt grâce au `.gitignore` et `.dockerignore`.
