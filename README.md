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

## Synchronisation multi-appareils (3 novembre 2026)

- Tout changement d'inventaire, de quantité, d'état, de référence, de mouvement ou de configuration est détecté via **un compteur SQLite transactionnel** partagé par les processus Docker. Ce compteur est augmenté automatiquement par des triggers SQL, dans la même transaction que les données.
- PC, iPhone et Android contrôlent la révision toutes les **1,2 seconde lorsque la page est visible** et immédiatement au retour sur l'application. Si la révision n'a pas changé, aucun stock complet n'est téléchargé.
- Quand une révision change, le navigateur charge un **instantané cohérent** depuis `/api/state`. Il met à jour uniquement les compteurs et listes visibles de l'accueil, des stocks, de l'historique ou du scanner. Pas de rechargement de page, pas de nouvelle animation, pas de retour en haut.
- **Saisie protégée** : la réception en cours, les champs de recherche, le scan, les fenêtres modales, les filtres et les formulaires de configuration ne sont pas réinitialisés par une modification d'un autre appareil. Une fenêtre ouverte reste en place et affiche les données actualisées à la réouverture.
- Le système ne nécessite pas de Redis, WebSocket, service payant ou serveur tiers. Il fonctionne avec le SQLite existant et les sessions actuelles. La synchronisation prend généralement **environ 1 à 2 secondes** sur un appareil connecté, et se rattrape dès le retour au premier plan.
- L'activation des notifications sur iPhone est retenue localement et **l'abonnement Web Push est à nouveau enregistré côté serveur** au lancement, sans redemander l'autorisation. Un utilisateur peut toujours les désactiver dans les paramètres.

## Inventaire et notifications de stock (3 novembre 2026)

- La page **Produits en stock** présente les quantités par référence, sans bouton de nouvelle entrée ni navigation supplémentaire.
- Cliquer/toucher un produit ouvre une **fenêtre** listant tous les articles encore enregistrés pour cette référence : identifiants `STK-000000`, états, codes-barres et bouton **Réimprimer** pour chaque étiquette DYMO.
- Les **seuils d'alerte sont facultatifs**. Ils sont configurés dans la fenêtre produit **sur PC par un administrateur**. Sur iPhone, cette configuration est masquée et l'utilisateur consulte simplement les quantités et les alertes.
- Une notification Web Push est envoyée **uniquement lors du premier passage à la quantité minimum** lors d'une sortie de stock, ou lors de l'activation d'un nouveau seuil déjà atteint. Les sorties suivantes ne répètent pas la même alerte tant que le stock n'est pas repassé au-dessus du seuil.
- Sur iPhone, installer StockPilot sur l'écran d'accueil (iOS 16.4+) et ouvrir **l'application installée**, puis dans Produits en stock toucher **Activer** dans « Alertes sur votre téléphone ». Accepter la demande iOS. Un **push de test** est envoyé au compte connecté après l'enregistrement. Les notifications peuvent être désactivées depuis le même bouton.
- Sur Android Chrome en PWA, le même mécanisme Web Push est utilisé ; l'APK Android de test peut ne pas proposer de push si son moteur WebView ne prend pas en charge la Push API.
- **Le Web Push est gratuit** (standard du navigateur, aucun compte Apple développeur, ni Firebase requis). Il demande HTTPS, une connexion sortante vers les services Apple/Google et des notifications autorisées sur le téléphone.
- Les abonnements par utilisateur sont stockés dans SQLite, et la **clé privée VAPID** créée automatiquement dans `/data/stockpilot-vapid-private.pem`. Sauvegarder et conserver le volume persistant `/data` ; ne jamais publier ce fichier. Le service worker ne met pas en cache les informations de stock ni les identifiants.

## Fonctionnement

1. **Entrée** : écrire le nom d'un produit. Le site suggère les références déjà connues. Si aucune référence ne correspond, il la crée pendant l'enregistrement. Le numéro de série est facultatif ; l'état est « Neuf », « Retour SAV » ou « Réparation ».
2. **Étiquetage** : chaque unité reçoit un identifiant `STK-000001`, un **code-barres Code 128** et un **QR code** dans un **PDF vectoriel d'une seule page**, exactement dimensionné pour la DYMO LabelWriter 450 : **54 × 25 mm (11352)** par défaut ou **57 × 32 mm (11354)**, à sélectionner dans Configuration. Pas de page A4 autour.
3. **Sortie** : scanner l'étiquette avec une douchette USB/Bluetooth ou une caméra compatible, ou saisir l'identifiant. Vérifier le produit, puis confirmer sa sortie. L'article disparaît du stock disponible.
4. **Suivi** : l'inventaire affiche les quantités utilisables, les articles SAV/réparation sont signalés séparément. Un clic ouvre la fiche de la référence et ses étiquettes STK. Les seuils facultatifs se configurent uniquement sur PC dans la fiche, tandis que les utilisateurs de l'application installée sur iPhone peuvent recevoir une notification de réapprovisionnement. Le filtre « À commander » reste dans l'inventaire. L'export CSV est disponible sur PC uniquement.

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

## Sauvegardes automatiques et restauration

- Sauvegarde **SQLite binaire cohérente** créée automatiquement au démarrage de Gunicorn puis contrôlée toutes les 15 minutes. Une seule copie par jour UTC, sans interrompre les réceptions ni les sorties de stock.
- Conservation des **30 dernières sauvegardes quotidiennes**. Les sauvegardes sont stockées dans `/data/backups/managed/` avec les droits privés du conteneur, et non dans les fichiers publics du site.
- Dans **Paramètres sur PC → Accès employés → Sauvegardes automatiques**, un administrateur peut consulter, créer, télécharger et restaurer une sauvegarde.
- La restauration demande à la fois **RESTAURER LE STOCK** et le mot de passe de l'administrateur. Elle vérifie d'abord la base à restaurer, puis crée automatiquement une copie de sécurité de l'état actuel, avant d'effectuer le remplacement. Les autres appareils rechargent leurs données via la révision de synchronisation.
- Les comptes et les mouvements de stock font partie de la sauvegarde, ainsi que l'historique et les niveaux des étagères. Les fichiers de configuration hors SQLite, en particulier la clé VAPID `stockpilot-vapid-private.pem`, restent dans `/data` mais **ne sont pas inclus dans la sauvegarde SQLite**.
- Important : une sauvegarde située sur **le même volume que la base n'est pas une sauvegarde hors site**. Pour résister à une panne du NAS/disque, copier régulièrement le dossier `/data/backups/managed` ainsi que la clé VAPID sur un autre support (SFTP, autre NAS ou stockage externe). Ne jamais exposer ces fichiers en accès public.
- Pour les sauvegardes automatiques, il faut démarrer Gunicorn avec le fichier `gunicorn_conf.py` inclus dans l'image Docker officielle. Une exécution manuelle avec `python app.py` n'active pas le planificateur.

## Sauvegardes et sécurité

Base : `/data/stockpilot.sqlite3` dans le volume Docker `stockpilot_data`. Ne supprimez jamais ce volume lors d'un redéploiement. La page Configuration permet une sauvegarde administrative ; les comptes sont protégés par mot de passe. Il est conseillé d'accéder au site derrière un reverse proxy HTTPS plutôt que d'exposer directement le port du conteneur.

## Tests

```bash
pip install -r requirements.txt
python -m unittest discover -s tests -v
```

Les tests sont exécutés automatiquement par GitHub Actions avant la construction de l'image Docker.

Dépôt : https://github.com/m4ximeG/stockpilot

## Intégration Henrri — valorisation du stock (lecture seule)

StockPilot lit **uniquement le catalogue d'articles Henrri** pour estimer la valeur d'achat et la valeur de vente **HT** des références présentes en stock. L'application ne crée, ne modifie et ne supprime aucun document ni article chez Henrri. Seule l'authentification est faite en POST, puis la lecture des articles en GET. Aucun mouvement de stock n'est déclenché.

Dans **Portainer → Stacks → stockpilot**, définir ces variables d'environnement (ou via `.env` en Docker Compose) :

```env
HENRRI_CLIENT_ID=identifiant_fourni_par_henrri
HENRRI_CLIENT_SECRET=secret_fourni_par_henrri
HENRRI_ENVIRONMENT=production
```

Utiliser `sandbox` pour une clé de test ; `production` uniquement avec des identifiants de production. Si les clés manquent, l'intégration reste inactive et le stock fonctionne normalement. **Ne jamais publier les vrais identifiants dans GitHub ou dans JavaScript.** Avec la stack `compose.yaml`, remplir les variables dans l'environnement Portainer.

Les administrateurs voient sur le **tableau de bord** un aperçu de la valeur du stock HT, et dans **Paramètres → Henrri** le statut de connexion, le détail par référence et un bouton **Actualiser les tarifs**.

Le rapprochement se fait **exclusivement par référence produit** (sans différence entre majuscules/minuscules et sans espaces en bordure). Les produits absents de Henrri, les prix manquants et les doublons ne sont pas valorisés arbitrairement : l'interface signale une estimation partielle. Les articles en **retour SAV** ou en **réparation** ne sont pas inclus dans la valeur de stock disponible.

Les tarifs Henrri sont mis en cache pendant **une heure maximum** côté serveur ; les quantités sont recalculées à chaque consultation. Un administrateur peut forcer une actualisation. Les clés restent dans les variables du conteneur et ne sont jamais renvoyées au navigateur.

**Prérequis** : obtenir une clé Henrri donnant accès au compte réel de l'entreprise. Les clés de sandbox ne montrent que les données fictives. Vérifier les champs des articles dès réception des identifiants de production, avant de se servir des montants pour une décision comptable.

### Réception depuis Henrri

Dans **Entrée en stock**, saisir au moins deux caractères du nom ou de la référence. StockPilot affiche les correspondances de son stock local puis jusqu'à huit articles du catalogue Henrri avec **référence, prix d'achat HT et prix de vente HT**. La recherche côté serveur est temporisée dans le navigateur et utilise le catalogue Henrri mis en cache pendant une heure.

En sélectionnant un résultat Henrri, le formulaire affiche les tarifs. Lors de l'enregistrement, le serveur revérifie l'identifiant Henrri : il réutilise un produit local si sa référence existe déjà, sinon crée une référence locale liée au même code Henrri, puis enregistre **une seule entrée de stock**. Les articles Henrri sans référence propre reçoivent une clé locale stable `HENRRI-ID-<id>`. Les doublons locaux portant la même référence sont signalés et l'entrée est bloquée pour éviter une association arbitraire.

**Synchronisation à sens unique : Henrri → StockPilot** pour les désignations, références et prix ; **StockPilot reste autonome** pour les numéros de série, états, entrées, sorties et étiquettes. Aucun POST métier, ni modification de stock, de facture ou d'article n'est envoyé à Henrri.

La présence des trois variables Docker indique seulement que la configuration a été transmise ; elle ne prouve pas que l'API de production accepte les clés. En cas de réponse 401/403, d'indisponibilité du service ou de format inattendu, une erreur explicite est affichée et la saisie manuelle reste possible. Avant mise en production, vérifier un article réel dont les prix sont connus.
