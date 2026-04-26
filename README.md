- Démarrage rapide

```shell
yarn init -y
yarn add dotenv zod
yarn add -D typescript tsx @types/node @biomejs/biome
npx tsc --init
touch .env .env.example && mkdir src && touch src/server.ts src/env.ts
```

- Scripts

```json
// package.json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "start": "node dist/server.js",
  "build": "tsc",
  "check": "biome check .",
  "format": "biome format . --write"
},
```

- Config moderne

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

- Biome

```json
// biome.json
{
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  }
}
```

- env file

```shell
CALENDAR_ID=<CALENDAR_ID>
CALENDAR_TIMEZONE=Europe/Paris

# Auth delegated service account (required)
GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL=<SERVICE_ACCOUNT_CLIENT_EMAIL>
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_DELEGATED_USER_EMAIL=<USER_TO_IMPERSONATE> # Same than CALENDAR_ID
```

## Depannage: erreur OpenSSL sur la cle privee

Si tu vois:

```text
Google Calendar request failed (status ERR_OSSL_UNSUPPORTED): error:1E08010C:DECODER routines::unsupported
```

verifie dans l'ordre:

1. `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` contient bien une cle PEM complete (`-----BEGIN PRIVATE KEY-----` ... `-----END PRIVATE KEY-----`).
2. Les retours a la ligne sont bien echappes en `\\n` dans la variable d'environnement (pas de sauts de ligne bruts dans le dashboard).
3. La valeur n'est pas tronquee (copie complete depuis `private_key` du JSON du service account).
4. `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL` correspond exactement a `client_email` du meme JSON.
5. Si tu utilises Render, redeploie le service apres mise a jour des variables d'environnement.

Le serveur valide maintenant la cle au demarrage de l'auth et retourne un message explicite si le format est invalide.

- Service account + delegation (Google Workspace)

1. Dans Google Cloud, active l'API Google Calendar.
2. Crée un Service Account et génère une clé JSON.
3. Copie le client email dans GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL.
4. Copie la private key dans GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY en conservant les retours ligne échappés (\n).
5. Dans Admin Google Workspace (https://admin.google.com/ac/owl?journey=218): Security > Access and data controls > API controls > Manage Domain-wide delegation.
6. Ajoute le Client ID du Service Account et le scope suivant:

```text
https://www.googleapis.com/auth/calendar.readonly
```

7. Mets GOOGLE_DELEGATED_USER_EMAIL à l'adresse utilisateur à impersonner (ex: contact@nicolasmura.fr).
8. Mets CALENDAR_ID au calendrier voulu (ex: primary ou contact@nicolasmura.fr).
9. Redémarre le serveur MCP.

Le serveur utilise uniquement l'authentification par service account délégué.

Ces variables sont obligatoires:

- GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL
- GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
- GOOGLE_DELEGATED_USER_EMAIL

- Pour le reste

https://www.freecodecamp.org/news/how-to-build-a-custom-mcp-server-with-typescript-a-handbook-for-developers

- Mode local (stdio) vs mode internet (HTTP)

Le serveur supporte maintenant 2 transports MCP:

- `stdio` (par defaut): pour usage local avec VS Code/Copilot
- `http`: pour exposition sur internet (transport Streamable HTTP)

Variables d'environnement additionnelles:

```shell
MCP_TRANSPORT=stdio # ou http
HOST=0.0.0.0
PORT=3000
```

Lancement local en stdio (comme avant):

```shell
yarn build
yarn start
```

Lancement local en HTTP:

```shell
MCP_TRANSPORT=http yarn dev
```

Endpoints HTTP:

- `POST /mcp` -> endpoint MCP
- `GET /healthz` -> healthcheck

- Deploiement en ligne (exemple Railway/Render/Fly.io)

1. Push du repo sur GitHub.
2. Cree un nouveau service Node.js sur ton provider cloud.
3. Configure la commande de build: `yarn build`
4. Configure la commande de demarrage: `yarn start`
5. Ajoute les variables d'environnement:

```shell
MCP_TRANSPORT=http
HOST=0.0.0.0
PORT=3000

CALENDAR_ID=<CALENDAR_ID>
CALENDAR_TIMEZONE=Europe/Paris
GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL=<SERVICE_ACCOUNT_CLIENT_EMAIL>
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_DELEGATED_USER_EMAIL=<USER_TO_IMPERSONATE>
```

6. Deploy.
7. Verifie `https://<ton-domaine>/healthz`.

- Deployment sur Render (service créé)

Le serveur est déjà configuré pour Render avec le fichier `render.yaml`:

1. **Détails du service Render:**
   - Service: mcp-server-google-calendar
   - URL: https://mcp-server-google-calendar.onrender.com
   - Plan: free
   - Région: Frankfurt (EU Central)
   - autoDeploy: false (déploiement manuel uniquement)
   - Dashboard: https://dashboard.render.com/web/srv-d7n0enosfn5c73dpgd20

2. **Variables d'environnement déjà configurées:**
   - `MCP_TRANSPORT=http` (transport HTTP pour Render)
   - `NODE_ENV=production`
   - `HOST=0.0.0.0`
   - `NODE_VERSION=20` (runtime Node 20.x)

3. **Étapes finales pour activer le service:**
   - Va sur le [dashboard Render](https://dashboard.render.com/web/srv-d7n0enosfn5c73dpgd20)
   - Ajoute les **variables d'environnement secrètes** (section Settings > Environment):
     ```
     CALENDAR_ID=<CALENDAR_ID>
     GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL=<SERVICE_ACCOUNT_CLIENT_EMAIL>
     GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<PRIVATE_KEY_WITH_ESCAPED_NEWLINES>
     GOOGLE_DELEGATED_USER_EMAIL=<USER_TO_IMPERSONATE>
     CALENDAR_TIMEZONE=Europe/Paris (optionnel)
     ```
   - Clique sur **"Deploy"** dans le dashboard pour lancer le premier déploiement
   - Attends que le build réussisse et le service démarre
   - Valide que `https://mcp-server-google-calendar.onrender.com/healthz` retourne HTTP 200

4. **Connexion à Copilot (remote):**
   Ajoute dans `.vscode/mcp.json`:

   ```json
   {
     "nikouzCalendarDataRemote": {
       "type": "http",
       "url": "https://mcp-server-google-calendar.onrender.com/mcp"
     }
   }
   ```

5. **Sécurité:**
   - Ne commit jamais les credentials Google (utilise le dashboard Render)
   - L'accès au /mcp est public; ajoute une auth (OAuth/Bearer) si souhaité
   - Sur plan free, le service peut hiberner après 15 min d'inactivité

- Connecter Copilot a la version distante

Dans `.vscode/mcp.json`, tu peux ajouter un serveur HTTP distant en gardant le serveur local:

```json
{
  "servers": {
    "nikouzCalendarData": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/server.js"],
      "envFile": "${workspaceFolder}/.env"
    },
    "nikouzCalendarDataRemote": {
      "type": "http",
      "url": "https://<ton-domaine>/mcp"
    }
  }
}
```

Important securite:

- Tu exposes un acces lecture agenda: protege l'URL publique (au minimum un secret de reverse proxy, idealement auth).
- Ne commit jamais les credentials Google.
