# StockPilot — Gestion de stock sur NAS / Portainer

Application web complète, accessible sur PC et téléphone, avec **stock centralisé**, **comptes employés**, **entrées/sorties**, **étiquettes QR imprimables** et **plan interactif d'une petite réserve**.

> **Version test réaliste** : 10 étagères de réserve (A–D à gauche, E–J à droite), 5 niveaux chacune, **aucune référence ni aucun article fictif inséré par défaut**. Les tailles des niveaux se configurent séparément ; initialement, elles sont « Non précisée ».

## Fonctionnalités

- Tableau de bord : pièces présentes, modèles, places libres, mouvements du jour
- Catalogue : créer et modifier des références (marque, modèle, catégorie, référence, étagère indicative et emplacement conseillé)
- Réception : saisie libre avec suggestions automatiques, création de référence si elle n'existe pas, numéro de série facultatif, états Neuf / Retour SAV / Réparation et localisation sur un rayonnage cliquable
- Stock individuel : un identifiant `STK-000263` par appareil, **plusieurs produits sur un même niveau d'étagère**
- Impression : étiquette 70 × 50 mm avec QR code réel, modèle et emplacement
- Sortie : douchette, saisie d'identifiant ou scan de QR caméra (selon navigateur HTTPS)
- Plan de la petite réserve : couloir central, 4 étagères A–D à gauche et 6 E–J à droite, 5 niveaux chacune, avec tailles et notes configurables par niveau (`A-1`, `A-2`…), avec nombre de produits par niveau
- Déplacement d'un produit vers un niveau d'étagère ou suppression facultative de sa localisation, avec historique
- Configuration admin : **Suivi uniquement** (localisation facultative) ou **Rangement guidé** (localisation requise pour les entrées et déplacements)
- Règle par modèle configurable par un administrateur : emplacement conseillé (`B-3` par exemple), affiché automatiquement à la réception et librement modifiable, **sans déplacer les articles déjà enregistrés**
- Interface métier au style sobre et cohérent sur tout le site, et sélection visuelle des 50 niveaux depuis la réception
- Accès : administrateur / employé, connexion par mot de passe et journal des opérateurs
- Sauvegarde administrateur : export SQL téléchargeable, volume Docker persistant
- Inventaire et historique : recherche, filtres et exports CSV
- Interface responsive PC/mobile, connexion sécurisée par cookie de session

### Limites à connaître

Le plan représente la disposition décrite : 4 étagères à gauche, 6 à droite et 5 niveaux chacune. Les largeurs et hauteurs restent schématiques et devront être affinées sur place. Plusieurs articles peuvent partager un niveau, mais il n'y a pas de calcul de capacité physique. Les anciens emplacements au format `A-1-1` restent enregistrés pour ne pas perdre les données ; ils sont regroupés visuellement au niveau `A-1`, et pourront être réattribués via « Déplacer ». La personnalisation du nombre de sections et de leurs noms, les retours avancés et l'intégration avec un modèle précis d'imprimante restent des évolutions. Les scans caméra utilisent `BarcodeDetector` s'il est pris en charge ; sinon une douchette ou la saisie manuelle fonctionne. Les changements sont centralisés, actualisation automatique des vues toutes les 20 secondes (hors formulaires actifs).

## Version 3 — proposition adaptée à la réserve photographiée

La pièce est modélisée en **couloir central étroit**, avec 4 étagères A–D à gauche et 6 E–J à droite, cinq niveaux par étagère du bas vers le haut. Les tailles de niveaux restent configurables et les volumes ne sont pas automatiquement contrôlés.

Sous **Configuration → Où ranger chaque modèle ?**, affectez chaque référence à un emplacement conseillé. Exemple : `TERRA Mobile 1517 → B-3`. Le site propose ce repère à chaque réception de ce modèle, sans l'imposer en mode facultatif. Chaque nouvelle règle est conservée en base SQLite. Une migration additive ajoute la colonne `preferred_slot` aux références existantes ; aucun mouvement de stock n'est effectué automatiquement.

## Version 2 — déploiement sans perte de données

Le code migre automatiquement l'index SQLite qui limitait à une unité par emplacement ; **aucun appareil ni mouvement historique n'est effacé**. Les anciens emplacements sont préservés tels quels. Le nouveau mode par défaut est **Suivi uniquement** ; il peut être changé à tout moment dans **Configuration** par un administrateur.

**Avant la première mise à jour**, exportez la sauvegarde SQL depuis l'application et/ou faites une sauvegarde du volume Docker `stockpilot_data`. Ensuite, attendez la réussite du build GitHub Actions et demandez à Portainer de **récupérer la nouvelle image**, puis redéployez sans supprimer le volume. Si le déploiement utilise la stack Git, vérifiez que le bouton de mise à jour récupère bien le tag `latest` (un tag SHA est plus sûr pour figer une version).

## Version 5 — interface et réception simplifiées

La page **Entrée en stock** permet de rechercher un modèle existant et de l'enregistrer directement dans le cas contraire. L'opération référence + article est **atomique** côté SQLite ; le même nom exact réutilise sa référence et le numéro de série peut être vide. Les seuls nouveaux états affichés sont **Neuf**, **Retour SAV**, **Réparation**.

Le plan de réception présente 4 étagères à gauche, 6 à droite et une vue de face semi-3D du rayonnage sélectionné. Chaque niveau cliquable indique son nombre d'articles. L'ensemble de l'interface a été uniformisé en style magasin sobre (CSS éditorial).

Une **migration ciblée de suppression des données fictives** s'exécute au premier démarrage en production. La migration vérifie l'ID, le numéro de série original et l'auteur des entrées. Elle ne vide pas le stock réel. Le point de restauration est conservé dans le volume `stockpilot_data` sous `/data/backups/`. Le mécanisme de génération des anciens exemples est réservé au développement (`STOCKPILOT_DEV_FIXTURES=1`) et n'est pas activé sur le NAS.

## Version 4 — réserve réelle, essais sur base vide

- **Nouvelle installation :** aucun appareil fictif créé en production, même si l'ancienne variable `STOCKPILOT_DEMO_SEED=1` subsiste dans Portainer (elle est désormais ignorée). Structure de rayonnages A–J, niveaux 1–5, uniquement.
- **Installation existante :** au redémarrage sur cette version, une migration retire **uniquement les 27 appareils fictifs identifiés** par leur ID, numéro de série et auteur `Équipe magasin`. Elle nettoie leurs mouvements et les références fictives inutilisées ; les autres articles manuels sont préservés. Une copie SQLite automatique est créée dans `/data/backups/` avant ce nettoyage. Le bouton distinct **Vider définitivement le stock actuel** reste disponible si vous souhaitez effacer également vos propres essais ; il nécessite confirmation explicite et une sauvegarde.
- **Tailles différentes :** dans **Plan de la réserve**, sélectionnez une étagère/niveau et renseignez une taille (« Non précisée », « Petite », « Moyenne », « Grande ») et une note. Les tailles sont indicatives : le logiciel ne valide pas encore la capacité physique d'un carton.
- **Entrées/sorties :** saisissez simplement un nom de produit. Si une référence existe, sélectionnez-la parmi les suggestions ; sinon une nouvelle référence est créée lors de l'entrée. Choisissez le niveau de rangement sur la vue du couloir (ou laissez-le vide en mode facultatif), puis imprimez l'étiquette et testez la sortie par scan.
- **Étiquettes** : modèle actuel 70 × 50 mm, conçu pour une imprimante thermique prenant en charge ce format, installée sur le PC depuis lequel on déclenche l'impression via le navigateur. La connexion USB sur le PC de l'accueil est le plus simple ; le NAS héberge les données mais n'imprime pas directement.

**Pour le NAS existant**, pensez à remplacer la variable Portainer `STOCKPILOT_DEMO_SEED=1` par `0`. Cela n'efface pas les anciens enregistrements : utilisez le nettoyage volontaire après sauvegarde pour repartir de zéro.

## Nouvelle présentation immersive de la réserve

La page **Entrée en stock**, le **Plan du dépôt** et l'aperçu sur le tableau de bord utilisent la même scène immersive. Les dix rayonnages A à J sont repérés par lettres ; sélectionner un rayonnage affiche les cinq niveaux, et chaque niveau présente la quantité réelle enregistrée dans SQLite. Une fiche indique l'emplacement, la taille configurée et la note. **Aucune quantité fictive n'est affichée**.

**Photo réelle (optionnelle)** : depuis **Entrée en stock** ou **Plan du dépôt**, cliquez sur **Ajouter une photo** en étant administrateur. Importez une photo JPG, PNG ou WEBP de la réserve (8 Mo maximum). Elle sera conservée dans le volume Docker à `/data/warehouse-photo.webp`, sans être publiée dans le dépôt GitHub. Les repères restent interactifs par-dessus. Sans photo personnalisée, le site affiche par défaut une version optimisée de la photographie de la réserve fournie pour la démonstration. Le fichier d'exemple `static/reserve-photo.b64` est présent dans ce dépôt public : il ne doit donc pas contenir d'informations confidentielles. Une image téléchargée dans l'administration reste sur le volume NAS (`/data/warehouse-photo.webp`) et n'est pas ajoutée à GitHub.

Il s'agit d'un repérage indicatif sur la photo, pas d'une reconstruction tridimensionnelle exacte ni d'un calcul de volumes physiques. La photo peut être changée ultérieurement. Le numéro de série reste facultatif, la création de référence est automatique depuis le champ de réception, et les états proposés à l'entrée sont **Neuf**, **Retour SAV** et **Réparation**.

## Réception — interface de référence

La page **Réceptionner un produit** reprend désormais la disposition, les couleurs et la photographie recadrée de la maquette validée : recherche/création à gauche, vue des rayonnages A–J à droite, badges d'emplacements interactifs et fiche récapitulative en dessous. L'image de la maquette est intégrée en version compressée à `static/mockup-photo.b64`. Les quantités affichées par-dessus sont calculées depuis SQLite ; aucun appareil de démonstration n'est ajouté. Pour une meilleure netteté, un administrateur peut importer la version HD dans **Configuration → Photo de la réserve** ; cette image est stockée dans le volume NAS, sans modifier les données.

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
