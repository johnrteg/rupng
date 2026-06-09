#
# Registration / TCR
#

Manage TCR registration and status
Hook into carrier APIs where possible
RDS DB to cache items
Poll to get updates
Centraolized managment of TCR process for accounts

# State Machine:
Registration is slow and asynchronous: brand vetting (minutes–days), campaign approval (days), number provisioning after. So the core is a per-registration state machine — draft → submitted → pending-vetting → approved/rejected → number-associated → active — with rejection/remediation paths, not just a happy path. Two consequences:

* Your DB is a cache, not the source of truth. TCR/the provider owns approval status; you mirror it. So design for reconciliation, not just storage (the README's "cache items" is right — make explicit it's a projection you reconcile).
* Rejections need a human-in-the-loop workflow. Campaigns get rejected (weak use-case description, bad sample messages, opt-in flow problems). You must surface the rejection reason to the account and support edit + resubmit. That remediation loop is a first-class part of the state machine, easy to forget if you only model the approval path.

# Webhooks
"Poll to get updates" works, but invert the priority: most CSPs (Twilio, Bandwidth) and TCR offer status callbacks/webhooks (brand vetted, campaign approved/rejected) — use those for real-time, and keep polling as a periodic reconciliation sweep to catch missed webhooks and detect drift (external systems are eventually consistent and drop events). Poll only in-flight registrations, back off, and stop polling terminal states — same self-scheduling discipline as dispatch, not a constant full-table poll. (And the callbacks slot into your unified webhook/tcr pipeline.)

# CSP
* Register through your SMS providers — simpler, but brand/campaign/throughput are tied to that provider (switching providers ≈ re-registration), and registration APIs diverge more across CSPs than sending does.
* Become a direct CSP with TCR — register once, connect multiple aggregators, portable and more control — but you take on CSP membership, cost, and compliance obligations.

# Brand
* Who is the brand? For SaaS, typically each account registers its own brand (they're legally the sender; the CTIA/TCPA liability is theirs) and you're the facilitating CSP. So it's brand-per-account, which matters legally and structurally.
* It `gates onboarding`. An account can't send A2P until registered/approved, so TCR integrates with account provisioning: new account → collect brand/KYC info (EIN, business details) → submit → await approval → then enable texting.
* `Hierarchy` (account service): does a sub-account share the parent's brand or register its own? Resolve against the account hierarchy model.

# Cross Service
* TCR status is a sending precondition. The texting service must not send on a number whose campaign isn't active — sending on unregistered/rejected campaigns gets carrier-blocked and is a compliance violation. So TCR publishes campaign/number status, and texting gates sending on it.
* `Trust score` → throughput (MPS) feeds dispatch. Brand trust score / vetting determines allowed MPS, which is exactly the per-number throughput the dispatch governor must pace to. So TCR is the source of truth for per-campaign/number throughput limits that texting/dispatch consume. Make that a real published interface, not a lookup into TCR's DB.

TCR is US 10DLC specifically. Toll-free verification is a separate process, short codes another, and there are international registries. Consider framing this as the broader registration/compliance service — of which TCR/10DLC is the first implementation — so TFN verification, SC provisioning, and intl registration fit later without a new service. (Naming: "registration" or "compliance" may age better than "tcr.")