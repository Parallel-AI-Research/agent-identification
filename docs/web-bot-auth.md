# Web Bot Auth

Research note from 2 November 2026 for `feat-012`. Nothing here is built yet.

## What it is

An agent signs each HTTP request with [HTTP Message Signatures (RFC 9421)](https://www.rfc-editor.org/rfc/rfc9421) and sends three headers: `Signature`, `Signature-Input` and `Signature-Agent`. `Signature-Agent` names the signer's key directory, a JWKS document served at `/.well-known/http-message-signatures-directory`. The website fetches the key and checks the signature, which covers the website's own host (`@authority`) and the `Signature-Agent` header and carries creation and expiry times.

The IETF Web Bot Auth working group adopted the core protocol as [draft-ietf-webbotauth-httpsig-protocol-00](https://datatracker.ietf.org/doc/draft-ietf-webbotauth-httpsig-protocol/) on 1 September 2026. It's still a draft, so details can change.

## Who signs

As of 2 November 2026:

| Signer                           | What we found                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT agent's cloud browser    | Signs, with `Signature-Agent: https://chatgpt.com`. This comes from OpenAI's allowlisting help article as others quote it; the article refused automated reading. |
| Amazon Bedrock AgentCore Browser | Signs when the developer turns signing on. In preview since October 2025.                                                                                         |
| Google's AI browsing agent       | Signs experimentally. Google says it doesn't sign every request, and Googlebot doesn't sign.                                                                      |
| Cloudflare's signed agents       | Launched in 2025 with ChatGPT agent, Goose, Browserbase and Anchor Browser.                                                                                       |
| Anthropic, Perplexity            | Only secondary sources claim they sign. Unconfirmed.                                                                                                              |
| Payment networks                 | Visa's Trusted Agent Protocol, Mastercard Agent Pay and American Express build on Web Bot Auth, with a tag that says whether an agent is browsing or buying.      |

Cloudflare, Akamai, Vercel and HUMAN Security already verify signatures for their customers. Cloudflare publishes a `web-bot-auth` npm package and Rust crate.

## What it can't see

- **Agents in a person's own browser.** Browser extensions and AI browsers act through the person's browser, and we found no sign that they sign requests. Their traffic looks like the person's.
- **Anything that doesn't sign.** Signing is voluntary, so scripts and most crawlers stay unsigned.
- **Who the agent acts for.** A signature identifies the operator, such as OpenAI's agent, not the person or account behind it.

So Web Bot Auth gives near-certain identity for agents that sign and none for the rest. It can reach the owner's 90–100% goal only within a defined population, such as requests from operators that sign. How much agent traffic signs is a measurement for `feat-009`, not something to assume.

## How it fits

- **Server side.** Browser code can't read request headers, so the customer's server or edge reports them, or reports its CDN's verdict. Visitors see nothing.
- **One verifier.** The collector checks signatures, so every backend gets the same tested implementation from a plain HTTP call.
- **Allowlisted signers.** Keys come only from known key directories. An unknown `Signature-Agent` is recorded as an unverified claim.
- **Replays.** A signature seen before, within its validity window, is rejected.
- **Labels only.** A valid signature labels the visit with its signer and never blocks or admits anyone.
- **Supported means tested.** A signer or CDN is listed as supported only after a real request from it has been verified on the hosted collector.

## Order

`feat-012` comes straight after the activity event contract (`feat-005`), which gives a verified visit somewhere to be recorded. Heuristic signals for unsigned traffic stay in `feat-008`.

## Sources

- [RFC 9421: HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421)
- [draft-ietf-webbotauth-httpsig-protocol](https://datatracker.ietf.org/doc/draft-ietf-webbotauth-httpsig-protocol/)
- [Web Bot Auth use cases draft](https://datatracker.ietf.org/doc/draft-nottingham-webbotauth-use-cases/)
- [Google: authenticating requests with Web Bot Auth (experimental)](https://developers.google.com/crawling/docs/crawlers-fetchers/web-bot-auth)
- [OpenAI: ChatGPT agent allowlisting](https://help.openai.com/en/articles/11845367)
- [Amazon Bedrock AgentCore: reducing CAPTCHAs with Web Bot Auth](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-web-bot-auth.html)
- [Cloudflare: signed agents](https://blog.cloudflare.com/signed-agents/)
- [Cloudflare: verified bots with cryptography](https://blog.cloudflare.com/verified-bots-with-cryptography)
- [Cloudflare: securing agentic commerce with Visa and Mastercard](https://blog.cloudflare.com/secure-agentic-commerce/)
- [Visa Trusted Agent Protocol](https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications)
- [Vercel: bot verification supports Web Bot Auth](https://vercel.com/changelog/vercels-bot-verification-now-supports-web-bot-auth)
