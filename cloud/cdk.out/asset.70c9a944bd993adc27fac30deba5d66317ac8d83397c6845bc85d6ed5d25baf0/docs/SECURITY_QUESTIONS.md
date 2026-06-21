# Security questionnaire — design coverage review

A vendor/procurement security questionnaire, answered against the **current design** (the SPECS across the
repo). Two caveats up front:

* **Design-intent, not attestation.** The specs describe how the platform is *designed* to behave. "Covered"
  means *designed for* — **not** built, tested, or independently audited. Certifications (SOC 2, ISO 27001) are
  **targets**, not held.
* **Legend:** ✅ designed/covered · ⚠️ partial or design-intent only (incomplete / not certified) ·
  ❌ not addressed (gap) · ➖ not applicable by design.

Authoritative sources: [root SPECS § Security & compliance](SPECS.md) · [cloud/SPECS.md](../cloud/SPECS.md)
(tenets, residency, resilience/DR) · [aws/SPECS.md](../packages/services/src/aws/SPECS.md) (topology, isolation) ·
[auth SPECS](../apps/core/auth/specs/SPECS.md) + [ACCESS-FLOWS](../apps/core/auth/specs/ACCESS-FLOWS.md) ·
[audit](../apps/core/audit/SPECS.md) · [monitor § Security monitoring](../apps/core/monitor/SPECS.md) ·
[contact](../apps/core/contact/SPECS.md) · [account/PCI](../apps/core/account/specs/SPECS.md).

---

## The questionnaire

1. does product process protected health information (PHI)?
2. Have undergone a SSAE 18 / SOC 2 audit?
3. Have you completed the Cloud Security Alliance (CSA) CAIQ?
4. Have you received the Cloud Security Alliance STAR certification?
5. Do you conform with a specific security framework (e.g. NIST Cybersecurity Framework, CIS Controls, ISO 27001, etc)?
6. Can the system data be compliant with NIST SP 800-171 and/or CMMC Level 2 Standards?
7. Well documented Disaster Recovery Plan (DRP)?
8. Has a VPAT or ACR been created or updated for the product and version under consideration within the past year?
9. User accessibility standard?
10. Are access controls for accounts based on structured rules, such as RBAC, ABAC or PBAC?
11. Do you differentiate between email address and user identification?
12. Do you allow customer to specify attribute mapping for any needed information beyond user identity (e.g. eduPerson, ePPA/ePPN/ePE)?
13. Audit logs to include at least login, logout, actions performed, timestamp and source IP address?
14. Does application automatically lock the session or log-out an account after a period of inactivity?
15. Does system and application scanned for vulnerabilities prior to new release?
16. Do you enforce network segmentation between trusted and untrusted networks (e.g. Internet, DMZ, Extranet, etc.)?
17. Use a stateful packet inspection (SPI) firewall?
18. Do you use an automated IDS/IPS system to monitor for intrusions?
19. Are you employing any next-generation persistent threat (NGPT) monitoring?
20. Perform security assessment of third-party companies with which you share data?

---

## Answers

| # | Topic | Status | Summary (where) |
|---|---|---|---|
| 1 | PHI / HIPAA | ➖ | **No PHI by design** — AUP "no-PHI" acknowledgment at ToS, enforced as policy. A HIPAA tier (BAA + safeguards) is explicitly deferred. ([account](../apps/core/account/specs/SPECS.md), [auth](../apps/core/auth/specs/SPECS.md)) |
| 2 | SOC 2 / SSAE 18 | ⚠️ | **SOC 2 Type II is a target, not held.** Controls are designed toward it (immutable audit, least-priv IAM, encryption); no audit performed. ([SPECS.md](SPECS.md)) |
| 3 | CSA CAIQ | ❌ | Not completed / not mentioned. |
| 4 | CSA STAR | ❌ | Not held / not mentioned. |
| 5 | Security framework | ⚠️ | **ISO 27001 targeted**; per-service **OWASP Top-10** control mappings exist. NIST CSF / CIS Controls not explicitly mapped. Design-intent, uncertified. ([SPECS.md](SPECS.md)) |
| 6 | NIST 800-171 / CMMC L2 | ❌ | Not addressed (no government/DoD/CUI scope). Would require a separate program. |
| 7 | Documented DRP | ✅⚠️ | **Documented in [DR.md](DR.md)** — multi-AZ, same-jurisdiction paired-region backup (S3 CRR, DynamoDB PITR + hourly copy), cold active-passive, runbook, roles, **named targets** (prod **RPO ≤ 1 h / RTO ≤ 4 h**), quarterly drill. *Remaining:* run drills to validate/refine the cold RTO. |
| 8 | VPAT / ACR | ❌ | None. Accessibility is silent across all specs. |
| 9 | Accessibility standard (WCAG) | ❌ | Not addressed. No WCAG/ATAG commitment, alt-text/contrast/keyboard/screen-reader testing. |
| 10 | RBAC / ABAC / PBAC | ✅ | **Hierarchical RBAC (NIST RBAC1)** — account ladder (`SENDER<USER<BILLING<ACCOUNT`) + staff ladder (`SUPPORT<APPLICATION<ROOT`), per-endpoint `minAccess`, per-event `canConsume`, time-boxed revocable cross-account grants, API-key scopes. ([auth](../apps/core/auth/specs/SPECS.md), [endpoint](../packages/endpoint/SPECS.md)) |
| 11 | email ≠ user id | ✅ | **Opaque `userUuid` is the identity**; email/phone are identifiers, not the id, and are scrubbed on erasure while the uuid persists. ([auth](../apps/core/auth/specs/SPECS.md)) |
| 12 | Customer attribute mapping (eduPerson…) | ⚠️ | Enterprise **SSO (SAML/OIDC) + SCIM/JIT** with attribute mapping is designed; **eduPerson/ePPN/ePPA-specific** schema mapping is **not** called out. ([ACCESS-FLOWS](../apps/core/auth/specs/ACCESS-FLOWS.md)) |
| 13 | Audit logs (login/logout/action/time/IP) | ✅ | Central **WORM, PII-light, hash-chained** audit captures actor (+impersonation), action, target, timestamp, source (channel/**IP**/UA), outcome. Reads of the trail are themselves audited; legal hold supported. ([audit](../apps/core/audit/SPECS.md)) |
| 14 | Idle session lock/logout | ✅ | **Role-keyed idle timeout** (higher privilege → shorter window) + refresh-token rotation with reuse detection; revocation epoch for instant kill. ([auth](../apps/core/auth/specs/SPECS.md)) |
| 15 | Vuln scan before release | ⚠️→❌ | **Gap.** Only generated endpoint **contract/access-matrix tests** + Cognito breached-password check. No **SAST/DAST**, dependency/image scanning, or pen testing in the design. |
| 16 | Network segmentation | ✅ | **3-tier VPC** (public-edge / private-app / isolated-data, no internet route to data), least-priv **security-group chain**, **edge-only public** (API Gateway + CloudFront + WAF + Shield); no app faces the internet; admin via SSM (no bastion/SSH). ([cloud/SPECS.md](../cloud/SPECS.md)) |
| 17 | Stateful (SPI) firewall | ⚠️ | **Security Groups are stateful** firewalls + edge **WAF**. No dedicated **AWS Network Firewall / SPI appliance** for inter-tier/egress inspection. |
| 18 | IDS / IPS | ❌ | **Gap.** No GuardDuty / Network Firewall IPS / host IDS in the design. Edge has WAF + Shield only; internal/east-west traffic isn't inspected. |
| 19 | NGPT / threat monitoring | ⚠️ | **Application-level breach detection** exists (auth security events → brute-force / geo-anomaly / privilege-anomaly / data-exfil / probing alarms, dedicated security on-call). No infra threat-intel (GuardDuty / Security Hub / NGPT tooling) named. ([monitor](../apps/core/monitor/SPECS.md)) |
| 20 | Third-party security assessment | ⚠️ | Stripe governance (DPA, sub-processor register, vendor review, EU-residency) is **flagged as a legal/procurement task — not yet done**; no **systematic** vendor-risk process for the many providers (Twilio/SES/Cognito/Bedrock/Zendesk…). ([account](../apps/core/account/specs/SPECS.md)) |

---

## What's covered (design strengths)

* **Identity & access** — Cognito + self-applied MFA/step-up, passwordless (passkeys) roadmap, enumeration-neutral
  surfaces, lockout/backoff; **Hierarchical RBAC** with per-endpoint `minAccess` (generated from endpoint defs),
  per-event consume floor, revocable time-boxed grants, instant revocation epoch.
* **Multi-tenancy isolation** — `accountId`-keyed everywhere (DynamoDB PK, S3 prefix, cache key), authorizer
  derives `accountId` from the session and every query is scoped to it; sub-account isolation via `parentAccess`;
  per-tenant config/credentials/branding (reseller/white-label day-one).
* **Encryption** — KMS CMK at rest on every stateful store (Dynamo/S3/OpenSearch/SQS/Redis), per-env key,
  TLS/WSS in transit, VPC endpoints keep service-to-service off the public internet, envelope/BYOK for collab.
* **Network** — 3-tier VPC, isolated data subnets, least-priv SG chain, edge-only public (API GW/CloudFront/WAF/
  Shield), SSM-only admin.
* **Audit & privacy** — immutable WORM + hash-chained, PII-light audit trail (survives GDPR forget) separate from
  PII-dense per-service change history; **data residency enforced** (account-per-jurisdiction, CDK rejects
  cross-region except same-jurisdiction DR backup); **GDPR erasure** (anonymize-in-place), **DSAR export**,
  **CCPA opt-in** (stricter than opt-out), consent/suppression with proof, egress-erasure boundary, data
  classification table.
* **Resilience** — multi-AZ, PITR + cross-region same-jurisdiction backup, cold active-passive, quarterly DR drill,
  DLQ/redrive on every queue, fair-share `WorkQueue` (noisy-neighbor / soft DoS protection).
* **Least-privilege by construction** — IAM derived from the manifest's `uses` + access intent; no hand-written
  policies; secrets in Secrets Manager + KMS (never in code/env), semi-annual rotation.

## Gaps to address (prioritized)

**A — Likely blockers for enterprise/security review**
1. **Vuln scanning & secure SDLC (Q15):** add SAST + DAST + dependency & container (ECR) scanning to CI, a
   patch-SLA, and periodic **pen testing**. None exist in the design today.
2. **IDS/IPS & threat detection (Q18, Q19):** add **GuardDuty** (+ optionally AWS Network Firewall / Security Hub)
   for east-west and account-level threat detection; today only edge WAF/Shield + app-level alarms.
3. **Formal, owned DRP (Q7):** turn the DR *design* into a documented plan with **named RTO/RPO targets**,
   ownership, and recorded drill results.
4. **Vendor / third-party risk program (Q20):** make the Stripe-style review **systematic** — DPA/SCC,
   SOC 2/ISO attestations, residency confirmation, breach-notice SLA for every processor.
5. **Compliance attestations (Q2–Q5):** SOC 2 Type II + ISO 27001 are targets — schedule the audits; decide on
   CSA CAIQ/STAR if the market needs them.

**B — Scope / market-dependent**
6. **Accessibility (Q8, Q9):** adopt **WCAG 2.1 AA**, produce a VPAT/ACR — currently silent (needed for gov/edu/enterprise).
7. **NIST 800-171 / CMMC (Q6):** only if pursuing government/CUI workloads — would be a separate enclave + program.
8. **eduPerson / SAML attribute mapping (Q12):** if selling to edu, add the eduPerson/ePPN attribute schema to the SSO mapping.

**C — Harden the design's own flagged items**
9. **SPI / egress filtering (Q17):** consider AWS Network Firewall for inter-tier + egress allow-listing beyond SGs.
10. **Role-ladder CI guard:** the RBAC ladder reorder risk is flagged in `endpoint/SPECS.md` but there's no
    build-fail-on-diff snapshot test yet.
11. **Retention schedule:** publish a per-data-type retention calendar (audit 1 y, financials ~7 y, closure +90 d…)
    rather than scattered notes.
12. **Cross-border transfer mechanics (SCC/TIA):** the EU↔US boundary is stated; the SCC/transfer-impact-assessment
    detail is deferred.

> **Bottom line:** the **privacy/compliance and access-control design is strong and detailed** (GDPR/CCPA/PCI-SAQ-A,
> RBAC, residency, immutable audit, tenant isolation). The thinnest areas are **operational security assurance** —
> vuln scanning/pen-testing, IDS/IPS, a formal DRP, systematic vendor risk, and the **certifications themselves** —
> all of which are *programs to run*, not architecture to redesign.
