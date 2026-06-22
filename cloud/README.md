#
# Infrastructure defintion
#

/cloud
/packages
    /cloud-specs

# Services define a `manifest`, not CDK

Each service exports a typed resource manifest — service-agnostic, no CDK/AWS coupling. Keep it in a dedicated entry (src/infra.ts) so the CDK synth pulls only the manifest, not the service's runtime code:


// packages/cloud-spec — the shared contract
export interface ResourceManifest {
  service: string;
  owns: {
    tables?:  TableSpec[];     // { key, partitionKey, sortKey?, ttlAttr?, stream? }
    queues?:  QueueSpec[];     // { key, fifo?, dlq?, visibilityTimeout? }
    buckets?: BucketSpec[];    // { key, public?, lifecycleDays? }
    secrets?: SecretSpec[];    // { key }
  };
  uses?: ResourceRef[];        // resources OWNED by other services, + access intent
}
export interface ResourceRef {
  service: string; kind: 'queue'|'bucket'|'table'|'secret'; key: string;
  access: 'read' | 'write' | 'readwrite' | 'send' | 'consume';
}

// apps/core/contact/src/infra.ts
export const manifest: ResourceManifest = {
  service: 'contact',
  owns: {
    tables:  [{ key: 'contacts', partitionKey: 'accountId', sortKey: 'contactId' }],
    queues:  [{ key: 'import', dlq: true }],
    buckets: [{ key: 'imports', lifecycleDays: 30 }],
  },
  uses: [{ service: 'media', kind: 'bucket', key: 'media', access: 'read' }],
};

* `Declare access intent`, not just resources. Because the manifest says "I consume this queue" / "read that bucket," the CDK app can derive least-privilege IAM automatically — you never hand-write policies. The declaration drives resource + permission + (below) env injection.
* `Owner vs reference`. A resource is owned by exactly one service (owns); another service that needs it uses uses (a reference). CDK grants the consumer's role access to the owner's resource. Clear ownership + controlled cross-service access.

# /cloud consumes manifests → synthesizes stacks

The CDK app imports every manifest and builds:

* A stack per service (independent deploy, isolated blast radius) from its owns.
* A shared platform stack for foundational/shared things (VPC, the shared event bus, OpenSearch, the dispatch queues) that service stacks reference.
* Wires the uses refs into IAM grants + env injection.

// /cloud/src/app.ts (sketch)
import { manifest as contact } from '@repo/contact/cloud';
import { manifest as media }   from '@repo/media/cloud';
for (const m of [contact, media, ...]) new ServiceStack(app, m, { env });

## The runtime handoff (the part that matters most): IDs back to services
Don't make services discover resources by querying AWS at runtime. Two complementary mechanisms, both keyed by logical key (`'import'`, `'contacts'`) so the service never hardcodes physical names:

1. CDK injects identifiers as env vars into the service's compute (the cleanest for your Application/Job base). When CDK creates the resource, it both grants IAM and sets the env var on the Lambda/ECS task:

`queue.grantConsumeMessages(serviceRole);`
`fn.addEnvironment('QUEUE_IMPORT_URL', queue.queueUrl);   // CDK-injected`
The service reads it via a typed resolver from cloud-spec:

`Cloud.queueUrl('import')   // → process.env.QUEUE_IMPORT_URL`
`Cloud.tableName('contacts')`

2. `SSM Parameter Store` as the registry for anything not injectable or shared across services: CDK publishes each resource's physical id under a convention path `/{env}/{service}/{kind}/{key};` services resolve logical keys at boot (cached) — fits the config-at-startup pattern in your Application base.

The shared naming/convention helpers live in cloud-spec and are used by both sides — CDK to name/publish, the service to resolve — so they can't drift:

// packages/cloud-spec
export const physicalName = (env, svc, kind, key) => `${env}-${svc}-${kind}-${key}`;
export const ssmPath      = (env, svc, kind, key) => `/${env}/${svc}/${kind}/${key}`;

(For maximum simplicity you can even skip SSM and rely purely on deterministic convention naming — both CDK and the service compute the same physical name from physicalName(...). Env injection is still nicer for Lambda; convention is the zero-plumbing fallback.)

# Don't over-abstract — give it an escape hatch
The manifest DSL will cover the common 90% (tables/queues/buckets/secrets/keys). It will never cover 100% of CDK, and you shouldn't try — that way lies reinventing CDK. So let a service also export raw CDK construct functions for bespoke needs (`src/infra.cdk.ts`) that `/cloud` composes alongside the manifest. Manifest for the routine, raw CDK for the exotic.


# ──────────────────────────────────────────────────────────────────────────────
# Building & deploying (runbook)
# ──────────────────────────────────────────────────────────────────────────────

The operational guide: build, then deploy to a real AWS environment (dev/staging/prod)
or to **LocalStack** for local development. All commands run from `/cloud` unless noted.

## Environments

The target is chosen with **CDK context**, `-c env=<name>` (default `dev`). It drives
resource naming, the 1–10 sizing, and per-environment config.

| env          | `-c env=`    | name prefix   | target                 |
|--------------|--------------|---------------|------------------------|
| `local`      | `local`      | `local-`      | LocalStack (Docker)    |
| `dev`        | `dev`        | `dev-`        | AWS dev account        |
| `staging`    | `staging`    | `staging-`    | AWS staging account    |
| `production` | `production` | `production-` | AWS production account |

## Prerequisites

- **Node** — `npm install` at the repo root (installs the CDK app's deps too).
- **AWS CLI v2** + configured profiles for real deploys (see *.aws config* below).
- **Docker** — for local development (LocalStack + dependent containers).
- **cdklocal** (`aws-cdk-local`) — installed as a dev dependency; used by the `local:*` scripts.

## Build

```bash
npm install            # repo root — once
cd cloud
npm run build          # tsc typecheck of the CDK app
npm run synth:dev      # synthesize CloudFormation only (no deploy)
```

### Service runtimes — compiled, run on `node`

Node services are **esbuild-bundled** (not run via `tsx`) so production runs plain `node`:

| Target | Entry | Build | Artifact | Runtime |
|--------|-------|-------|----------|---------|
| **ECS / Fargate** | `src/index.ts` (Fastify server) | `npm run build` | `bin/index.js` | `node bin/index.js` (the Dockerfile CMD) |
| **Lambda** | `src/lambda.ts` (exports `handler`) | `npm run build:lambda` | `bin/lambda.js` | Lambda invokes `lambda.handler` |

For a Lambda service, set the `LambdaSpec.handler` to `"lambda.handler"`; the CDK asset is
`apps/<domain>/<service>/bin` (resolved by `ServiceStack.functionCode()`). Bundles inline the
`@repo/*` workspace packages; `ajv`/`ajv-formats` stay **external** and resolve from
`node_modules` at runtime — used normally for endpoint + webhook JSON validation. They ship
in the ECS image; for a Lambda, include them in the function package (or a layer).

## Deploy to an AWS environment

Deploys target whatever AWS account your **active credentials/profile** resolve to —
select the account with a per-environment profile. Bootstrap once per account+region.

```bash
# one-time per account/region:
AWS_PROFILE=rup-dev      npm run bootstrap:dev

AWS_PROFILE=rup-dev      npm run diff:dev        # preview the change set
AWS_PROFILE=rup-dev      npm run deploy:dev
AWS_PROFILE=rup-staging  npm run deploy:staging
AWS_PROFILE=rup-prod     npm run deploy:prod     # prompts for approval (dev/staging auto-approve)
```

The CDK app reads the account/region from `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`,
which the CDK CLI populates from the active profile (region defaults to `us-east-1`).

## Local development (LocalStack)

Full guide: [`./local/README.md`](./local/README.md). Quick version:

```bash
export LOCALSTACK_AUTH_TOKEN=...     # LocalStack Pro token
npm run local:up                     # LocalStack + dependent containers
npm run local:bootstrap              # once per fresh container
npm run local:deploy                 # cdklocal deploy -c env=local
# ...
npm run local:destroy                # tear down stacks
npm run local:down                   # stop containers + wipe the volume
```

LocalStack needs **no real AWS credentials** — `cdklocal` uses dummy `test`/`test`.

## Dependent services for local

Some managed services aren't emulated by LocalStack and run as **side containers** (in
[`local/docker-compose.yml`](./local/docker-compose.yml), started by `npm run local:up`).
The CDK skips the managed versions under `env=local` and logs each skip at synth time.

| Managed (cloud)              | Local stand-in              | Why                          |
|------------------------------|-----------------------------|------------------------------|
| **MSK (Kafka)**              | Redpanda container `:9092`  | LocalStack MSK is unreliable |
| MediaConvert / RUM / Amplify | — (skipped)                 | no LocalStack support        |

Everything else (S3, SQS, SNS, DynamoDB, Lambda, API Gateway, KMS, Secrets, RDS,
ElastiCache, OpenSearch, Cognito, CloudFront, EventBridge, ECS, Batch, …) is emulated
inside **LocalStack Pro**.

## Environment variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `AWS_PROFILE` | deploy tooling | selects the AWS account/credentials (one profile per env) |
| `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION` | CDK CLI | target account/region (CLI sets from the profile; region falls back to `us-east-1`) |
| `AWS_REGION` | CLI / SDK | region for the AWS CLI and service SDK clients |
| `LOCALSTACK_AUTH_TOKEN` | local | LocalStack **Pro** token (for RDS/OpenSearch/Cognito/… emulation) |
| `AWS_ENDPOINT_URL` | local **runtime** | points a service's AWS SDK clients at LocalStack (`http://localhost:4566`) — read by `sdkConfig()` in `@repo/services` |
| `KAFKA_BROKERS` | local **runtime** | the Kafka side-container (`localhost:9092`), MSK's local stand-in |
| `ENVIRONMENT` | runtime (CDK-injected) | the env a service is running as; consumed by `CloudResolver` |

Deploy-time vars (`AWS_PROFILE`, `CDK_DEFAULT_*`) are for *you/CI* running CDK. Runtime
vars (`AWS_ENDPOINT_URL`, `KAFKA_BROKERS`, `ENVIRONMENT`) are what *services* read — the
CDK injects the resource identifiers; you set the local ones in your shell/compose.

## .aws config

Real deploys use standard AWS CLI profiles — one per environment/account. Prefer **IAM
Identity Center (SSO)**:

```ini
# ~/.aws/config
[profile rup-dev]
sso_session = rumbleup
sso_account_id = 111111111111
sso_role_name = AdministratorAccess
region = us-east-1

[profile rup-staging]
sso_session = rumbleup
sso_account_id = 222222222222
sso_role_name = AdministratorAccess
region = us-east-1

[profile rup-prod]
sso_session = rumbleup
sso_account_id = 333333333333
sso_role_name = AdministratorAccess
region = us-east-1

[sso-session rumbleup]
sso_start_url = https://rumbleup.awsapps.com/start
sso_region = us-east-1
```

**The account IDs are the critical wiring.** Each profile's `sso_account_id` is the
12-digit AWS account number for that environment — it's what binds `rup-dev` to your dev
account, `rup-prod` to prod, and so on. CDK reads it back as `CDK_DEFAULT_ACCOUNT` at
deploy time, so the stack lands in the correct account. Get them wrong and you deploy to
the wrong place.

| Field | Where it goes | What to set it to |
|-------|---------------|-------------------|
| `sso_account_id` | each `[profile …]` in `~/.aws/config` | the **12-digit account id** for that env (a *different* id for dev / staging / prod) |
| `sso_role_name`  | each `[profile …]` | the Identity Center permission set you assume in that account (e.g. `AdministratorAccess`) |
| `region`         | each `[profile …]` | the deploy region for that env |
| `sso_start_url`  | the `[sso-session …]` block | your org's Identity Center portal URL |
| `sso_region`     | the `[sso-session …]` block | the region Identity Center is hosted in |

**Where to find the account IDs:** the **IAM Identity Center** access portal (the start
URL lists every account with its id), **AWS Organizations**, or after login via
`aws sts get-caller-identity --profile rup-dev` (the `Account` field). Replace the
placeholder ids above (`111111111111`, `222222222222`, `333333333333`) with your real
per-environment account ids — and never point two environments at the same account.

```bash
aws sso login --profile rup-dev      # then: AWS_PROFILE=rup-dev npm run deploy:dev
```

Static keys (if not using SSO) go in `~/.aws/credentials` under matching `[rup-dev]` etc.
**LocalStack uses no real profile** — leave it out of the `local:*` flow entirely.

