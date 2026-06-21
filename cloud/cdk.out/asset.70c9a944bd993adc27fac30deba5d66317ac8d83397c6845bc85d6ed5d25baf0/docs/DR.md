# Disaster Recovery Plan (DRP)

## Objective & scope

The platform's **single, authoritative disaster-recovery plan**: how `rupng` survives an availability-zone or
full-region loss (and logical data loss), the **RTO/RPO targets** each tier is held to, the **roll-over
runbook**, and how it's **drilled**. It consolidates the DR detail scattered across the specs
([cloud/SPECS.md § Resilience & DR](../cloud/SPECS.md), [aws/SPECS.md](../packages/services/src/aws/SPECS.md),
[SECURITY_COMPLIANCE.md](SECURITY_COMPLIANCE.md)) and **sets the concrete targets those specs left as "TBD"**
(cloud gap #1).

**Scope:** AZ failure, full-region failure, and logical data loss (bad write / accidental delete / corruption),
for **`production`** (and **`dev`**, which carries a passive purely to develop + rehearse the runbook cheaply).
**Out of scope:** `staging` (transient, rebuildable — no DR); cross-*jurisdiction* recovery (**forbidden** by the
residency model — see below).

> **Targets here are SLOs.** The **RPO is a hard design property** of the backup cadence. The cold-passive
> **RTO is a target validated + refined by the quarterly drill** — "an untested DR plan is not a DR plan."

---

## Principles

1. **Residency-bound DR.** Recovery is **within the same jurisdiction only** — a market's data never moves to
   another jurisdiction, *even for backup or failover*. DR is to the jurisdiction's **paired region**.
2. **Restore, not live failover.** No hot cross-region replica (residency + cost rule it out). The paired region
   is **passive**; on disaster we **restore + cut over**, we don't run active-active.
3. **Manual, approved cutover.** A full-region failure is rare and a **false-positive auto-failover is worse than
   the outage** (split-brain/flapping). Route 53 health checks **detect + alert**; the promote is **gated behind
   an approved runbook**.
4. **Back up the systems of record; reconstruct everything derived.** Keeps the backup surface (and cross-region
   cost) small.
5. **Drill it.** Execute the runbook **quarterly** against the cold-passive region to prove it works and
   **measure the real RTO**.

---

## Topology & jurisdiction pairs

Each market = its own AWS account, **single active region (multi-AZ)**, with a **passive paired region in the
same jurisdiction** holding replicated backups + reproducible IaC:

| Jurisdiction | Active (live) | Passive (DR) |
|---|---|---|
| US (commercial) | `us-east-1` | `us-west-2` |
| EU | `eu-west-1` | `eu-central-1` |
| US Federal *(future — [SECURITY_COMPLIANCE.md](SECURITY_COMPLIANCE.md) #7)* | `us-gov-west-1` | `us-gov-east-1` |

```
 ACTIVE (us-east-1)                          PASSIVE (us-west-2 — same jurisdiction)
   live traffic ─► services                   cold: backups + reproducible IaC (no live serving)
   DynamoDB ─PITR + hourly backup copy───────► restorable
   S3 ───────────CRR (continuous)────────────► replicated bucket
   config = IaC ─cdk deploy───────────────────► reproducible (not "restored")
   KMS multi-region key ─────────────────────► decrypts the backups in DR region
                     Route 53 ──detect + APPROVED cutover──► promote passive
```

---

## RTO / RPO targets (SLOs)

**Definitions:** **RPO** = max acceptable *data loss* (how far back recovery rolls). **RTO** = max acceptable
*time to restore service*.

### By scenario

| Scenario | RPO target | RTO target | Mechanism |
|---|---|---|---|
| **AZ failure** | **0** (no loss) | **< 15 min, automatic** | Multi-AZ — no manual action; autoscaling/replicas absorb it |
| **Logical loss** (bad write / accidental delete / corruption) — in-region | **seconds** (DynamoDB PITR) · ≤ 15 min (S3) · ~5 min (RDS) | **≤ 4 h** (size-dependent restore) | In-region PITR / S3 versioning / RDS tx-log restore to a chosen point |
| **Full region loss** — DR failover (**cold-passive, production**) | **≤ 1 h** (cross-region; DynamoDB-bound) | **≤ 4 h** *(target; drill-validated)* | Deploy stack + restore in paired region + DNS cutover |
| **Full region loss** — **warm-passive** *(future upgrade)* | **~seconds** | **≤ 30 min** | DynamoDB Global Tables (same-jurisdiction) + pre-deployed minimal stack |

The **binding production DR numbers are RPO ≤ 1 h, RTO ≤ 4 h** (cold-passive). Warm-passive is the upgrade path
**if a measured RTO misses 4 h or a sub-1 h RPO is contractually required**.

### By data store (the RPO comes from the backup cadence)

| Store | In-region RPO | Cross-region (DR) RPO | How |
|---|---|---|---|
| **DynamoDB** (system of record) | ~seconds (PITR, 35 d) | **~1 h** *(binding)* | PITR in-region; **AWS Backup hourly** cross-region copy (AWS Backup's 1-h floor) |
| **S3** (objects, system of record) | continuous (versioning) | **~minutes** (< 15 min w/ RTC) | Cross-region **CRR**, per-object async |
| **RDS / Aurora** (if used) | ~5 min (tx-log) | ~minutes / hourly | Continuous tx-log; cross-region snapshot/backup copy |
| **Redis / ElastiCache** | — | — | **Rebuildable** — truth in DynamoDB → cold-start |
| **OpenSearch** | — | — | **Rebuildable** — a projection → **reindex from source** |
| **Kafka / MSK** | — | — | **Transient** — idempotently re-consumed; loss bounded by consumer lag |
| **AppConfig / config** | — | — | **Config = code (IaC)** → `cdk deploy`, not restored |

> **Cross-region DR RPO ≈ 1 hour, DynamoDB-bound.** S3 is better (~minutes). Hourly is the *correct* cadence for
> cold-passive (sub-hourly = a live replica = warm). In-region logical recovery is seconds–minutes.

---

## Failure scenarios & response

1. **AZ failure** — handled automatically by multi-AZ (Fargate spreads, RDS/ElastiCache failover, DynamoDB/S3 are
   regional). No runbook; monitor confirms recovery. **RPO 0 / RTO minutes.**
2. **Logical data loss** (bad deploy, buggy write, operator error, accidental delete) — **restore in-region** to a
   point just before the event: DynamoDB PITR (any second / 35 d), S3 version restore, RDS PITR. No region
   failover. **RPO seconds–minutes / RTO ≤ 4 h.**
3. **Full-region loss** — execute the **roll-over runbook** (below) to the paired region. **RPO ≤ 1 h / RTO ≤ 4 h
   (cold).** Restore, gated cutover — not automatic.

---

## Roll-over runbook (full-region failover)

1. **Detect & alert** — Route 53 health checks + monitor alarms flag region impairment; page the DR on-call.
2. **Decide (gated)** — the **designated approver** confirms a true region loss (not a transient blip) and
   authorizes failover. *No automatic promotion.*
3. **Stand up the passive stack** — `cdk deploy` the service stacks in the paired region (cold) or scale them up
   (warm). Config is reproduced from IaC, not restored.
4. **Restore the systems of record** — **S3 is already replicated** (CRR); **restore DynamoDB** from the
   cross-region backup copy (and/or PITR); **RDS** from the cross-region snapshot. KMS **multi-region keys**
   decrypt the backups in the DR region.
5. **Reconstruct derived tiers** — **reindex OpenSearch** from source; Redis **cold-starts**; Kafka consumers
   **resume from offsets** (idempotent).
6. **Cut over** — Route 53 promotes the passive region to active.
7. **Validate** — health checks, smoke tests, `/health`, key flows (login, send, dashboard).
8. **Roll back** — when the primary region recovers, **reverse-replicate**, then fail back in a **maintenance
   window** (not under pressure).

---

## DR drill (quarterly)

Each quarter, **execute the roll-over runbook against the cold-passive `production` region** (rehearsed first in
`dev`):
* **Validate** the runbook end-to-end (deploy + restore + reindex + cutover).
* **Measure the actual RTO** — this empirical number is the real target; if it exceeds **4 h**, that's the
  trigger to **upgrade `production` to warm-passive**.
* Confirm **RPO** by checking the restored data's freshness against the 1-h objective.
* Record results (date, measured RTO, gaps found, fixes). **An untested DR plan is not a DR plan.**

---

## Roles & ownership

| Role | Owns |
|---|---|
| **Platform / SRE** | This plan, the runbook, the quarterly drill, the IaC that reproduces the stack |
| **DR on-call** | Detection triage, executing the runbook |
| **Designated approver** (on-call lead) | The **gated cutover** decision (and roll-back) |
| **Security + Legal** | The *breach/incident* notification decision (a **separate** runbook — DR ≠ breach; see [SECURITY_COMPLIANCE.md](SECURITY_COMPLIANCE.md)) |

---

## Maturity roadmap

* **Now — cold-passive** (`dev` + `production`): backups + IaC in the paired region; deploy + restore on
  disaster. RPO ≤ 1 h, RTO ≤ 4 h (target).
* **Later — warm-passive** (prod, if drills demand it): pre-deployed minimal stack + **DynamoDB Global Tables**
  (same-jurisdiction) → RPO ~seconds, RTO ≤ 30 min. Cost: ~2× DynamoDB write/storage.

## Open items / assumptions

* **Cold RTO is a target, not yet measured** — the first quarterly drills set the empirical number and decide the
  warm-passive upgrade.
* **Per-data-class recovery priority** (e.g. auth/billing before analytics) — to be ordered in the runbook detail.
* **Federal/GovCloud** DR pair is listed for when that account is established (not yet built).

## References

* [cloud/SPECS.md § Resilience & DR](../cloud/SPECS.md) — backup cadence, active-passive, register items `cloud-10.x`.
* [packages/services/src/aws/SPECS.md](../packages/services/src/aws/SPECS.md) — region/account topology, residency.
* [SECURITY_COMPLIANCE.md](SECURITY_COMPLIANCE.md) — DR in the overall posture (gap A3); residency.
* [packages/cloud-manifest/docs/DYNAMODB.md](../packages/cloud-manifest/docs/DYNAMODB.md) — PITR, backup, table provisioning.
