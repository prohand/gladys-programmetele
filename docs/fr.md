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

## Widget du tableau de bord

Ajoutez le widget **Programme TV** à un tableau de bord (Gladys 5.1 ou plus).
Réglages :

- **Afficher** : _En ce moment_ (avec le temps restant) ou _Ce soir (21h10)_ ;
- **Chaînes** : 8 chaînes maximum ; laissez vide pour reprendre les chaînes de
  la configuration de l'intégration.

Touchez une ligne pour lire le résumé du programme. Le widget se met à jour
tout seul quand un programme se termine.

## Scènes

**Déclencheur « Un programme TV commence »** — lance une scène au début d'un
programme. Filtres (vides = tout) :

- **Chaînes** : une ou plusieurs chaînes ;
- **Titre exact** : par exemple `Koh-Lanta` (titre exact, majuscules
  comprises ; « contient » n'est pas possible).

Variables utilisables dans les actions suivantes : chaîne, titre,
sous-titre, catégorie, heure de début, heure de fin, durée (min). Exemple :
« Quand Koh-Lanta commence sur TF1, allumer la TV et m'envoyer un message ».

Le déclencheur fonctionne pour les 30 chaînes, même celles qui ne sont pas
cochées dans la configuration. Un programme est détecté dans la minute qui
suit son début.

**Action « Lire le programme TV d'une chaîne »** — renvoie à la scène le
programme en cours, à suivre et de ce soir (texte complet, titre seul, heure).
Exemple : envoyer chaque soir à 20h « Ce soir sur France 2 : … ».

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
