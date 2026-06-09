#
# Texting: SMS/MMS messaging service
#

* Similar architecture to email service
* Carrier compliance with 
* Schedule delivery
* Visibility across account of when and how much is being sent (gantt chart)
* Inbound, real-time delivery receipts (DLRs) and status updates from carrier
* Webhooks to receive inbound sms/mms.
* Route message to correct user, account and/or service
* MMS media management
* Opt-in / Opt-out lists and compliance keywords
* Support of SC and TF numbers.
* Rate limits per number
* Manage realtime events like OPT-OUT
* Build in survey conversations
* Mapped to account and campaign and contact
* Webhook from providers for text replies and state of the initial delivery
* Each provider has a lot of unique codes that need to get mapped back.

"Unified Delivery Framework" (UDF)

# What is similar to email and architecture:
Outbound text/<provider> queues (twilio, bandwidth) with factory adapters, retry/DLQ, idempotency — and the dispatch fairness governor in front (SMS is the original noisy-neighbor case).
Inbound via the unified webhook pipeline (webhook/texting/<provider> → verify → react → enrich → emit to analytics).
Consent/suppression from contacts; the shared branded shortener; normalized events to analytics.

# Throughput
* Limits are carrier-enforced (10DLC MPS by trust score, TFN caps, SC high), not just your policy — exceed them and carriers filter/queue silently.
* So the dispatch governor for SMS paces on two axes: per-account fairness × per-number carrier MPS.
* Number pooling/rotation — accounts use a pool for throughput/deliverability, and you select a number at send time: distribute across the pool but sticky-per-contact (a contact should always get texts from the same number, for conversation continuity). That sticky-but-balanced number selection is real routing logic email never needs.

# Compliance is stricter than email
* Quiet hours (TCPA) — no marketing texts before 8am / after 9pm in the recipient's local time. This is SMS-specific and the scheduler/dispatcher must enforce it per-recipient-timezone. * Email has no equivalent; don't forget it.
* STOP/START/HELP keywords — mandated, must be honored instantly (often at provider and your level — verify, don't assume), feeding suppression. The README has this ("compliance keywords," "realtime OPT-OUT") — just confirm the double-layer.
* Content filtering (SHAFT + URL filtering) — carriers silently filter Sex/Hate/Alcohol/Firearms/Tobacco/spam, and block public shorteners (bit.ly) — which is exactly why you need your own branded short domain (shared with email). Filtered messages often return vague/no error.

# DLRs
* DLRs are async, out-of-order, late, and sometimes never arrive — carriers don't all report reliably. So "delivered" is best-effort; design a timeout → unknown state, don't block on a DLR that never comes.
* Unknown codes → treat conservatively (don't blindly retry; a carrier rejection retried wastes throughput and looks like spam).

# 2-Way texting
"Route message to correct user/account/service" undersells it — a texting platform's core is a conversation/thread model: contact ↔ your-number ↔ account, with message history (the inbox UX). Inbound routing keys off (from contact, to your number) + the sticky-number-per-conversation to resolve context (which campaign/rep/bot). And inbound must push real-time to the web app (those audio-notification assets → WebSocket/AppSync live inbox). This thread/inbox model is arguably the biggest product surface email doesn't have to the same degree.

# Surveys
Build-in surveys = an interactive, stateful conversation state machine: send question → await reply → branch on the answer → next question, with reply timeouts ("no answer in 24h → …") and keyword/intent matching. That's qualitatively different from fire-and-forget sending — it's per-conversation state, branching, and timeouts (Step Functions or a conversation-state store fits). And the branching logic ties directly to the Liquid conditional/merge-tag work you just discussed — survey flows are conditional logic. Scope it as a real subsystem.

# MMS
* MMS → the media service (the primary consumer we predicted). Mind carrier size limits (~600KB–1.2MB practical) and that the carrier fetches a public URL — ties to media's public-signed-delivery path.
* Per-segment + per-MMS cost accounting per account (SMS bills per segment; long/multipart and MMS cost more) → billing tie-in, and the segment counter is the same one the conditional-template length warning needs.


