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
- Gladys appelle `onPoll` toutes les `poll_frequency` secondes pour chaque
  appareil. Le guide est gardé en mémoire et re-téléchargé au plus toutes les
  6 h (nouvel essai 15 min après un échec, l'ancien guide reste utilisé).
- Horaires calculés et affichés à l'heure de Paris, quel que soit le fuseau
  du conteneur.

## Configuration (manifest)

| Clé              | Type           | Défaut                                      | Rôle                                  |
| ---------------- | -------------- | ------------------------------------------- | ------------------------------------- |
| `channels`       | `multi_select` | TF1, France 2, France 3, France 5, M6, Arte | Chaînes suivies (1 appareil / chaîne) |
| `poll_frequency` | `number`       | `300` (min `60`, max `3600`)                | Intervalle de rafraîchissement (s)    |

Action : `test_guide` (« Tester le programme TV »).

## Structure

```
.
├─ index.js                          # démarrage SDK + branchement des événements
├─ src/
│  ├─ channels.js                    # liste des 30 chaînes TNT (id XMLTV + nom)
│  ├─ config.js                      # valeurs par défaut + nettoyage de la config
│  ├─ guide.js                       # téléchargement, cache et lecture du XMLTV
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
