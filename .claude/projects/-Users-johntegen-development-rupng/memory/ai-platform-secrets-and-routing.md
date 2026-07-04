---
name: ai-platform-secrets-and-routing
description: Two-tier secret model (platform-shared AI keys vs service-owned keys) + per-service config/ai modality→provider routing
metadata:
  type: project
---

The rupng AI/secrets architecture (built 2026-07-03, media-17):

**Two-tier secrets** (Secrets Manager, never AppConfig/env/.env):
- **Platform-shared AI provider keys** — `PlatformManifest.secrets` (`ai-openai`, `ai-anthropic`, …), provisioned once in `PlatformStack` (physical name `<env>-platform-secret-ai-<provider>`), passed to EVERY `ServiceStack` via `props.platformSecrets` → granted read + ARN injected as `SECRET_AI_<PROVIDER>`. Every service runs the AiFactory and needs these.
- **Service-specific keys** — that service's `owns.secrets` (e.g. media's `browse-pexels`, `browse-unsplash`). Physical name `<env>-<service>-secret-<key>`.

**Key resolution**: `@repo/ai` `SecretsKeyProvider.resolve(ref)` reads `process.env[ref]` (the injected ARN) then `GetSecretValue`. `AiFactory.usePlatformSecrets()` is called once in base `Application` ctor → sets keyProvider + `keyRef: provider => SECRET_AI_<PROVIDER>`. So `AiFactory.create({provider})` "just works" in any service.

**Routing** (non-secret, per-service): `AiRouting` model in `@repo/api` (`ai/model/AiRouting.ts`) — `Modality` enum (chat, image, video, text_to_speech, speech_to_text, speech_cloning) → `Route {provider, model?}`. Each service's `config/ai` AppConfig profile; base `Application.aiFor(modality)` reads it (withDefaults `AiRouting.DEFAULT`) and returns an `Ai` client. Mirrors the `Browse.Provider` precedent: @repo/api owns the provider *vocabulary* enum, the service owns the adapter *registry*.

Multi-field secrets (Unsplash `{appId,accessKey,secretKey}`) stored as JSON; media's `resolveKey` picks `accessKey`/`apiKey`/`key`. See [[registration-enumeration-policy]] for other fail-closed patterns.

Local keys live (deprecated) in git-ignored `.env.local`; store into LocalStack via `awslocal secretsmanager put-secret-value` after `cdklocal deploy platform-local media-local`.
