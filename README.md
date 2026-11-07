# find3r, a fork

A fork of [find3r](https://find3r.app/), Snowfro's static onchain file browser: a wallet address or ENS name in, folders of apps, Art Blocks artworks and ABX collections out, all read from public JSON-RPC endpoints. No backend, no wallet connection. This copy runs at https://find3r.thebenmeadows.com/.

The fork starts from find3r's files exactly as published onchain: BAMFS on Base Sepolia (chain 84532), org `0x1e55775e148ae8839677134f46d6937442817e58`, project 1, version 5, root `0x8914e2c3054651ce034abe9d2cf6a839361fdad37a743617e3aec76690914ecf`. Every file's hash and CID was checked against the chain on download (2026-11-06). The `upstream` branch holds those files byte for byte and nothing else; `main` is the fork. The full diff is [upstream...main](https://github.com/mdws-org/find3r/compare/upstream...main).

What changed, in plain words with a commit link per change: [changes.html](https://find3r.thebenmeadows.com/changes.html) (the same file is in this repository). In short: ENS names resolve through the Universal Resolver, so ENS v2 and offchain names work; any ENS name is accepted in the address box; wallets load about three times faster; ENS primary names appear next to addresses, with a switch in Settings; the look of thebenmeadows.com, light and dark.

## Run it

The site is static. Serve the repository root with any static file server and open `index.html`:

```
python3 -m http.server 8080 --bind 127.0.0.1
```

`_headers` carries the response headers the public host sends (Cloudflare Pages format).

## Files

- `index.html`, `app.js`: the browser (wallets, folders, collections).
- `artwork.html`, `artwork.js`: one artwork.
- `viewer.html`, `viewer.js`: opens a published app in a sandboxed frame.
- `gateway.html`, `gateway.js`: prepares a dedicated Cloudflare Worker gateway for one publication.
- `ens.js`: ENS resolution through the Universal Resolver (CCIP-Read included), shared with the ENS code on thebenmeadows.com.
- `names.js`: the ENS name labels next to addresses.
- `theme.js`, `theme-dark.css`: the light and dark theme.
- `AGENTS.md`, `llms.txt`, `agent/`, `spec/`: upstream's guide and recovery tools for agents, unchanged.

## Credits and license

find3r is by Snowfro (Erick Calderon). The upstream files carry no license file of their own; this fork keeps every upstream file and notice, names the original on every page, and lists each change. The bundled third-party notices (Async Art, Multicall3 and others) are unchanged from upstream.

## Problems

Problems with this copy go to [issues](https://github.com/mdws-org/find3r/issues), not to find3r.
