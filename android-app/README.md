# StockPilot Android — application gratuite (APK)
Cette application affiche le StockPilot existant (https://stockpilot.m4xim.eu) avec un WebView sécurisé et la caméra du téléphone. Elle n'a pas de deuxième base de données : les comptes et le stock viennent toujours du serveur d'origine.

## Installation
Un workflow GitHub Actions construit automatiquement un APK de test Android et le publie sous le tag `android-latest`. Après le premier build réussi, le fichier `StockPilot-Android.apk` est disponible dans les Releases GitHub du projet. Il faut autoriser ponctuellement l'installation d'une application provenant du navigateur Android.

## Précautions
- L'APK est signé avec la clé de débogage du runner : c'est une version **interne / test**, pas une application destinée au Play Store. Cette signature peut changer d'un build à l'autre et empêcher une mise à jour sans réinstallation.
- Une connexion Internet est nécessaire. Le site HTTPS et sa base SQLite restent la source de vérité.
- L'application n'accorde la caméra qu'aux pages HTTPS de stockpilot.m4xim.eu. Aucun autre site ne reçoit cette autorisation.
- Les liens extérieurs sont ouverts hors de l'application.
- Pour un usage simple et durable, la PWA installable depuis Chrome Android / Safari iOS reste recommandée.

## Recompiler
Depuis la racine :
```sh
gradle -p android-app :app:assembleDebug
```
JDK 17, Gradle 8.11.1, Android SDK 35. Le workflow CI installe automatiquement ces dépendances.
