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

## Fonctionnement

1. **Entrée** : écrire le nom d'un produit. Le site suggère les références déjà connues. Si aucune référence ne correspond, il la crée pendant l'enregistrement. Le numéro de série est facultatif ; l'état est « Neuf », « Retour SAV » ou « Réparation ».
2. **Étiquetage** : chaque unité enregistrée reçoit un identifiant `STK-000001`, un **code-barres Code 128** et un **QR code** imprimables au format 70 × 50 mm.
3. **Sortie** : scanner l'étiquette avec une douchette USB/Bluetooth ou une caméra compatible, ou saisir l'identifiant. Vérifier le produit, puis confirmer sa sortie. L'article disparaît du stock disponible.
4. **Suivi** : le tableau de bord affiche les quantités, les références, les entrées/sorties du jour ; l'inventaire et l'historique sont consultables et exportables en CSV.

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

**Étiqueteuse** : installer l'imprimante thermique sur le PC de l'accueil. Le navigateur imprime les étiquettes 70 × 50 mm en utilisant le pilote de cette imprimante. L'impression automatique sans boîte de dialogue nécessiterait une intégration complémentaire.

**Scanner** : une douchette USB ou Bluetooth configurée en mode clavier peut lire le Code 128 ; sur téléphone, le lecteur caméra est proposé si le navigateur prend en charge `BarcodeDetector`. La saisie manuelle reste toujours possible.

## Sauvegardes et sécurité

Base : `/data/stockpilot.sqlite3` dans le volume Docker `stockpilot_data`. Ne supprimez jamais ce volume lors d'un redéploiement. La page Configuration permet une sauvegarde administrative ; les comptes sont protégés par mot de passe. Il est conseillé d'accéder au site derrière un reverse proxy HTTPS plutôt que d'exposer directement le port du conteneur.

## Tests

```bash
pip install -r requirements.txt
python -m unittest discover -s tests -v
```

Les tests sont exécutés automatiquement par GitHub Actions avant la construction de l'image Docker.

Dépôt : https://github.com/m4ximeG/stockpilot
