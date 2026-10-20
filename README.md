# Agent Identification

A website-owned widget that records a visitor's explicit choice: **AI assistant**,
**Person**, or **Prefer not to say**. Install it with a script tag, JavaScript, or
the optional React component. Visitors and agent builders install nothing.

This is **visible, self-reported classification**. It does not detect every agent,
prove identity, or grant permissions. An agent can skip an optional prompt or
choose a different answer. Required mode asks every visitor to choose.

## Add it to a website

Ask your collector operator for its URL and a public site ID registered for your
exact website origins. `https://example.com` and `https://www.example.com` are
separate origins. The site ID is public; the site's signing/export secret stays
on servers.

```html
<div id="visitor-choice"></div>
<script
  defer
  src="https://YOUR-COLLECTOR/sdk/v0.1.0/agent-id.js"
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
  src="https://YOUR-COLLECTOR/sdk/v0.1.0/agent-id.js"
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
npm install https://YOUR-COLLECTOR/downloads/parallel-research-agent-identification-0.1.0.tgz
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
// Explicitly revoke and start over when appropriate, for example on logout:
await widget.reset();
// On navigation/unmount, remove listeners/DOM and restore the original UI state:
widget.destroy();
```

`reset()` revokes the previous collector session. `destroy()` only unmounts; it
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
Versioned asset hashes are at `/sdk/v0.1.0/integrity.json`.

## Development and operating the collector

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

See [operating the collector](docs/operations.md), [API contract](docs/protocol.md)
and [integration examples](examples/README.md). Production requires PostgreSQL
storage and separate secrets per site. Events retain only session IDs, origin,
choice and timestamps; token/binding values are hashed in storage. Records are
pruned after seven days. No browsing history, screenshots or form contents are
collected.

The integration tests establish implementation behavior. They do not establish
unassisted agent identification rates; measure that separately with fresh agents
and ordinary tasks.
