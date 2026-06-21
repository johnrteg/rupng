# Security & Compliance — platform overview

## Objective

This is the **single, platform-wide view** of how `rupng` is secured and what it complies with. Individual
service and package specs carry the *detailed* requirements for their own surface (auth, audit, contact,
account/PCI, …); this document **unifies** them — what we protect, the controls we apply, and where the
authoritative detail lives — plus an honest list of **architecture-impacting gaps** to address.

**Read this as design intent.** It describes how the platform is *designed* to behave. "Covered" means
*designed for* — not necessarily built, tested, or independently audited. Certifications named here (SOC 2,
ISO 27001) are **targets**, not held. The control-to-questionnaire mapping lives in
[SECURITY_QUESTIONS.md](SECURITY_QUESTIONS.md).

**Guiding principles** (the non-negotiables that recur in every service spec — see
[cloud/SPECS.md](../cloud/SPECS.md)):

* **Least privilege by construction** — IAM is *derived* from each service's manifest (`uses` + access intent);
  no hand-written policies. A service can touch only what it declares.
* **Encryption everywhere** — KMS at rest on every stateful store; TLS/WSS in transit; secrets never in code.
* **Tenant isolation day-one** — every datum is `accountId`-keyed; reseller/white-label is a first-class model.
* **Data residency by jurisdiction** — a market = an AWS account in its own region; PII never crosses jurisdiction.
* **Privacy by design** — PII-light event/audit envelopes; consent/suppression gate every send; erasure & export built in.
* **Compliance in the core flows, not bolted on** — the regulated checks (`canSend`, consent, RBAC) gate the happy path.

---

## What we cover, and how

### 1. Identity & authentication
**What:** verify who is calling, resist takeover, keep sessions safe.
**How:** AWS **Cognito** user pools; **MFA / step-up** (self-applied, escalated on role-elevation or config writes);
**passwordless roadmap** (passkeys/WebAuthn; email-OTP for low-privilege only); **enterprise SSO** (SAML/OIDC,
SCIM/JIT, optional SSO-only); **enumeration-neutral** login/reset/registration; **lockout w/ escalating backoff**;
breached-password rejection; short-lived access tokens + **refresh-token rotation with reuse detection**;
**role-keyed idle timeout** + **revocation epoch** (instant kill via Redis, no waiting on JWT expiry).
**Where:** [auth/SPECS.md](../apps/core/auth/specs/SPECS.md), [auth/ACCESS-FLOWS.md](../apps/core/auth/specs/ACCESS-FLOWS.md), [auth/RISK.md](../apps/core/auth/specs/RISK.md).

### 2. Authorization (RBAC)
**What:** every action is permitted only for a sufficiently-privileged caller.
**How:** **Hierarchical RBAC (NIST RBAC1)** — account ladder `SENDER<USER<BILLING<ACCOUNT` + staff ladder
`SUPPORT<APPLICATION<ROOT`, senior inherits junior; **per-endpoint `minAccess`** generated from `RestfulEndpoint`
defs (no drift); a **Lambda authorizer gates every API Gateway request** (JWT *or* API key → `(accountId, role,
scopes)`); **per-event consume floor** (`Events.canConsume(role, action)`) gates realtime/workflow/webhook
fan-out; **cross-account grants** are time-boxed, capped, revocable, audited; **API keys** are hashed, scoped,
role-capped. "Scale down, not up."
**Where:** [auth/SPECS.md § RBAC](../apps/core/auth/specs/SPECS.md), [endpoint/SPECS.md](../packages/endpoint/SPECS.md), [events README](../packages/system/README.md).

### 3. Multi-tenancy & isolation
**What:** one tenant can never read/affect another; reseller/white-label safe.
**How:** **`accountId`-keyed everywhere** — DynamoDB partition key, S3 object prefix (`acct/<id>/…`), cache-key
prefix; the authorizer derives `accountId` from the session and **every query is scoped to it**; sub-accounts
reach children only via explicit `parentAccess`; per-account config/credentials/branding; **a user's role is
per-account** (max in A ≠ max in B). Buckets are by-purpose (never per-tenant), tenant-prefixed inside.
**Where:** [account/SPECS.md](../apps/core/account/specs/SPECS.md), [DYNAMODB.md](../packages/cloud-manifest/docs/DYNAMODB.md), [aws/SPECS.md](../packages/services/src/aws/SPECS.md).

### 4. Encryption & key management
**What:** data unreadable at rest and in transit; keys controlled.
**How:** **KMS CMK at rest** on every stateful store (DynamoDB, S3, OpenSearch, SQS, Redis); **per-environment
CMK** (one per env-account → per-jurisdiction); **TLS/WSS in transit**; **VPC endpoints** keep service-to-service
off the public internet; **envelope encryption / BYOK** for collab (per-room DEKs); semi-annual key rotation.
The manifest **defaults resources to encrypted** — opting out is explicit + reviewed.
**Where:** [cloud/SPECS.md](../cloud/SPECS.md), [aws/SPECS.md](../packages/services/src/aws/SPECS.md), [DYNAMODB.md](../packages/cloud-manifest/docs/DYNAMODB.md).

### 5. Network security
**What:** minimize attack surface; nothing internal faces the internet.
**How:** **3-tier VPC** — public-edge (NAT only) / private-app (ALB, Fargate, Lambda) / **isolated-data** (RDS,
Redis, OpenSearch — no internet route); least-privilege **security-group chain** (edge → app → data);
**public ingress only at the edge** — API Gateway + CloudFront fronted by **WAF** (rate/bot rules) + **Shield**
(DDoS); **no application is internet-reachable directly**; admin via **SSM Session Manager** (no bastion/public SSH);
multi-AZ, per-AZ NAT in prod.
**Where:** [cloud/SPECS.md § VPC](../cloud/SPECS.md), [aws/SPECS.md](../packages/services/src/aws/SPECS.md).

### 6. Secrets management
**What:** credentials never leak; rotate them.
**How:** **Secrets Manager + KMS**; **no secrets in code/env/bundles**; per-tenant provider credentials isolated
per account; **platform secrets auto-rotate semi-annually** (off-cycle on suspected compromise); account-owned
BYO creds get rotation-reminder emails; Bedrock via IAM (no key); seed/bootstrap secrets are deploy-time only.
**Where:** [cloud/SPECS.md](../cloud/SPECS.md), [aws/SPECS.md § AppConfig](../packages/services/src/aws/SPECS.md), [auth/SPECS.md](../apps/core/auth/specs/SPECS.md).

### 7. Audit, logging, monitoring & breach detection
**What:** prove what happened; detect abuse; preserve evidence.
**How — two distinct layers:**
* **Central audit trail** — security-relevant actions (login/logout, role/grant/MFA/key changes, impersonation,
  exports, config/consent changes, billing) via `Application.audit()` → **immutable WORM** (S3 Object Lock) +
  **per-tenant hash chain** (tamper-evident), **PII-light** (ids, not values — survives GDPR forget), long
  retention, **legal hold**, and **reads of the trail are themselves audited**.
* **Field-level change history** — per-service, co-located, PII-dense before/after diffs (purges on forget).

Plus **CloudTrail** (control-plane), **transaction-id correlation** across hops, metrics/logs → OpenSearch, and a
**security-monitoring** path (brute-force / geo-anomaly / privilege-anomaly / data-exfil / probing alarms → a
dedicated security on-call; breach = detect → alert → **preserve evidence** → security+legal runbook).
**Where:** [audit/SPECS.md](../apps/core/audit/SPECS.md), [monitor/SPECS.md § Security monitoring](../apps/core/monitor/SPECS.md), [auth/SPECS.md § Audit](../apps/core/auth/specs/SPECS.md).

### 8. Data protection & privacy
**What:** lawful handling of personal data across its lifecycle.
**How:**
* **Residency** — a **market = an AWS account in one region** (multi-AZ); **no cross-jurisdiction flow** (live,
  backup, logs, analytics); DR backup only to the **same-jurisdiction** paired region; **CDK enforces** the
  region pin and rejects illegal cross-region flows.
* **GDPR erasure (Art 17)** — **anonymize-in-place**: opaque `userUuid` retained, all PII scrubbed to tombstones;
  contact-forget **fans the match-set** to content services for obfuscation; irreversible + audited.
* **DSAR / portability (Art 15/20, CCPA)** — CSV export of identity/profile/roles/grants/sessions/audit; runnable
  by the subject, account admin, or root; export is itself audited.
* **Data sale/sharing** — **opt-in by default** (stricter than CCPA opt-out), scoped per purpose/recipient,
  recorded + revocable.
* **Consent & suppression** — versioned/timestamped ToS+privacy, separate marketing opt-in, per-channel consent
  with proof (TCPA), account block-list (durable DNC, **never** deleted on forget — legal-obligation), `canSend`
  gate before every send.
* **Data classification** — authoritative PII vs non-PII table drives forget/log/event hygiene; events &
  audit are **PII-light by design**.
* **Egress erasure boundary** — once data leaves to a third party the account chose, our duty = stop sending +
  disclose (the account is controller downstream).
**Where:** [SPECS.md § Security & compliance](SPECS.md), [auth/SPECS.md § Privacy](../apps/core/auth/specs/SPECS.md), [contact/SPECS.md](../apps/core/contact/SPECS.md), [account/SPECS.md](../apps/core/account/specs/SPECS.md).

### 9. Application security
**What:** safe handling of input/output and the request edge.
**How:** **ajv schema validation** at every endpoint (one definition drives client/server/docs — no drift);
**HTML sanitization** before content reaches the browser; **two security tiers** in the app BFF (authed Main vs
public-edge Public, scaled/isolated separately so an intake flood can't starve the authed app); API Gateway does
**auth + CORS + throttling**; secrets (e.g. Zendesk) stay server-side.
**Where:** [app/SPECS.md § Two security tiers](../apps/core/app/SPECS.md), [endpoint/SPECS.md](../packages/endpoint/SPECS.md).

### 10. Resilience, availability & DR
**What:** survive failures without data leaving its jurisdiction.
**How:** **multi-AZ** every stateful tier; **DynamoDB PITR** + hourly cross-region copy (≈ 1 h RPO), **S3 CRR**,
RDS continuous backup — all to the **same-jurisdiction** paired region; **cold active-passive** with manual
approved cutover; **quarterly DR drill**; **DLQ + redrive** on every queue; fair-share **`WorkQueue`** governor
(one account can't starve another — backpressure, not drops; a soft-DoS mitigation).
**Where:** **[DR.md](DR.md)** (the platform DRP — RTO/RPO targets, runbook, drills), [cloud/SPECS.md § Resilience & DR](../cloud/SPECS.md), [aws/SPECS.md § WorkQueue](../packages/services/src/aws/SPECS.md).

### 11. Secure delivery (IaC)
**What:** the platform is built the same, safe way every time.
**How:** **AWS CDK**; resources declared in typed manifests; **IAM derived from `uses` + access intent** (least
privilege, never hand-written); encryption defaults on; LocalStack parity for dev. Synthesis is pure data (no
runtime coupling), so infra is reviewable and reproducible.
**Where:** [cloud/SPECS.md](../cloud/SPECS.md), [MANIFEST.md](../packages/cloud-manifest/docs/MANIFEST.md).

---

## Compliance frameworks

| Framework | Posture | How / where |
|---|---|---|
| **SOC 2 Type II** | 🎯 Target (not audited) | Controls designed toward it: immutable audit, least-priv IAM, encryption, change mgmt. [SPECS.md](SPECS.md) |
| **ISO 27001** | 🎯 Target (not certified) | ISMS-oriented design; per-service control mappings. [SPECS.md](SPECS.md) |
| **GDPR** | ✅ Designed | Lawful basis, residency (EU-in-jurisdiction), erasure, DSAR export, consent. [auth](../apps/core/auth/specs/SPECS.md), [contact](../apps/core/contact/SPECS.md) |
| **CCPA / CPRA** | ✅ Designed | Know/delete/correct + **opt-in** for sale/share (stricter than required). [auth](../apps/core/auth/specs/SPECS.md) |
| **PCI-DSS v4.0** | ✅ Scope-minimized (**SAQ-A**) | Stripe tokenization — **PAN never enters our systems**; only ref/last4/brand stored. [account/PCI](../apps/core/account/specs/SPECS.md) |
| **TCPA / 10DLC / TCR / CTIA** | ✅ Designed | Consent, STOP, quiet hours, brand/campaign registration. [contact](../apps/core/contact/SPECS.md), [registration](../apps/core/registration/SPECS.md) |
| **CAN-SPAM / CASL** | ✅ Designed | Email consent, unsubscribe, suppression. [contact](../apps/core/contact/SPECS.md) |
| **OWASP Top-10** | ✅ Mapped per service | Each service spec carries an OWASP control mapping. |
| **HIPAA / PHI** | ➖ Out of scope | **No-PHI AUP**; a BAA tier is explicitly deferred. [account](../apps/core/account/specs/SPECS.md) |
| **NIST CSF / 800-171 / CMMC, CSA CAIQ/STAR** | ❌ Not addressed | No gov/CUI scope; no CSA assessment. |

> Per-service compliance mappings (design-intent self-assessments) live in each service's `SPECS.md` under
> **"Compliance & standards mapping."**

---

## Gaps — architecture-impacting items to investigate

These are **not yet in the design** and several would influence the architecture. Prioritized.

**A — Operational security assurance (most likely to block an enterprise/security review)**
1. **Vulnerability scanning & secure SDLC** — add **SAST + DAST**, dependency & container (**ECR**) scanning, and
   **secret-scanning** to CI; define a patch-remediation SLA; schedule **penetration testing**. *(Today: only
   generated endpoint contract/access tests + breached-password check.)*
2. **Threat detection / IDS-IPS** — **GuardDuty** is now a tracked **later** requirement
   ([cloud/SPECS.md `cloud-9.3`](../cloud/SPECS.md), severity C): enable per account over CloudTrail / VPC Flow Logs
   / DNS logs, findings → monitor's security path / Security Hub. Optionally add **AWS Network Firewall** for
   east-west/egress inspection (see #10). *(Today: edge WAF/Shield + app-level breach alarms only; no
   east-west/host intrusion detection.)*
3. **Formal, owned DRP** — ✅ **now documented** in [DR.md](DR.md): named RTO/RPO targets (prod cold-passive
   **RPO ≤ 1 h / RTO ≤ 4 h**), per-store/per-scenario tables, roll-over runbook, roles, and the quarterly drill.
   *Remaining:* run the drills to validate/refine the RTO and record outcomes (the cold RTO is a target until
   measured).
4. **Vendor / third-party risk program** — make vendor review **systematic** (DPA/SCC, SOC 2/ISO attestations,
   data-residency confirmation, breach-notice SLA) for *every* processor — Stripe, Twilio/SES, Cognito, Bedrock,
   Zendesk, etc. *(Today: Stripe review is flagged "not yet done"; no repeatable process.)*
5. **Certifications** — schedule **SOC 2 Type II** + **ISO 27001** audits; decide on **CSA CAIQ/STAR** by market.

**B — Compliance / market-dependent (may add scope or surfaces)**
6. **Accessibility** — adopt **WCAG 2.1 AA**, produce a **VPAT/ACR**. *(Today: silent across all specs — needed for
   gov/edu/enterprise.)*
7. **NIST 800-171 / CMMC (government / CUI)** — only if pursuing federal workloads. This extends the existing
   **account-per-jurisdiction residency model**: a **separate AWS account must be established for Federal
   accounts** — specifically **AWS GovCloud (US)** — as the compliance boundary for CUI (and the path to
   FedRAMP). It's the *same isolation pattern* as a market/jurisdiction account, not a new architecture: a
   dedicated GovCloud account + region, no data flow to/from the commercial accounts. Still a real program
   (800-171/CMMC controls, screened personnel, GovCloud-only services), but it slots into the residency design
   rather than redesigning it.
8. **SSO attribute schemas (eduPerson/ePPN/ePPA)** — if selling to higher-ed, extend the SAML/SCIM attribute
   mapping.
9. **Cross-border transfer mechanics** — document **SCC / transfer-impact-assessment** for any EU↔US data path
   (the boundary is stated; the legal mechanics are deferred).

**C — Hardening the design's own flagged items**
10. **Egress / inter-tier filtering (SPI)** — security groups are stateful and WAF is at the edge; consider **AWS
    Network Firewall** + **egress allow-listing** for data-tier and outbound traffic.
11. **Field-level / application-layer encryption** for the most sensitive PII (beyond KMS-at-rest) — evaluate for
    PII-dense stores; decide on tokenization/searchable-encryption trade-offs.
12. **BYOK per-account keys** — currently per-env CMK; per-account customer-managed keys are **deferred** — revisit
    if a contract requires it (touches the KMS/key-hierarchy design).
13. **RBAC ladder CI guard** — the role-ladder reorder risk is flagged in `endpoint/SPECS.md`; add a
    **snapshot/build-fail-on-diff** test so a reorder can't silently widen access.
14. **Retention schedule** — publish a **per-data-type retention calendar** (audit ~1 y, financials ~7 y, account
    closure +90 d, logs, analytics) instead of scattered notes.
15. **Incident response plan** — formalize the breach **detect→notify** runbook incl. the **GDPR 72-hour**
    notification decision owner (DPO/security/legal).
16. **SBOM & supply-chain provenance** — generate an SBOM (CycloneDX/SPDX), pin/verify dependencies, consider
    image signing.

> **Bottom line:** the **privacy, access-control, tenancy, residency, and audit design is strong and detailed**.
> The thin areas are **operational security assurance** (scanning, pen-testing, IDS/IPS, formal DRP, vendor risk)
> and the **certifications themselves** — these are mostly *programs to stand up*, not architecture to redesign.
> The clearest architecture-impacting items are **#2 (threat-detection/network-firewall)**, **#11 (field-level
> encryption)**, and **#12 (per-account BYOK)**. **#7 (Federal/GovCloud)** is a *new account following the existing
> account-per-jurisdiction pattern* — a significant program, but it slots into the residency design rather than
> changing it.

---

## Authoritative source index

| Area | Spec |
|---|---|
| Platform tenets, residency, encryption, **resilience/DR** | [cloud/SPECS.md](../cloud/SPECS.md) |
| AWS topology, tenant isolation, KMS, WorkQueue, VPC | [packages/services/src/aws/SPECS.md](../packages/services/src/aws/SPECS.md) |
| Authentication, MFA, sessions, **RBAC**, erasure/export, S2S | [apps/core/auth/specs/SPECS.md](../apps/core/auth/specs/SPECS.md) · [ACCESS-FLOWS](../apps/core/auth/specs/ACCESS-FLOWS.md) · [RISK](../apps/core/auth/specs/RISK.md) |
| **Audit trail** (WORM, PII-light, legal hold) | [apps/core/audit/SPECS.md](../apps/core/audit/SPECS.md) |
| **Security monitoring & breach detection** | [apps/core/monitor/SPECS.md](../apps/core/monitor/SPECS.md) |
| Consent, suppression, GDPR, data classification | [apps/core/contact/SPECS.md](../apps/core/contact/SPECS.md) |
| PCI / Stripe, block list, account governance | [apps/core/account/specs/SPECS.md](../apps/core/account/specs/SPECS.md) |
| 10DLC / TCR / carrier compliance | [apps/core/registration/SPECS.md](../apps/core/registration/SPECS.md) |
| Two security tiers, sanitization (BFF) | [apps/core/app/SPECS.md](../apps/core/app/SPECS.md) |
| RBAC ladders, per-endpoint minAccess | [packages/endpoint/SPECS.md](../packages/endpoint/SPECS.md) |
| Event vocabulary, per-event consume floor, PII-light envelope | [packages/system/README.md](../packages/system/README.md) |
| DynamoDB encryption & tenant key isolation | [packages/cloud-manifest/docs/DYNAMODB.md](../packages/cloud-manifest/docs/DYNAMODB.md) |
| **Questionnaire mapping** (this doc, Q&A form) | [SECURITY_QUESTIONS.md](SECURITY_QUESTIONS.md) |
