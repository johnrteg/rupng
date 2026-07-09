# Memory index

- [tsconfig paths re-listing](tsconfig-paths-relisting.md) — apps/core/* must re-list `@repo/*` paths (extends doesn't merge); set baseUrl
- [event-bus canonical model](event-bus-canonical-model.md) — Kafka events = object+verb+typed payload in Events.Envelope (@repo/system); object=topic; supersedes MessageEnvelope
- [AI platform secrets & routing](ai-platform-secrets-and-routing.md) — two-tier secrets (platform-shared AI keys vs service-owned) + config/ai modality→provider routing; SecretsKeyProvider; AiFactory.usePlatformSecrets in base Application
- [Provider secret-key management](provider-secret-key-management.md) — resolve provider secrets via universal @repo/system Providers registry (byId/forService → secretKey), never ad-hoc; pairs manifest provisioning + runtime read
- [Fake-provider webhook backlog](fake-provider-webhook-backlog.md) — TODO: async webhook/engagement dispatcher + 5 coverage items (#7/#10/#11/#14/#15), do once the email webhook ingress (POST /webhook/email/<provider>) exists
