# Programme Télé

Cette intégration affiche le programme TV des chaînes de la TNT française dans
Gladys : ce qui passe **en ce moment**, le programme **à suivre** et celui de
**ce soir**.

## Ce que vous obtenez

Un appareil par chaîne choisie (par exemple « Programme TV TF1 »), avec 3
capteurs texte :

- **En cours** — le programme diffusé maintenant, avec ses horaires
  (`JT 20h (20:00 - 20:45)`) ;
- **À suivre** — le programme suivant (`20:45 · Petits plats en équilibre`) ;
- **Ce soir** — le programme diffusé à 21h10, heure de Paris
  (`21:10 · Koh-Lanta`).

Les horaires sont toujours affichés à l'heure de Paris.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Cochez les **chaînes** à suivre (30 chaînes TNT disponibles).
3. Réglez l'**intervalle de rafraîchissement** (`poll_frequency`, en
   secondes, entre 60 et 3600, 300 par défaut) : c'est la fréquence de mise à
   jour des capteurs.
4. Enregistrez : les appareils apparaissent dans l'onglet **Découverte**,
   prêts à être ajoutés.

Le programme complet (8 jours) est téléchargé au plus toutes les 6 heures,
quelle que soit la fréquence de rafraîchissement : un intervalle court ne
charge pas le serveur de la source.

## Actions

- **Tester le programme TV** — télécharge le programme tout de suite et
  affiche ce qui passe sur la première chaîne choisie.

## Source des données

Le programme vient du flux XMLTV gratuit de [xmltvfr.fr](https://xmltvfr.fr)
(fichier TNT). Pas de compte, pas de clé d'API. L'intégration a donc besoin
d'un accès à Internet.

## Dépannage

- **« Aucun programme »** : la source n'a pas de données pour cette chaîne à
  ce moment-là.
- **Statut « déconnecté »** : le téléchargement du programme a échoué. Si un
  ancien programme est en mémoire, il continue d'être utilisé ; un nouvel
  essai est fait 15 minutes plus tard.
- Consultez les logs de l'intégration depuis l'interface Gladys (ou
  `docker logs` sur l'hôte) avec `LOG_LEVEL=debug` pour le détail complet.
