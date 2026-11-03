# StockPilot — Inventaire par code-barres

StockPilot est une application web accessible sur **PC et téléphone** pour suivre le matériel disponible dans un magasin. La version actuelle est volontairement simple : **aucun plan 3D, aucun emplacement ni rayonnage à gérer**.

## Aurora — interface du 2 novembre 2026

L'accueil reproduit la composition du tableau de bord à fond d'orage demandé : **photo plein écran, petite barre latérale d'icônes à gauche, accueil en haut, grande typographie blanche, six statistiques réelles, courbe des mouvements sur sept jours et quatre panneaux en verre liquide à droite**. Les statistiques sont calculées depuis les articles et l'historique SQLite (aucun chiffre fictif).

L'entrée, le scanner, l'inventaire, l'historique et la configuration restent utilisables, avec les mêmes principes de verre translucide et de navigation. Sur téléphone, le tableau de bord devient défilant et la navigation est placée en bas.

- Feuille de style : `static/aurora.css`
- Données et courbe : `static/barcode-only.js`
- Photo de fond provisoire sous licence Pexels : [Guillaume Boulanger — Stunning Thunderstorm Over Rural Wheat Field](https://www.pexels.com/photo/stunning-thunderstorm-over-rural-wheat-field-39914828/). Il ne s'agit **pas** de l'original du prompt (celui-ci n'a été fourni qu'en capture et en texte, pas comme fichier de fond séparé).
- Animations `aurRise`, `aurSlideR`, `aurLine`, `aurDraw`, `aurFill`, `aurSheen`, avec désactivation en cas de mouvement réduit.
- **Retour immédiat vers la DA précédente :** branche [`backup/stockpilot-facet-avant-aurora-2026-11-02`](https://github.com/m4ximeG/stockpilot/tree/backup/stockpilot-facet-avant-aurora-2026-11-02), commit `538b17762025fbc1e4bb8289e5f562cea8262ebd`.
- **Retour vers la DA claire** : branche [`backup/stockpilot-avant-glass-2026-11-02`](https://github.com/m4ximeG/stockpilot/tree/backup/stockpilot-avant-glass-2026-11-02).

Ce sont des points de retour de code, pas des sauvegardes de données. **Ne supprimez pas le volume Docker** `stockpilot_data`.

## Application mobile gratuite (iPhone et Android)

StockPilot s'installe directement depuis **https://stockpilot.m4xim.eu**. L'application mobile utilise la même base SQLite, les mêmes comptes et les mêmes opérations que le site PC.

- **iPhone** : ouvrir StockPilot dans **Safari**, toucher **Partager**, puis **Sur l'écran d'accueil / Ajouter à l'écran d'accueil**, et ouvrir l'icône StockPilot. Aucun abonnement Apple nécessaire.
- **Android (recommandé)** : ouvrir StockPilot dans Chrome, toucher le menu **⋮**, puis **Installer l'application**. Le site fonctionne ensuite en plein écran.
- **Android (APK de test)** : [Télécharger StockPilot-Android.apk](https://github.com/m4ximeG/stockpilot/releases/download/android-latest/StockPilot-Android.apk) et autoriser l'installation externe sur l'appareil. APK construit automatiquement par [GitHub Actions](https://github.com/m4ximeG/stockpilot/actions/workflows/android-apk.yml). L'APK de test utilise une signature de débogage, qui peut changer entre compilations.
- **Scanner** : autoriser la caméra lors du premier scan. La lecture affiche toujours l'article et demande une confirmation avant de l'enlever du stock.
- **Réseau** : une connexion Internet au serveur reste nécessaire. Aucune donnée de stock, identifiant ni session n'est sauvegardé par le service worker pour un fonctionnement hors ligne.

**Important** : la publication d'une application native iOS sur l'App Store requiert l'Apple Developer Program payant. La PWA ci-dessus est la solution iPhone gratuite et installable, sans App Store. Le déploiement Docker habituel met à jour l'application sur les deux systèmes.

## Fonctionnement

1. **Entrée** : écrire le nom d'un produit. Le site suggère les références déjà connues. Si aucune référence ne correspond, il la crée pendant l'enregistrement. Le numéro de série est facultatif ; l'état est « Neuf », « Retour SAV » ou « Réparation ».
2. **Étiquetage** : chaque unité reçoit un identifiant `STK-000001`, un **code-barres Code 128** et un **QR code** dans un **PDF vectoriel d'une seule page**, exactement dimensionné pour la DYMO LabelWriter 450 : **54 × 25 mm (11352)** par défaut ou **57 × 32 mm (11354)**, à sélectionner dans Configuration. Pas de page A4 autour.
3. **Sortie** : scanner l'étiquette avec une douchette USB/Bluetooth ou une caméra compatible, ou saisir l'identifiant. Vérifier le produit, puis confirmer sa sortie. L'article disparaît du stock disponible.
4. **Suivi** : la page **Produits en stock** regroupe les unités par référence et affiche la **quantité utilisable** (les articles en SAV ou réparation sont signalés à part). La direction peut fixer un seuil de stock minimum pour déclencher l'indication **À réapprovisionner**. Les filtres « À commander » et les exports CSV présentent les quantités par référence. L'historique conserve les mouvements par unité.

La connexion à plusieurs comptes permet de conserver le nom de l'opérateur sur chaque mouvement. Les données sont centralisées dans une base SQLite persistante sur le NAS. Aucun faux stock n'est injecté en production.

## Mise à jour depuis l'ancienne version

La base existante est **préservée** : pas de suppression automatique des produits, références, mouvements ou comptes. Les anciens champs d'emplacements restent stockés pour compatibilité, mais **ne sont plus demandés, utilisés ni affichés** sur les pages normales et sur les nouvelles étiquettes.

Avant chaque mise à jour :

- Sauvegarder le volume `stockpilot_data` ou télécharger une sauvegarde depuis **Configuration**.
- Attendre la réussite des tests et du build dans GitHub Actions.
- Sur Portainer, récupérer l'image `ghcr.io/m4ximeg/stockpilot:latest` et redéployer la stack **sans supprimer le volume**.

La génération de données fictives est désactivée par défaut ; la variable historique `STOCKPILOT_DEMO_SEED` est ignorée. Les jeux d'essai utilisés en CI nécessitent `STOCKPILOT_DEV_FIXTURES=1` (ne pas activer sur le NAS).

## Configuration

Variables essentielles :

- `STOCKPILOT_ADMIN_PASSWORD` : minimum 12 caractères, obligatoire au premier démarrage.
- `STOCKPILOT_SECRET_KEY` : clé de session unique, par exemple la sortie de `openssl rand -hex 32`.
- `STOCKPILOT_ADMIN_USERNAME` : `admin` par défaut.
- `STOCKPILOT_SECURE_COOKIES` : `1` avec un domaine HTTPS ; `0` uniquement pour tester en HTTP local.
- `STOCKPILOT_ALLOW_RESET` : laisser `0` en production.

**Déploiement** : la stack `compose.yaml` publie le port 8787 du NAS vers le port 8080 du conteneur. Depuis Nginx Proxy Manager, utilisez le domaine HTTPS relié à `http://IP_DU_NAS:8787`. L'image GHCR propose les plateformes AMD64 et ARM64 après publication du build.

**DYMO LabelWriter 450** : connecter l'imprimante USB au PC du magasin et installer son pilote. Dans **Configuration → Étiquettes DYMO**, choisir la dimension du rouleau chargé (54 × 25 mm / 57 × 32 mm). Cliquer sur une étiquette ouvre un **PDF à sa taille physique exacte** : imprimer avec la DYMO, en sélectionnant le bon papier, à **100 %** (sans « Ajuster à la page », marges à zéro). La DYMO 450 USB n'est pas une imprimante AirPrint native : depuis l'iPhone, il faut passer par le PC connecté à l'imprimante ou mettre en place un serveur d'impression distinct.

**Scanner** : une douchette USB/Bluetooth configurée en mode clavier peut lire le Code 128. Le lecteur caméra web utilise `html5-qrcode` (chargé à la demande via CDN, version 2.3.8) pour lire les QR codes et les Code 128/39 sur Safari iOS, Android et ordinateurs. Il nécessite HTTPS, une caméra autorisée et un accès au CDN. La saisie manuelle reste possible ; aucun article n'est sorti sans confirmation.

Sur iPhone et PC, la navigation réduit le rebond aux limites de défilement et l'inventaire utilise une seule liste verticale, sans tableau horizontal à manipuler sur téléphone.

## Sauvegardes et sécurité

Base : `/data/stockpilot.sqlite3` dans le volume Docker `stockpilot_data`. Ne supprimez jamais ce volume lors d'un redéploiement. La page Configuration permet une sauvegarde administrative ; les comptes sont protégés par mot de passe. Il est conseillé d'accéder au site derrière un reverse proxy HTTPS plutôt que d'exposer directement le port du conteneur.

## Tests

```bash
pip install -r requirements.txt
python -m unittest discover -s tests -v
```

Les tests sont exécutés automatiquement par GitHub Actions avant la construction de l'image Docker.

Dépôt : https://github.com/m4ximeG/stockpilot
