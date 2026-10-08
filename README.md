# Checklist

Petite application web **auto-hébergée** pour créer des checklists réutilisables (avec tâches, sous-tâches, sous-sous-tâches…) et les « lancer » pour les cocher au fur et à mesure. Interface pensée pour le mobile, thème clair/sombre automatique.

- **Zéro dépendance** : seulement Node.js (≥ 18). Pas de `npm install`.
- **Stockage** : un simple fichier JSON (`data/db.json`), facile à sauvegarder.
- **Multi-appareils** : une session lancée se synchronise toute seule (rafraîchissement toutes les 4 s).

## Fonctionnement

1. **Créer une checklist** (le modèle) : bouton `+` sur l'accueil, puis ajouter des tâches.
   Le bouton `+` d'une ligne ajoute une sous-tâche, le bouton `⋯` permet de déplacer, indenter/désindenter ou supprimer. La sauvegarde est automatique.
2. **Lancer** la checklist depuis l'accueil : une *session* est créée, avec tout décoché.
3. **Cocher / décocher** : cocher un parent coche tous ses enfants ; un parent se coche tout seul quand tous ses enfants le sont. Boutons « Tout cocher » / « Tout décocher ».
4. Une fois terminée, la session peut être **archivée** (elle passe dans l'historique) ou **recommencée**.

Modifier un modèle n'affecte pas les sessions déjà lancées. On peut lancer plusieurs sessions d'une même checklist.

Raccourcis clavier dans l'éditeur (sur ordinateur) : `Entrée` nouvelle tâche, `Maj+Entrée` sous-tâche, `Tab` / `Maj+Tab` indenter / désindenter, `Alt+↑/↓` déplacer, `Retour arrière` sur une tâche vide pour la supprimer.

## Installation

### Avec Docker (recommandé)

```bash
docker compose up -d --build
```

L'application est disponible sur `http://<ip-du-serveur>:3000`. Les données sont dans le volume Docker `checklist-data`.

### Sans Docker

```bash
node server.js
# ou : PORT=8080 DATA_DIR=/var/lib/checklist node server.js
```

Pour le faire tourner en service (systemd), exemple `/etc/systemd/system/checklist.service` :

```ini
[Unit]
Description=Checklist
After=network.target

[Service]
WorkingDirectory=/opt/checklist
ExecStart=/usr/bin/node server.js
Environment=PORT=3000 DATA_DIR=/var/lib/checklist
Restart=always
User=checklist

[Install]
WantedBy=multi-user.target
```

## Configuration

| Variable        | Défaut      | Description                                                   |
|-----------------|-------------|---------------------------------------------------------------|
| `PORT`          | `3000`      | Port d'écoute                                                 |
| `HOST`          | `0.0.0.0`   | Adresse d'écoute (`127.0.0.1` derrière un reverse proxy)      |
| `DATA_DIR`      | `./data`    | Dossier où est stocké `db.json`                               |
| `AUTH_USER`     | *(vide)*    | Identifiant de connexion                                      |
| `AUTH_PASSWORD` | *(vide)*    | Mot de passe. **Si défini, l'accès est protégé** (HTTP Basic) |

⚠️ Si le serveur est exposé sur Internet, définis `AUTH_USER` / `AUTH_PASSWORD` **et** mets-le derrière un reverse proxy en HTTPS (Caddy, Nginx, Traefik…), sinon le mot de passe circule en clair.

Exemple Caddy :

```
checklist.mondomaine.fr {
    reverse_proxy 127.0.0.1:3000
}
```

## Sauvegarde

Il suffit de copier `db.json` (dans `DATA_DIR`, ou dans le volume Docker). L'écriture est atomique (fichier temporaire puis renommage), donc le fichier n'est jamais à moitié écrit.

## Sur mobile

Ouvre le site dans le navigateur puis « Ajouter à l'écran d'accueil » : l'appli s'ouvre alors en plein écran comme une application.

## API

| Méthode | Route                               | Rôle                                  |
|---------|-------------------------------------|---------------------------------------|
| GET     | `/api/checklists`                   | Liste des checklists                  |
| POST    | `/api/checklists`                   | Créer `{ title, description, items }` |
| GET/PUT/DELETE | `/api/checklists/:id`        | Lire / modifier / supprimer           |
| POST    | `/api/checklists/:id/duplicate`     | Dupliquer                             |
| POST    | `/api/checklists/:id/runs`          | Lancer une session                    |
| GET     | `/api/runs`                         | Liste des sessions                    |
| GET/DELETE | `/api/runs/:id`                  | Lire / supprimer une session          |
| POST    | `/api/runs/:id/toggle`              | `{ itemId, checked }`                 |
| POST    | `/api/runs/:id/set-all`             | `{ checked }`                         |
| POST    | `/api/runs/:id/finish`              | `{ finished: true/false }` (archiver) |
| GET     | `/healthz`                          | Sonde de santé (sans authentification)|

Une tâche a la forme `{ id, text, children: [...] }` (et `checked` dans une session).
