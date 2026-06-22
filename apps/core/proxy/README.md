#
# Proxy
#

A **development front door**. It serves the built web app (`apps/core/web`) as static files with
SPA fallback, and reverse-proxies API + WebSocket traffic to a configurable upstream — so the web
client talks to **one origin** and you choose, by config, what's behind it:

1. **Local** servers / **LocalStack**
2. **Development** (AWS)
3. **Staging** (AWS)
4. **Production** (AWS)

Switching targets is purely a config change (`upstreams[].target`) — the same proxy serves all of
them. Local-vs-AWS is just which URL the active config points at.

## How it's built

`ProxyService` extends the `@repo/services` **`Service`** base, which owns the Fastify instance, the
run/init/start lifecycle, OS-signal shutdown, error handling, and `/health`. This class only adds:
static serving, the per-upstream HTTP proxies, the WebSocket bridge, the SPA fallback, and an
optional Zendesk article passthrough.

## Run it

```bash
# dev (tsx, watch) — pick an environment config:
npm --workspace proxy run dev -- --config local       # → http://localhost:8080
npm --workspace proxy run dev -- --config development
```

Config is selected by `--config <name>` (matching `src/config/<name>.json`), or — when no flag is
given — from the `ENVIRONMENT` env var (`local`→local, `dev`→development, …), defaulting to
`production`.

## Configuration

One file per environment under `src/config/*.json`, typed by `ProxyService.Config`:

```jsonc
{
  "web": {                       // the built apps/core/web to serve
    "root": "../../web/bin",     // dir with index.html + assets (resolved from this module; or set PROXY_WEB_ROOT)
    "index": "index.html",
    "prefix": "/",
    "spaFallback": true          // unmatched GETs → index.html (client-side routing)
  },
  "upstreams": [                 // where API + WS traffic is forwarded
    {
      "name": "local",
      "target": "http://localhost:8000",   // ← LocalStack/local here, or an AWS env URL
      "ws": "/account/ws",                  // optional: WebSocket path to bridge
      "prefixes": ["/auth", "/account", "..."]
    }
  ],
  "zendesk": {                   // optional /article passthrough
    "baseUrl": "https://rumbleup.zendesk.com",
    "email": "admin@rumbleup.com",
    "tokenEnv": "ZENDESK_API_TOKEN"         // token comes from this ENV VAR — never committed
  }
}
```

Env overrides: `PORT` (default 8080), `PROXY_WEB_ROOT` (web static dir), `PROXY_CONFIG_DIR`
(where the config files live — needed when running the **bundled** build, since `src/config` is not
bundled into `bin/`).

> **Prerequisite — the web app's static build.** `web.root` points at **`apps/core/web/bin`** (its
> build output, resolved relative to this module). The web app must emit `index.html` + assets there
> before the proxy can serve the site; until then static requests 404 (the proxies/WS still work).
> Override with `PROXY_WEB_ROOT` if it emits elsewhere.
