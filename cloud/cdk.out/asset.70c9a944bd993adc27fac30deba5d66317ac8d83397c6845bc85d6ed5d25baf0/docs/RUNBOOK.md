# rupng — Operational Runbook

The home for **operational + incident-response runbooks** and the platform's **time-based commitments**
(SLAs / cadences / clocks). These are **processes owned by people** (security / legal / DPO / on-call /
DevOps) — *not* application code. Specs describe what the system *does*; this runbook describes what
**humans do**, and **by when**, when something happens.

> **Status: skeleton.** The decision trees + notification templates below are **stubs for security / legal /
> DPO to complete**. The **firm time commitments** (the table) are decided and traceable to their specs; the
> *process* steps are tracked here so they aren't lost in a service spec where they don't belong.

---

## 1) Security incident response (flow)

The standard loop; each step names where the capability lives.

1. **Detect** — [monitor](../apps/core/monitor/SPECS.md) consumes auth's hashed security `AuditEvent`s and
   alerts the **security on-call** (anomaly / breach-detection signals).
2. **Triage** — confirm it's real; classify **severity**; determine **was personal data involved / accessed /
   exfiltrated?** (this branches into §2).
3. **Contain** — use the platform's containment primitives:
   [auth](../apps/core/auth/specs/SPECS.md) **revocation epoch** + **session blacklist** + **IP block**; rotate
   affected secrets ([Secrets Manager](../cloud/SPECS.md)); isolate the affected component.
4. **Eradicate & recover** — remove the cause; restore service (DR procedures in [cloud](../cloud/SPECS.md) if a
   restore is needed).
5. **Notify** — if a reportable data breach, run §2 (the 72-hour clock starts at **awareness**).
6. **Post-incident review (PIR)** — root cause, timeline (reconstructable from the immutable audit trail),
   corrective actions, control updates.

**Evidence is always available:** auth's **immutable, content-hashed, verify-on-read, hash-chained**
`AuditEvent`s + the central **[audit](../apps/core/audit/SPECS.md)** service (WORM / S3 Object Lock) provide a
tamper-evident timeline for the PIR and any regulator.

---

## 2) Data-breach notification

**Owner: security / legal / DPO.** Triggered from §2 of incident response when personal data is (or may be)
compromised.

**Reportability decision (stub — legal to finalize):**
* Is **personal data** involved, and is there a **risk to the rights/freedoms** of data subjects? → assess
  under **GDPR Art 33/34** and **CCPA/CPRA**.
* Low/no risk → document the assessment (why not reportable) in the PIR; no external notice.
* Risk present → **notify** on the clocks below.

**The clocks:**

| Notification | Deadline | Basis |
|---|---|---|
| **Supervisory authority** (EU DPA) | **within 72 hours of awareness** | GDPR **Art 33** |
| **Affected data subjects** | **without undue delay** (when high risk to individuals) | GDPR **Art 34** |
| **CA residents / AG** | per statute (without unreasonable delay) | **CCPA / CPRA** §1798.82 |

**Notification package (stub — to author):** what happened, categories + approx. number of subjects/records,
likely consequences, measures taken/proposed, DPO contact. Templates + regulator/contact list: **TBD by
legal**.

**Auth's part is complete** (no code work): immutable hashed audit (forensics) + revocation/IP-block
(containment) + emit-to-monitor (detection). What remains here is the **human process** above.

---

## 3) Platform time commitments (SLAs / cadences / clocks)

The consolidated, decided time values scattered across specs — one place to see "by when." Each row links its
owning spec; **TBD** = value not yet pinned.

| Commitment | Value | Owner / spec |
|---|---|---|
| Breach → supervisory authority | **72 h** from awareness | §2 · GDPR Art 33 |
| Breach → data subjects (high risk) | without undue delay | §2 · GDPR Art 34 |
| **Security-audit retention** | **dev 1 week · prod 1 year** (configurable, per-env) | [auth `auth-19.5`](../apps/core/auth/specs/SPECS.md) |
| Central audit trail retention | **dev 1 week · prod 1 year** (configurable; per-class longer tier where required) | [audit `audit-4.1`](../apps/core/audit/SPECS.md) |
| **DR — RPO** | **≈ 1 hour** (hourly cross-region copy; warm-passive future ≈ seconds) | [cloud](../cloud/SPECS.md) |
| **DR — RTO** | measured by drill (target set per drill) — **TBD** | [cloud](../cloud/SPECS.md) |
| **DR — drill cadence** | **quarterly** | [cloud](../cloud/SPECS.md) |
| Backups — DynamoDB | **continuous PITR** + **hourly** cross-region copy | [cloud](../cloud/SPECS.md) · [DATABASE](../packages/services/DATABASE.md) |
| Backups — S3 | CRR **~minutes** | [cloud](../cloud/SPECS.md) |
| **Secret rotation** (platform) | **twice a year** (semi-annual) | [cloud](../cloud/SPECS.md) · [SPECS](SPECS.md) |
| BYO-key rotation reminder | **twice a year** (email) | [marketplace](../apps/core/marketplace/SPECS.md) · [SPECS](SPECS.md) |
| **GeoIP DB refresh** (`geoipupdate`) | **~weekly** | [auth RISK](../apps/core/auth/specs/RISK.md) |
| Cross-account grant window | default **30 days** (account cap ≤ platform hard ceiling) | [account](../apps/core/account/specs/SPECS.md) |
| Sending-number health bench | **24 h** default TTL | [texting](../apps/core/texting/SPECS.md) |
| Page-share session | short-retained / **auto-expire** | [app](../apps/core/app/SPECS.md) |
| Idle session timeout | **role-keyed** (varies by role) | [auth](../apps/core/auth/specs/SPECS.md) |
| **Account closure → PII purge** | prod: **retain 1 year**, then purge **+3 months** (~15 mo; configurable) | [account `account-1.6`](../apps/core/account/specs/SPECS.md) |
| Financial / invoice records | **~7 years** (legal/tax; survive PII purge) | [account `account-12.4`](../apps/core/account/specs/SPECS.md) |
| Failed-payment dunning | retry → grace → suspension — schedule **TBD** | [account `account-10.2`](../apps/core/account/specs/SPECS.md) |

---

## 4) Standard operational runbooks (pointers)

* **Disaster recovery** — restore-not-failover, manual/approved cutover, **quarterly drill**; targets above.
  See [cloud → Resilience & DR](../cloud/SPECS.md).
* **Secret rotation** — semi-annual platform rotation (Secrets Manager); BYO-key reminder emails. See
  [cloud](../cloud/SPECS.md).
* **Prod data fix / migration** — access tiers + the change ladder + safety rules. See
  [DATABASE → Production data access & change discipline](../packages/services/DATABASE.md).
* **Vendor / sub-processor governance** — execute the **DPA**, maintain the **sub-processor register**, run
  **vendor security reviews**, and **confirm each processor's data region honors residency** (e.g. **Stripe**,
  US *and* EU). Owned by **legal / procurement**. (Closes the [account](../apps/core/account/specs/SPECS.md)
  processor-governance gap on the process side.)

---

*See also: [SPECS](SPECS.md) (platform spec index) · [monitor](../apps/core/monitor/SPECS.md) (detection) ·
[audit](../apps/core/audit/SPECS.md) (immutable trail).*
