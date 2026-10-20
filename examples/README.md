# Integration examples

Both examples use the same SDK and collector, with a website origin separate from
the collector origin.

```sh
npm install
npm run build
npm run dev:collector
# In another terminal:
npm run dev:examples
```

- Script installation: <http://127.0.0.1:4311/plain/>
- React package: <http://127.0.0.1:4311/react/>
- Second website origin for isolation tests: <http://127.0.0.1:4312/plain/>

The local collector uses an in-memory fixture and `demo-site`. Nothing persists
after it stops. Its known test secret is not suitable for a deployed site.

The script example boots directly from the script tag in `plain/index.html`.
`plain/demo.js` adds the example form and lifecycle controls. It is not required
to display the widget. The React example imports the package's `/react` export;
the build bundles it with React for a self-contained browser demonstration.

Use the links beside the form to compare optional and required modes. Required
mode accepts **every** choice, including “Prefer not to say,” before enabling
the form. Submitting the example form changes only local text; it sends no
announcement to the collector. This UI gate is not server-side authorization.

Both websites use a strict Content Security Policy: external local scripts and
styles are allowed, with no inline script/style exceptions. The only API
connection permitted is to the collector. No external fonts or third-party
resources are used.

## Browser verification

Install the isolated test browsers once:

```sh
npx playwright install chromium firefox webkit
npm run build
npm run test:e2e
```

The suite starts the collector and example servers itself. Stop manually started
servers before running it. Tests cover script and React installation, actual
cross-origin recording, keyboard input, all three choices, session isolation,
restoration/reset, inaccessible storage, network failure/retry, duplicate
initialization, and React unmount cleanup.

These are deterministic integration checks. They do not establish that an
uncoached agent will volunteer an identity or detect agents that choose not to
declare one.

### macOS Firefox test runner limitation

On 20 October 2026, Chromium and WebKit passed all 17 local integration cases.
[Linux CI passed all 51 cases across Chromium, Firefox, and WebKit](https://github.com/Parallel-AI-Research/agent-identification/actions/runs/39404164376).
The bundled Firefox 157 / Playwright 1.64.1 failed before loading a page with
`Could not find profile folder`, including when using a fresh temporary profile
under `/private/tmp`. This matches
[Playwright issue #42768](https://github.com/microsoft/playwright/issues/42768):
on macOS 27, the bundled browser can still resolve Firefox's protected app-data
directory despite having a temporary test profile. The upstream fix is slated
for Playwright 1.65.

Do not change personal browser profiles or grant broad disk permissions for
these tests. Firefox remains enabled and verified in Linux CI.
Chromium and WebKit can be checked locally with:

```sh
npm run test:e2e -- --project=chromium --project=webkit
```
