#
# Dispatch Service
#

Objective: Since AWS SQS is a `blind` queue in that there is not a way to query the queue and find out information about what is in the queue (e.g. account id), to layer a database before SQS to keep track of pending, in process and completed items in the queue and use that database to govern what gets sent onto the queue for downstream processing at regualr intervals (TBD).  Wanting to avoid where one account may dominate the backlog of the queue and block newer items from getting thru.  For example, account A palces 100,000 messages to be emailed out.  Account B then places 10 messages to be emailed out.  It could be a substaintial amount of time before account B's messages are sent.  Want to have some fairness on the distribution of messages that SQS alone cannot manage.

# This may fall into a package library that various services can implement

Dispatching is channel specific and may need unique rules to govern.

From Claude:
* Single active dispatcher (leader election) — simplest; the dispatch decision is rarely the bottleneck (the Lambdas are), so one instance is usually plenty.
* The central dispatcher pulling from a governed DB is the one that matches your stated objective (fairness + control). Combine it with a small fixed set of priority queues (e.g. email/standard, email/application, or gold/silver/bronze) that workers poll in a weighted ratio. That gives you fairness via the dispatcher and coarse priority isolation via a handful of queues.
* `Durable job store` (lifecycle: pending/processing/complete, must survive restarts) → DynamoDB.
* `Rate/window counters` (per-account per-minute bins, TTL) → Redis (atomic INCR, auto-expiry).
* Dynamo is key/GSI access, not a ranked multi-dimensional query engine. You'll likely pull candidates via a GSI (partition queue#status, sort priority#time) and then do the fairness selection in app code. Prototype this access pattern early — it's the thing most likely to force a redesign. Redis sorted sets (score = fairness/virtual-time, ZPOPMIN) may model the "who's next" decision more naturally than Dynamo.
* Two datastores = two failure modes + consistency between them. Worth a hard look at whether `Redis-alone` (sorted set as the queue + counters) or Dynamo-alone (TTL + atomic counters) could cut it, to reduce moving parts.

# Model
* "dispatch whoever has the least frequent recent send rate" — that's `Weighted Fair Queuing / Deficit Round Robin` reinvented. Adopting one explicitly buys you a well-understood model: give each account a virtual finish time (or DRR deficit counter) scaled by its priority weight, and always dispatch the smallest. Pair it with a token bucket per account for the hard rate limits (100/min etc.). That's cleaner and more predictable than ad-hoc "least frequent."

# Redis
* maintaining 1m/5m/1h/1d counters and decrementing the windows as bins expire — that's a genuine consistency hazard (you flagged it yourself). Avoid it: `keep only per-minute bins with TTL`, and compute each window on read by summing the relevant bins (pipelined, cheap). Don't try to keep synchronized rolling totals. Simpler mental model, no expiry-decrement bugs.

# SQS
* Put a job-id pointer in the SQS message, not the payload. Sidesteps the 256KB limit and keeps your DB the source of truth (you're already storing metadata there). Worker reads the job from the DB by id.
* `Don't trust ApproximateNumberOfMessages` for "only add if backlog < threshold" — it's eventually consistent and approximate. Since you're the one dispatching, track in-flight counts yourself (you already are, in the counters).
* Wire `SQS DLQ → failed status`, and handle the crash-after-push-before-mark case with the lease/idempotency key so you don't double-send.


# Triggers
* Work arrived — a new item landed in the governor DB. Easy to make event-driven.
* Capacity freed — a worker finished, queue drained, or a rate window rolled over / token refilled. This one is partly time-based ("max 100/min" only resolves over time), so you can't be 100% event-based.

1) Credit-based:
Instead of "how often do I push," flip it to "push exactly as fast as workers consume." Keep SQS deliberately shallow (near a low-water-mark). Each worker completion emits a "capacity freed" signal that returns a credit and wakes the dispatcher to refill. Pace then equals consumption rate automatically — no interval to tune. This is the cleanest event-driven model: demand-driven flow control. Signals can be an `EventBridge` event from the Lambda, or simply the worker decrementing an in-flight counter that the dispatcher watches (via `Redis`).

2) Event-driven activation on new work — but coalesced:
Use DynamoDB Streams (or CDC) so an insert of a pending item triggers a dispatch evaluation. The critical caveat: don't dispatch per item. Account A inserting 100k rows must not fire 100k evaluations or 100k sends — that defeats batching, fairness, and hammers the DB. So the event sets a dirty flag / schedules one coalesced evaluation after a short debounce (250ms–1s); all events in that window collapse into a single round. Event-driven responsiveness, batch-sized work.

3) Decouple trigger from rate with a token bucket
Whatever wakes the dispatcher, the amount allowed is governed by a token bucket per account+queue (refills at the rate limit, e.g. 100/min). Triggers can fire as often as they like; the bucket says "you may send K right now." Refill is time-based but lazily computed on read (tokens = min(cap, last + elapsed·rate)) — no timer needed. This is what lets you be aggressive on event triggers without violating limits.

4) Self-scheduled precise wake-ups (this is what kills blind polling)
When the dispatcher is blocked by time (every account is at its rate limit, or the queue is full), don't poll every 5s hoping. Instead compute the earliest moment anything could change — next token refill, next rate-window rollover, next lease expiry — and schedule exactly one wake-up then:
* EventBridge Scheduler one-off (at(T)), or
* a delayed SQS "control" message: the dispatcher is itself an SQS consumer; after a round it enqueues its own next control message with DelaySeconds = computed backoff. The timer becomes an event, and the dispatcher reacts only to events while pacing itself.

#
# Recommendation
#
A hybrid: events activate, time is precise, a sweep is the backstop.

* Single long-running coordinator (your Service), woken by:
** `DynamoDB Stream events` (new work) → coalesced into one evaluation,
** worker-completion / credit events (freed capacity),
** its own self-scheduled wake-up (delayed control message or EventBridge one-off) computed from the next token refill.
* Token buckets per account+queue as the rate governor (lazily refilled).
* Single-flight guard so a round never overlaps itself.
* A low-frequency safety sweep (every 1–5 min via EventBridge) to catch missed stream events, stuck processing leases, and clock drift — event systems always need this belt-and-suspenders.

[ producer ] -> sqs -> [ dispatch drainer ] -> [ ddb / redis ] -> [ dispatcher ] -> sqs -> [ consumer ]

By Type:
[ email-dispatcher ] [ sms-dispatcher ] [ webhook-dispatcher ]

Use SQS MessageGroupId = AccountId for interleaving messages.  In a FIFO queue, one message group would not block another message group.


# ==============================================================================================
* Dynamo DB or Redis
* Store: job type (queue) (email, image, webhook, report, sms, etc), accountId, priority, status (pending, processing, suspended, complete, failed), createdTime, lastUpdate, completeTime, metaData based on type, errors, stats.
* Service polls on an interval (config).  Scale out based on the number of items in the DB queue. Query DB for status=pending and accountId != suspended and based on priority and account weighting. 
* Pull a configurable count and place them on the appropriate queues for processing.
* Jobs (Lambda) consume the item in the queue.
* Separate, priority queues that are account specific to those that are application specific so import items like password reset and alike can get out in parallel to account level items.
** /email/standard
** /email/application

# The count to place in the queue each time is based upon:
* *Maximum number of jobs per worker consumption
* SQS throughput
* Per account rate limits and priority (max 100 jobs per minute per account)
* Config batch size per type
* Query SQS queue depth and only add to queue if backlog is below some threshold.
* Note, SQS has a max message size of 256KB per message and retention period of 14 days.
* Ideally, when an item is added to the queue, we track the queue, account id, and time so we can build a profile of the distribution of items added by an account, to a queue over some period of time (1 day). Each bin of counts could be of intervals of 1 minute. We discussed that adding this to redis might be possible where the key would be queue+account id+bin and the value would be the count. Then when we query the dispatch db, we can get a count of all the pending accounts, determine and send based on who has the least frequent send rate to allow those accounts fair access to the queue.

* Key: queue:{queueId}:account:{accountId}:bin:{minuteBin}
`Example: queue:email:account:123:bin:20260527T1532`
* Value: Integer count (number of items added in that minute bin)

* Operation:
When an item is added: INCR the key for the current minute bin.
Set an expiry (e.g., 2 days) so old bins are auto-removed.

* Look into rolling sums per bin vs incremental count
* Keep count for bin size (e.g. 1 minutes) increment
* Increment the other windows (5 minutes, 1 hour, 1 day, etc)
* As a bin expires (old), remove that count to each of the windows.
* No a distribution, but just a total count per window

# Query: for a particular message type, how would I query based on these variables
* Message/queue type
* Message priority (0-10), 0 being message is suspended
* Number of Messages pending per account
* Account priority (0-10), 0 being suspended.
* Message type/queue depth and config limit (1000 max, current 750, no more than 250 more)
* Account limits per message type (per minutes, per 5 minutes, per hour, per day) and knowing the counts for each type for each account for the last minute, 5 minutes, hour and day.
What other metrics might need to be tracked? 1 Minutes, 5 Minutes, 1 hour, Consumption rate per message type?
* May want to suspend all account A email messages, but leave sms traffic alone.
* May want to unsuspend email messages in blocks.

# Fair Queues
* How to manage queues where one account may dominate the backlog and not allow smaller campaigns thru.
* Multiple queues by account and priority.
* Different queue per account and priority: queue-account-a, queue-account-b, queue-gold, queue-silver, queue-bronze
* Jobs pull from queues in a round robin or weighted fashion, poll based on queue ratio (5:2:1) for (gold:silver:bronze).
* No single account monopolizes the system
* Pro: simple, effective, easy scale
* Con: More infrastructure, more queue management
* Central dispatcher
* Central dispatcher that pulls messages from a shared database and dispatches based on a round-robing, weighted by account and/or priority.
* Pro: Maximum control, custom logic
* More complex, single point of control

