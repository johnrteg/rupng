---
name: fake-provider-webhook-backlog
description: Deferred fake-provider async webhook/engagement dispatcher + the 5 coverage items that depend on it — do once the email webhook ingress exists
metadata:
  type: project
---

The fake email service (`apps/core/fake-email`, on the `FakeService` base) has its **synchronous** behavior
built (auth, idempotency, per-recipient outcomes, bounce categories, rate-limit, latency, size limits, metrics).
The **async webhook + engagement dispatcher is deferred on purpose** — do it once the **receiving end** is in
place: the email service's webhook INGRESS `POST /webhook/email/<provider>` (default fake URL
`http://localhost:9000/webhook/email/fake`).

**To-do once that ingress end exists** — build the dispatcher in `FakeService`/`FakeEmailService`, then finish
the 5 remaining coverage items (see `apps/core/email/specs/FAKE_PROVIDER.md` "coverage checklist"):
- **#7** unsubscribe loop — `List-Unsubscribe` header + a one-click unsubscribe webhook → the per-line-instance
  opt-out (contact svc).
- **#10** webhook signing (HMAC) + retry/backoff on callback failure.
- **#11** time-control — `POST /v1/_control/advance` to fire due/pending webhooks on demand + a deterministic
  seed so CI isn't flaky.
- **#14** delivered-then-bounced async ordering (delivered, then a later hard bounce).
- **#15** DKIM/SPF/DMARC alignment reported in the delivered webhook.

The config knobs (`open`/`click`/`unsubscribe` engagement with `%` + delay window; `webhookEnabled`/`webhookUrl`)
already exist in `FakeService.Behavior` — only the dispatch is missing. Transport = a signed HTTP POST to the
provider-config URL (NOT SES→SNS mimicry).
