# Gladys — Programme Télé

Intégration externe pour [Gladys Assistant](https://gladysassistant.com) : le
programme TV des chaînes de la TNT française (en cours, à suivre, ce soir).

Basée sur le template officiel
[`integration-template-js`](https://github.com/GladysAssistant/integration-template-js)
et le SDK [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

## Fonctionnement

- Source : flux XMLTV gratuit de [xmltvfr.fr](https://xmltvfr.fr)
  (`xmltv_tnt.xml.gz`, 30 chaînes, ~8 jours). Pas de compte, pas de clé.
- Un appareil Gladys par chaîne cochée, avec 3 capteurs texte en lecture
  seule : **En cours**, **À suivre**, **Ce soir** (programme à 21h10).
- Gladys appelle `onPoll` toutes les `poll_frequency` millisecondes pour chaque
  appareil. Le guide est gardé en mémoire et re-téléchargé au plus toutes les
  6 h (nouvel essai 15 min après un échec, l'ancien guide reste utilisé).
- Horaires calculés et affichés à l'heure de Paris, quel que soit le fuseau
  du conteneur.

## Widget et scènes (Gladys ≥ 5.1.0)

- **Widget `tv_guide`** : liste `card-list` des programmes « en ce moment »
  (temps restant) ou « ce soir », 8 chaînes max. `ttl_seconds` = fin du
  premier programme affiché ; `requestWidgetRefresh` quand un programme
  commence.
- **Déclencheur `programme_started`** : une vérification par minute sur les
  30 chaînes, un événement par programme qui commence (rattrapage limité à
  5 min après une coupure). Filtres : `channel` (multi_select), `title`
  (égalité exacte). Variables : `channel_name`, `title`, `sub_title`,
  `category`, `start`, `stop`, `duration_minutes`.
- **Action `get_programme`** : champ `channel`, sorties `current`,
  `current_title`, `next`, `next_title`, `next_start`, `tonight`,
  `tonight_title`, `tonight_start`, `channel_name`.

Les clés (widget, déclencheur, action, champs, variables, sorties) sont
enregistrées dans les scènes des utilisateurs : ne jamais les renommer.

## Configuration (manifest)

> `poll_frequency` est en **millisecondes** et Gladys n'accepte que 1 s, 2 s,
> 10 s, 15 s, 30 s ou 1 min (`DEVICE_POLL_FREQUENCIES` du cœur). Toute autre
> valeur fait refuser la découverte (`invalid poll frequency`). D'où un champ
> `select` et non un nombre libre.

| Clé              | Type           | Défaut                                      | Rôle                                  |
| ---------------- | -------------- | ------------------------------------------- | ------------------------------------- |
| `channels`       | `multi_select` | TF1, France 2, France 3, France 5, M6, Arte | Chaînes suivies (1 appareil / chaîne) |
| `poll_frequency` | `select`       | `60000` (1 min) ; aussi 30 s, 15 s, 10 s    | Intervalle de rafraîchissement (ms)   |

Action : `test_guide` (« Tester le programme TV »).

## Structure

```
.
├─ index.js                          # démarrage SDK + branchement des événements
├─ src/
│  ├─ channels.js                    # liste des 30 chaînes TNT (id XMLTV + nom)
│  ├─ config.js                      # valeurs par défaut + nettoyage de la config
│  ├─ guide.js                       # téléchargement, cache et lecture du XMLTV
│  ├─ widget.js                      # widget tableau de bord "tv_guide"
│  ├─ scenes.js                      # déclencheur + action de scène
│  └─ devices/
│     ├─ index.js                    # registre : 1 appareil par chaîne + actions
│     └─ tvChannel.js                # appareil "chaîne TV" (3 capteurs texte)
├─ docs/fr.md, docs/en.md            # doc utilisateur (liée depuis Gladys)
├─ gladys-assistant-integration.json # manifest
└─ Dockerfile                        # Node 24 Alpine, rootfs en lecture seule
```

## Lancer en local

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="programme-tele" \
LOG_LEVEL=debug \
npm start
```

## Vérifications

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # tests unitaires (node --test)
npx github:GladysAssistant/integration-store .   # validation du store
```

## Publier

1. Ajouter le topic GitHub `gladys-assistant-integration` au dépôt.
2. Remplacer `cover.png` (800×534 px, ≤150 Ko) — l'actuel est celui du template.
3. **Actions → Release → Run workflow** (`patch` / `minor` / `major`) : bump de
   version, tag et image multi-arch sur `ghcr.io/prohand/gladys-programmetele`.

## Licence

Apache-2.0
