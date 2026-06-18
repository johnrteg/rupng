#
# Web Proxy
#

A **local-development front door** — it runs **on a developer's machine only and is never deployed to the
cloud.** It serves the built web app (`apps/core/web`) as static files with SPA fallback and reverse-proxies
API + WebSocket traffic to a configurable upstream, so the local web client talks to **one origin** — the
same single-origin, prefix-routed shape it gets in production.

The **upstream** it points at is a config choice (`upstreams[].target`) — which *backend you develop
against*:

1. **Local** servers / **LocalStack**
2. **Development** (AWS)
3. **Staging** (AWS)
4. **Production** (AWS)

That list is *which deployed backend the local app talks to* — **not** where the proxy is deployed. The
proxy always runs locally.

> **In the cloud there is no webproxy.** The production edge is **CloudFront** (serves the React SPA static
> from S3) **+ API Gateway** (routes `/<service>/*` by prefix to ECS/Lambda). `webproxy` exists only to
> **emulate that edge locally**, so a dev gets prod-like single-origin behavior without deploying anything.

## Status — possibly superseded by the Vite dev server *(no full build-out)*

**Vite's `server.proxy`** already gives **single-origin dev** (proxy API + WS to an upstream) with HMR — which
is most of what webproxy does. **Decision pending:** keep webproxy only if it does something Vite's proxy can't
(serving the **built `bin/`** prod-like, the Zendesk passthrough, multi-upstream switching); otherwise prefer
Vite's proxy and retire it. Either way this is a **dev-only tool — not worth a full house-style spec.**

> **⚠️ Must verify — multi-WebSocket proxying.** The web app now opens **≥2 sockets**: the notification WS
> ([realtime](../realtime/SPECS.md)) **and** the collab **Y.js** socket ([collab](../collab/SPECS.md) — a
> different protocol, likely a different upstream). The config below bridges a **single** `ws` path per upstream;
> whatever serves dev (**Vite proxy *or* webproxy**) must handle **multiple concurrent WS upgrades** to different
> upstreams. **Test this before relying on it for collab dev** — it's the one capability that could keep
> webproxy alive if Vite's proxy can't cleanly multiplex both sockets.

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
