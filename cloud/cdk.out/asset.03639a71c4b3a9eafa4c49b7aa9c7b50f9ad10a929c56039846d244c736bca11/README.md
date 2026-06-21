# rupng

**RumbleUp** — an omnichannel marketing & engagement platform. A Turborepo + npm-workspaces monorepo
(TypeScript, Fastify on AWS ECS Fargate + Lambda, AWS CDK infrastructure, React SPA).

This is the **documentation index**. All docs live in [`docs/`](docs/); each service and package also carries
its own `SPECS.md` / `README.md` next to its code.

---

## Documentation

### Start here
| Doc | What it is |
|---|---|
| [docs/GETSTARTED.md](docs/GETSTARTED.md) | **Local dev setup** — prerequisites, install, run. |
| [docs/DEVELOP.md](docs/DEVELOP.md) | **Developing in the monorepo** — layout, day-to-day commands, and how to add a new service/package so it builds, bundles, tests, and containerizes like the rest. |

### Architecture & specs
| Doc | What it is |
|---|---|
| [docs/SPECS.md](docs/SPECS.md) | **Platform specification** — the high-level map + the **spec index** linking every service & package's detailed spec. Start here for "what the platform is." |
| [cloud/SPECS.md](cloud/SPECS.md) · [cloud/README.md](cloud/README.md) | Infrastructure **design** (tenets, residency, topology) + the **how-to** (add a service to the cloud). |
| [packages/cloud-manifest/docs/MANIFEST.md](packages/cloud-manifest/docs/MANIFEST.md) · [DYNAMODB.md](packages/cloud-manifest/docs/DYNAMODB.md) | The resource **manifest** reference + **DynamoDB** modeling (entity interface ⇄ table). |
| [packages/endpoint/SPECS.md](packages/endpoint/SPECS.md) · [packages/system/README.md](packages/system/README.md) | The API contract (one def → client/server/docs) + **`@repo/system`** — the foundation: event vocabulary (object/verb/payload), `Access` ladders, payload repository, service registry. |
| [packages/services/README.md](packages/services/README.md) (+ [DATABASE.md](packages/services/DATABASE.md)) · [packages/common/src/SPECS.md](packages/common/src/SPECS.md) | AWS facades + `Result` + fair-share queue · shared types/utils. |

### Operations
| Doc | What it is |
|---|---|
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | **Operational + incident-response runbooks** and the platform's time commitments (SLAs / cadences). Processes owned by people, not code. |
| [docs/DR.md](docs/DR.md) | **Disaster Recovery Plan** — RTO/RPO targets, backup cadence, the region-failover runbook, and the quarterly drill. |

### Security & compliance
| Doc | What it is |
|---|---|
| [docs/SECURITY_COMPLIANCE.md](docs/SECURITY_COMPLIANCE.md) | **Platform-wide security & compliance overview** — what we cover and how (with per-service pointers) + architecture-impacting gaps. |
| [docs/SECURITY_QUESTIONS.md](docs/SECURITY_QUESTIONS.md) | The vendor **security questionnaire**, answered against the design (covered / partial / gap). |

---

## Repository layout

```
apps/
  core/<service>/         # platform services (auth, account, contact, campaign, app, media, …)
  integrations/<vendor>/  # marketplace connectors (hubspot, shopify, zapier, …)
packages/
  endpoint/ events/ services/ common/ cloud-manifest/ ai/ tsconfig/
cloud/                    # AWS CDK app — synthesizes one stack per service from its manifest
docs/                     # ← all platform-level docs (this index points into them)
```

Each `apps/core/<service>` and most `packages/*` carry a `SPECS.md` (detailed requirements) and/or `README.md`
(how-to); the [spec index in docs/SPECS.md](docs/SPECS.md#spec-index) links them all.

---

## Quick start

```bash
npm install            # install workspace deps
npm run build          # turbo build all workspaces
npm run typecheck      # turbo typecheck
```

Full setup, per-service run commands, and LocalStack/CDK usage are in [docs/GETSTARTED.md](docs/GETSTARTED.md)
and [docs/DEVELOP.md](docs/DEVELOP.md).
