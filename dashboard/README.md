# Dashboard

The customer dashboard: sign up, add a product, get installation instructions, and manage origins, domains and the server secret. It is a thin client: the collector's owner API enforces ownership, so this app holds no database credentials.

## Run it locally

From the repository root, start the local Supabase stack and the collector's local fixture:

```sh
supabase start -x studio,imgproxy,realtime,storage-api,edge-runtime,logflare,vector,postgres-meta,postgrest,supavisor
SUPABASE_URL=http://127.0.0.1:54321 npm run dev:collector
```

Then copy `.env.example` to `.env.local`, fill it in from `supabase status`, and start the app from this folder:

```sh
npm ci
npm run dev
```

The app runs on http://127.0.0.1:3100. Local emails appear in Mailpit on http://127.0.0.1:54324.

## Test it

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

`test:e2e` needs the local stack and uses local accounts only.
