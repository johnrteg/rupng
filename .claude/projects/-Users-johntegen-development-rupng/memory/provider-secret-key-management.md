---
name: provider-secret-key-management
description: Provider secrets are resolved through the universal @repo/system Providers registry, never ad-hoc keys
metadata:
  type: feedback
---

Any pluggable external provider (email/texting ESP, AI, browse/stock, payments) must resolve its API-key
secret through the **universal** `@repo/system` `Providers` registry — never a hand-built or service-local
secret name.

**Why:** one logical `secretKey` (`<category>-<id>`, e.g. `email-postmark`, `ai-openai`, `texting-twilio`)
maps to the physical Secrets Manager name (`<env>-<owner>-secret-<category>-<id>`) in BOTH places — CDK
manifest provisioning (`secrets: Providers.forService("<svc>").map( p => ({ key: p.secretKey, … }) )`) and the
runtime read (`this.secrets.get( secretRef )`). Divergent/ad-hoc keys break that pairing.

**How to apply:** resolve a provider's secret key with `Providers.byId( provider )?.secretKey` (universal, not
service-scoped) or fall back to the config entry's explicit `secretRef`. Provision the manifest `secrets` list
from `Providers.forService("<svc>")`. A provider with no key (e.g. SES = IAM auth) has no registry secret —
handle that branch explicitly. See `apps/core/email/src/services/EmailService.ts` `providerContext` /
`registrySecretKey`. Related: [[local-resource-env-injection]].
