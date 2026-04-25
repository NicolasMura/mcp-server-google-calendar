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
