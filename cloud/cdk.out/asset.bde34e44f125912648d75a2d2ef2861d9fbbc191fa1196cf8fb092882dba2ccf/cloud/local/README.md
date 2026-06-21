# Local cloud development (LocalStack)

Run the whole AWS-backed platform on your machine: the **same CDK app** deploys to
**LocalStack** (AWS emulated in Docker) instead of a real account. No cloud credentials,
no spend, instant teardown.

## The two concepts

- **`Environment.LOCAL`** — a config *profile* (like `dev`/`staging`/`prod`). It makes
  everything tiny + disposable: 1 AZ, no NAT gateways, `RemovalPolicy.DESTROY` on every
  resource, managed MSK skipped.
- **LocalStack** — the deploy *target*. The synthesized CloudFormation is applied to a
  local container at `http://localhost:4566` via the `cdklocal` wrapper, instead of AWS.

They pair: `cdklocal deploy -c env=local`.

## Prerequisites

- Docker.
- **LocalStack Pro auth token** (this setup assumes Pro for RDS/OpenSearch/Cognito/…):
  `export LOCALSTACK_AUTH_TOKEN=...`
- `cdklocal` — installed as a dev dependency (`aws-cdk-local`), run via the npm scripts.
- *(optional)* `awslocal` — the LocalStack AWS CLI wrapper, for poking at resources:
  `pip install awscli-local`.

## Workflow (from `/cloud`)

```bash
npm run local:up          # start LocalStack (+ Kafka) via docker compose
npm run local:bootstrap   # cdklocal bootstrap (once per fresh container)
npm run local:deploy      # cdklocal deploy -c env=local  (all stacks)
# ... develop ...
npm run local:destroy     # tear down the stacks
npm run local:down        # stop + remove containers and volume
```

Resource names follow the normal convention with a `local-` prefix
(`local-widget-queue-process`, …), so `CloudResolver` resolves them exactly as in the cloud.

## What runs where

| Emulated by **LocalStack (Pro)** | Side **container** | **Skipped** locally |
|---|---|---|
| S3, SQS, SNS, DynamoDB, Lambda, API Gateway, KMS, Secrets, CloudWatch Logs, EventBridge, IAM/STS/SSM, ElastiCache, OpenSearch, Cognito, CloudFront, ECS, Batch | **Kafka** (Redpanda) standing in for MSK | MediaConvert, CloudWatch RUM, Amplify Hosting |

Skips are deliberate (no LocalStack support) and are logged at synth time as
`[local] skipping <kind> …` — never silently dropped. See [`../lib/local.ts`](../lib/local.ts)
for the capability map.

### Databases (RDS/Aurora) — prefer DynamoDB locally

**DynamoDB is the default datastore** (it runs identically in LocalStack and AWS — no proxy,
no connection pooling, no IAM-DB-user setup). Reach for **RDS/Aurora Postgres only for a
genuinely relational workload** (e.g. billing: transactions + reporting); for query-heavy
needs over DynamoDB, use **OpenSearch / analytics** instead.

If you *do* need Postgres locally, **don't rely on LocalStack RDS** (its **RDS Proxy**
emulation — which the `Database` facade depends on — is unreliable). Run a plain **`postgres`
side-container** and point the facade at it with `DB_PASSWORD` (its local branch already uses
password auth + no TLS, no proxy). The CDK's RDS-Proxy wiring is a real-AWS concern.

## Connecting your services to LocalStack

Services point their AWS SDK clients at LocalStack with `AWS_ENDPOINT_URL`. Use the shared
helper from `@repo/services`:

```ts
import { sdkConfig } from "@repo/services";
import { S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client( sdkConfig() );   // honors AWS_ENDPOINT_URL + dummy local creds
```

Set in your local service environment:

```bash
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1
export KAFKA_BROKERS=localhost:9092       # the Redpanda side-container (MSK stand-in)
```

When `AWS_ENDPOINT_URL` is unset (real deploys), `sdkConfig()` returns just the region and
the SDK uses normal credentials — so the same code runs locally and in the cloud.
