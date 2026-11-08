# Browser checks

Checks for this fork's changes, run in headless Chromium against a served copy of the site. They are run by hand before a change ships; none of them runs in CI.

## Setup

```sh
cd tools/tests
npm install --ignore-scripts
npx playwright-core install chromium-headless-shell
export CHROME_PATH=<path to the chrome-headless-shell binary that install printed>
```

Serve the repo root with its `_headers` and `_redirects` applied, the way Cloudflare Pages serves it:

```sh
node tools/tests/headers-serve.mjs . 8840
```

## Checks

| File | What it checks | Run |
| --- | --- | --- |
| `csp-check.mjs` | Every page under the real response headers: no content-security-policy violations or page errors, including an app opened in the viewer and reloaded on its `/app/` route | `node csp-check.mjs http://127.0.0.1:8840/` |
| `touch-css.mjs` | Touch screens get 16px form controls and a fully visible live-view back link; a mouse keeps the compact sizes | `node touch-css.mjs http://127.0.0.1:8840/` |
| `class-check.mjs` | Cached collection classes are re-checked on read: flipped cache entries are dropped and the views stay the same | `node class-check.mjs <base url> <contract>...` |
| `class-clean.mjs` | The cost of a clean second pass: one Multicall3 call per chain and no single probes | `node class-clean.mjs <base url> <contract>...` |
| `artwork-check.mjs` | The artwork page uses the same class re-check and still shows the artwork | `node artwork-check.mjs <base url> <chain> <contract> <token>` |
| `names-toggle.mjs` | The Settings switch for ENS names removes and restores labels and stops reverse lookups while off | `node names-toggle.mjs <base url> <wallet or ENS name>` |
| `names-offon.mjs` | Turning names off and on without a re-render labels the same element again | `node names-offon.mjs <artwork page url>` |
| `headers-serve.mjs` | Not a check: the static server above | |

Each check prints PASS or FAIL lines and exits 1 on a failure. The class and names checks read live chains through the public RPCs and ENS, so they need a network connection and real contract or wallet addresses.
