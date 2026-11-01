# Dashboard

The public site and the customer dashboard. It is a thin client: the collector's owner API enforces ownership, so this app holds no database credentials.

| Address                                     | What's there                                              | Sign-in  |
| ------------------------------------------- | --------------------------------------------------------- | -------- |
| `/`                                         | Landing page                                              | No       |
| `/docs`                                     | Docs, from `content/docs`                                 | No       |
| `/changelog`                                | Updates, from `content/changelog`                         | No       |
| `/llms.txt`, `/llms-full.txt`, `/docs/*.md` | Docs for coding agents                                    | No       |
| `/dashboard`                                | Products, install instructions, origins, domains, secrets | Required |

To publish a changelog post, add an `.mdx` file to `content/changelog` with a `title`, `description` and `date`. To add a docs page, add a file to `content/docs` and list it in `meta.json`.

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

The app runs on http://127.0.0.1:3100. Deleting `.next` fixes type errors that name old routes after moving pages. Local emails appear in Mailpit on http://127.0.0.1:54324.

## Test it

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

`test:e2e` needs the local stack and uses local accounts only.
