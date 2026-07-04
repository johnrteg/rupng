# Memory index

- [tsconfig paths re-listing](tsconfig-paths-relisting.md) — apps/core/* must re-list `@repo/*` paths (extends doesn't merge); set baseUrl
- [event-bus canonical model](event-bus-canonical-model.md) — Kafka events = object+verb+typed payload in Events.Envelope (@repo/system); object=topic; supersedes MessageEnvelope
- [AI platform secrets & routing](ai-platform-secrets-and-routing.md) — two-tier secrets (platform-shared AI keys vs service-owned) + config/ai modality→provider routing; SecretsKeyProvider; AiFactory.usePlatformSecrets in base Application
