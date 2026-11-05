# Agent Identification

See which AI agents use your product. Your server reports the requests that agents
sign with Web Bot Auth, which the collector verifies against the signer's published
keys, and requests whose user agent names an AI agent, which are only signals.
Nothing is added to your pages, so visitors see nothing, and agent builders install
nothing.

An optional declaration widget asks visitors to choose **AI assistant**,
**Person**, or **Prefer not to say**. Every visitor sees it, people included, so
it isn't part of the default install. Its answers are **visible, self-reported
classification**. Nothing here detects every agent, proves who an agent acts for,
or grants permissions.

The hosted collector is `https://parallel-agent-identification.vercel.app`. Use it
wherever the examples below say `https://YOUR-COLLECTOR`.

## Report agents from your server

Install the package and add two calls where your server handles requests. Both skip
ordinary requests without a network call, and neither throws or slows the response.
Keep the site's secret in `AGENT_ID_SITE_SECRET` on the server only.

```ts
import {
  reportRequestSignals,
  reportSignedRequest,
} from "@parallel-research/agent-identification/server";

const agentId = {
  apiUrl: "https://YOUR-COLLECTOR",
  siteId: "your-public-site-id",
  secret: process.env.AGENT_ID_SITE_SECRET!,
};

// Express:
app.use((req, res, next) => {
  void reportSignedRequest(req, agentId);
  void reportRequestSignals(req, agentId);
  next();
});
```

In Next.js, put them in `proxy.ts` and pass the URL the visitor asked for, because
Next.js rewrites the request's host to `localhost`. The dashboard's install page
and docs have that example and one for servers in other languages.

## Add the declaration widget (every visitor sees it)

Ask your collector operator for its URL and a public site ID registered for your
exact website origins. `https://example.com` and `https://www.example.com` are
separate origins. The site ID is public; the site's signing/export secret stays
on servers.

```html
<div id="visitor-choice"></div>
<script
  defer
  src="https://YOUR-COLLECTOR/sdk/v0.5.0/agent-id.js"
  data-site="YOUR-SITE-ID"
  data-target="#visitor-choice"
  data-mode="optional"
></script>
```

The script uses its own origin for the API and stylesheet by default. Set
`data-api` or `data-style` if you host the assets separately. Without `data-target`,
it appends its container to the document body.

To require a choice before using a section of the page:

```html
<div id="visitor-choice"></div>
<form id="checkout"><!-- Your existing form --></form>
<script
  defer
  src="https://YOUR-COLLECTOR/sdk/v0.5.0/agent-id.js"
  data-site="YOUR-SITE-ID"
  data-target="#visitor-choice"
  data-mode="required"
  data-gate="#checkout"
></script>
```

The widget restores the gate's original `inert` state. For no flash before
initialization, keep the form hidden with your application's loading state, then
show it after initialization.

All three answers satisfy the UI gate, and it unlocks only after the backend
acknowledges the response. A browser-only gate can be bypassed; use the server
integration below for protected actions. The widget must sit outside its gate.

Listen on the container for `agent-identification:recorded`. Its `event.detail`
contains the choice, session/event IDs, expiry, evidence label and signed receipt.
It does not contain the session bearer token.

```js
document
  .querySelector("#visitor-choice")
  .addEventListener("agent-identification:recorded", (event) => console.log(event.detail.choice));
```

## Install as a package

The collector serves a versioned npm tarball; npm registry publication is not
required:

```sh
npm install https://YOUR-COLLECTOR/downloads/parallel-research-agent-identification-0.5.0.tgz
```

```js
import { init } from "@parallel-research/agent-identification";

const widget = init({
  container: "#visitor-choice",
  siteId: "YOUR-SITE-ID",
  apiUrl: "https://YOUR-COLLECTOR",
  mode: "required",
  gate: "#checkout",
  onRecorded: (declaration) => {
    // Store the receipt in your application if using server verification.
    console.log(declaration.choice);
  },
});
await widget.ready;
```

Call `await widget.reset()` to revoke the previous collector session and start
over. Call `widget.destroy()` on unmount/navigation; it
does not revoke a session. The default storage is per-tab `sessionStorage`, scoped
to site, origin, collector and binding context. If storage is blocked it uses
memory. Choose `storage: "memory"` when persistence across reloads is unwanted.
Restoring a session always checks the server before accepting its previous answer.

### React / Next.js

```tsx
"use client";
import { AgentIdentification } from "@parallel-research/agent-identification/react";

export function VisitorChoice() {
  return (
    <AgentIdentification
      siteId="YOUR-SITE-ID"
      apiUrl="https://YOUR-COLLECTOR"
      mode="optional"
      onRecorded={(declaration) => console.log(declaration.choice)}
    />
  );
}
```

React is an optional peer dependency. Network and DOM work happen after mounting.
For required mode pass a `gate` selector pointing to an existing sibling element.
Keep `bindingContext` functions stable with `useCallback` to avoid reinitializing
the widget on every render. The component removes its instance on unmount.

## Enforce a protected action

Add two small pieces to your application's existing server:

1. An authenticated endpoint creates a short-lived binding context from the
   server's **actual current session**.
2. The protected action checks its normal permissions and calls
   `verifyDeclarationOnline` against that same active session before proceeding.

```ts
import {
  createBindingContext,
  verifyDeclarationOnline,
} from "@parallel-research/agent-identification/server";

// On your server only. Resolve the current session using your existing auth.
const settings = {
  siteId: "YOUR-SITE-ID",
  origin: "https://your-website.example",
  secret: process.env.AGENT_ID_SITE_SECRET!,
  sessionBinding: currentAuthenticatedSession.id,
};
const context = createBindingContext(settings);

// In the protected action, after normal authentication/authorization:
const declaration = await verifyDeclarationOnline(receiptFromRequest, {
  ...settings,
  apiUrl: "https://YOUR-COLLECTOR",
});
// All errors must deny/defer the action. A choice never replaces permissions.
```

Return `context` from a no-store same-origin endpoint, then provide it to
`init({ ..., bindingContext: async () => ... })`. The widget sends it to the
collector; receipts are bound to that site, origin and session. Do not accept
the expected origin/session from arbitrary browser input. Do not embed a secret
or raw login cookie in HTML. Refresh the context after expiry.

Anonymous script-only receipts deliberately **cannot** pass server verification.
Online verification also checks revocation in storage. `verifyDeclaration`
performs offline signature/binding checks only and cannot see a later revocation.
The check and your application's action are separate operations; this package
does not provide a distributed transaction or replace your authorization system.

## Browser and CSP support

The core uses standard DOM, fetch, Web Crypto and Shadow DOM, with no React or
WebMCP requirement. The automated suite targets Chromium, Firefox and WebKit.
Brave-specific settings and every browser version have not been exhaustively
tested. There is no dependency on third-party cookies.

For a restrictive Content Security Policy, allow the collector in `script-src`,
`style-src` and `connect-src`. Use external integration scripts or your existing
nonce policy. The widget uses an external stylesheet and requires no inline
script/style exceptions. Its `styleUrl` can point to your own copy of the CSS.
Versioned asset hashes are at `/sdk/v0.5.0/integrity.json`.

## Development and operating the collector

Use Node.js 24 (`nvm use` reads the included `.nvmrc`).

```sh
npm ci
npm run build
npm run dev:collector
# Separate terminal:
npm run dev:examples
```

Open `http://127.0.0.1:4311/plain/` or `/react/`. The local collector is an
in-memory fixture on port 4310. A second website origin on port 4312 exercises
isolation. Nothing in these demos requires the ticket-management app.

```sh
npm run check
npx playwright install chromium firefox webkit
npm run test:e2e
```

After deployment, supply a registered fixture site ID and its exact allowed
origins explicitly:

```sh
npm run smoke:hosted -- https://YOUR-COLLECTOR \
  --site YOUR-FIXTURE-SITE-ID \
  --origin https://fixture.example \
  --origin https://alternate.fixture.example
```

The first origin must differ from the collector and runs the browser fixture;
every supplied origin is checked for CORS, session creation and revocation.
With `AGENT_ID_SITE_SECRET` set to that
fixture site's private server secret, the smoke test also checks event export,
bound-session verification and revocation. Fixture website requests are
intercepted in the browser; the test does not read or modify those websites.
The collector must already have the fixture site and origins registered. There
is no default customer site. Sanitized results stay in ignored `.local/`.

See [operating the collector](docs/operations.md), [API contract](docs/protocol.md)
and [integration examples](examples/README.md). Production requires PostgreSQL
storage and separate secrets per site. Declarations keep the session ID, origin,
choice and timestamps, plus an agent's own name, provider and purpose when it
gives them; token/binding values are hashed in storage. Sessions are pruned after
seven days and activity events after 30. The widget records one page view per page
load with the path only: no query string or fragment, and segments that look like
IDs or email addresses masked. Turn it off with `data-page-views="off"` or
`pageViews: false`. Page titles, page text, screenshots, form contents and raw IP
addresses are never collected.

The integration tests establish implementation behavior. They do not establish
unassisted agent identification rates; measure that separately with fresh agents
and ordinary tasks.
