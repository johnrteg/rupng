# Event dictionary

The catalog of domain events services publish on the bus (Kafka). It's the contract a subscriber — a
peer service, an outbound webhook, and (once wired) the **web UI over websockets** — reads to know **what
exists to subscribe to** and **what shape the payload is**.

- **Source of truth for the vocabulary:** [`Events`](./src/Events.ts) — the `Object` (topics), `Verb`s,
  `Action`s, and the `Envelope`.
- **Payload models:** each event's `data` is a wire model from `@repo/api` (or an inline shape noted below).
- Keep this file in sync when you add/emit an event. Each row = one `<object>.<verb>` a service emits.

## The envelope (every event)

Every event is an `Events.Envelope` (see [`Events.ts`](./src/Events.ts)). The Kafka **topic is the
`object`** (`<service>.<noun>`) and the message **key is `target.id`**, so all of one entity's events stay
ordered on a partition. Key fields:

| field | meaning |
|---|---|
| `object` | the entity/topic — `Events.Object` (e.g. `media.asset`) |
| `verb` | `created` · `updated` · `deleted` · `purged` · `accessed` (`Events.Verb`) |
| `action` | `<object>.<verb>` — the subscribe key (e.g. `media.asset.created`), via `Events.actionOf` |
| `target` | `{ type, id }` — the entity (id = the Kafka key) |
| `accountId` | tenant scope — a subscriber filters to the acting account |
| `actor` | who caused it — `{ kind: user\|service, id }` |
| `data` | **the entity payload** — the TS model in the table below |
| `source` / `outcome` / `occurredAt` / `eventId` / `version` | provenance + dedupe |

## How the UI will subscribe (not yet wired)

The websocket layer isn't wired yet. When it is: the client subscribes by **`action`** (e.g.
`media.asset.*`), the server pushes the matching `Envelope`s for the client's `accountId`, and the client
uses `data` (the model below) to update its cache. The **same `Envelope` body** is what a peer service
consumes off Kafka and what an outbound webhook receives — one shape everywhere.

---

## Dictionary

Status: **live** = emitted today · **planned** = `Object` defined in `Events.ts` but not emitted yet.

### media  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `media.asset.created` | created | `Media.Asset` (`@repo/api`) | upload complete · duplicate | live |
| `media.asset.updated` | updated | `Media.Asset` | edit name/tags · generate variants · rescan | live |
| `media.asset.deleted` | deleted | `Media.Asset` | delete (soft) | live |

> Note: the async pipeline `status → ok` transition (variants + probed metadata ready) does **not** emit an
> `updated` yet — the request-path CRUD above does. Wiring a "ready" `updated` from the process/analyze step
> is a follow-up (needs the Kafka facade threaded into `MediaPipeline.Deps` + the Jobs).

### social  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `social.account.created` | created | `Payloads.SocialAccount` (`@repo/system`) | connect a destination | live |
| `social.account.deleted` | deleted | `Payloads.SocialAccount` | disconnect a destination | live |
| `social.post.created` | created | `Payloads.SocialPost` (`@repo/system`) | create a post (draft/scheduled) | live |
| `social.post.updated` | updated | `Payloads.SocialPost` | submit for review · approve/reject · cancel · publish outcome (PUBLISHED/FAILED) | live |

> Note: `data` is the lightweight `Payloads.SocialAccount`/`Payloads.SocialPost` representation
> (`packages/system/src/payloads/social.ts`), not the full `@repo/api` `SocialAccount.Entity`/`SocialPost.Entity` —
> mirrors media's own `Payloads.MediaAsset` pattern. The publish-outcome `updated` (status →
> PUBLISHED/FAILED) is emitted from `SocialPipeline.publishPost`, not the HTTP endpoint layer, since that
> transition happens in the publish worker.

### account  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `account.account.created` | created | `Account.Entity` (`@repo/api`) | personal-account provision · create sub-account | live |
| `account.account.updated` | updated | `Account.Entity` | edit account · owner transfer · sub-account status · billing settings · balance top-up | live |
| `account.member.created` | created | `Account.Member` | owner on provision · invite accepted (join) | live |
| `account.member.updated` | updated | `Account.Member` | role / status change | live |
| `account.member.deleted` | deleted | `{ userId }` | remove member | live |
| `account.invite.created` | created | `Account.Invite` | invite sent | live |
| `account.invite.updated` | updated | `Account.Invite` | resend · accepted | live |
| `account.invite.deleted` | deleted | `Account.Invite` (cancelled) | cancel invite | live |
| `account.account.deleted` / `.purged` | deleted/purged | `Account.Entity` | — | planned |
| `account.plan.*`, `account.invoice.*`, `account.block_list_entry.*` | — | — | — | planned |

> Note: `account.account.updated` covers billing-settings + balance changes (billing lives on the account
> row). A dedicated payment-method topic waits on the payment-method impls (skeletons today). The
> sub-account status change emits `updated` for the target sub-account only — cascaded descendants are a
> follow-up.

### auth  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `auth.user.created` | created | `User` (`@repo/api`) | registration verified | live |
| `auth.session.created` | created | `{ userId, username, at }` (inline) | login (password / MFA / passkey) | live |
| `auth.session.deleted` | deleted | `{ userId, username?, at }` (inline) | logout · revoke one · revoke all | live |
| `auth.passkey.created` | created | `{ credentialId, userId, createdAt }` (inline) | passkey enrolled | live |
| `auth.passkey.deleted` | deleted | `{ credentialId, userId }` (inline) | passkey removed | live |
| `auth.apikey.created` | created | `ApiKey.View` (`@repo/api`) | developer API key minted (secret NEVER on the bus) | live |
| `auth.apikey.deleted` | deleted | `{ keyId }` (inline) | developer API key revoked | live |
| `auth.user.updated` / `.deleted` | updated/deleted | `User` | — (password reset / profile / delete) | planned |
| `auth.mfa_challenge.*` | — | — | — | planned (TOTP enable/disable) |

> Note: auth is identity-centric — session/passkey events scope `accountId` to the acting account when
> known, else the userId (there's no account context at login/registration).

### app (BFF)  ⚪ consumer-only
The app BFF **consumes** `account.account` + `auth.user` to warm its read models; it owns no persisted CRUD
entity to publish yet (the notices entity isn't implemented). Nothing emitted. Kafka is disconnected cleanly
on shutdown. When notices land, emit `app.notice.created|updated|deleted` (add the `Object` topic + ACCESS first).

### voice  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `voice.call.created` | created | `Voice.CallLog` (`@repo/api`) | a call is dialed (or gated SUPPRESSED pre-dial) | live |
| `voice.call.updated` | updated | `Voice.CallLog` | inbound status webhook normalizes the outcome (answered/no-answer/busy/voicemail/opted-out); ALSO emitted per DTMF digit collected on an IVR-flow call (`VoiceService.ivrFlowStep` — `lastAnsweredStepId`/`lastAnsweredValue` on the row), consumed by survey's phone/IVR runner (survey-2.4) | live |
| `voice.suppression.*` | — | — | — | planned (a suppression list write happens inline today, no separate event) |
| `voice.ivr_flow.*` | — | — | — | planned (no IVR flow CRUD entity yet — see `apps/core/voice/SPECS.md`) |

> Note: voice is a scaffold + `fake`/Twilio-only build (see `apps/core/voice/SPECS.md`'s gaps list) — the full
> IVR flow engine, AMD, and STIR/SHAKEN surface aren't built, so their reserved `Events.ts` topics stay planned.

### registration  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `registration.brand.created` | created | `Registration.Brand` (`@repo/api`) | `RegistrationDomain.createBrand` | live |
| `registration.brand.updated` | updated | `Registration.Brand` | `RegistrationDomain.transitionBrandStatus` / `patchBrand` / `processVetting` — vetting/identity transition (`DRAFT → … → APPROVED/FAILED/NEEDS_APPEAL`), staff override (registration-11.6), resubmit | live |
| `registration.brand.deleted` | deleted | `Registration.Brand` | brand withdrawn/removed | planned |
| `registration.campaign.created` | created | `Registration.Campaign` (`@repo/api`) | `RegistrationDomain.createCampaign` | live |
| `registration.campaign.updated` | updated | `Registration.Campaign` | `RegistrationDomain.transitionCampaignStatus` / `patchCampaign` / `republishThroughput` — status transition (`DRAFT → … → ACTIVE/REJECTED/SUSPENDED/EXPIRED`), `mnoMetadata`/`mps` refresh, staff override, resubmit | live |
| `registration.campaign.deleted` | deleted | `Registration.Campaign` | campaign withdrawn/removed | planned |
| `registration.number.created` | created | `{ accountId, campaignId, brandId, phoneNumber, status, mps }` (campaign-embedded — no dedicated number model) | `RegistrationDomain.provisionNumbers` — number associated to an approved campaign (bulk, blind) | live |
| `registration.number.updated` | updated | same | `RegistrationDomain.transitionCampaignStatus` on entry to `ACTIVE` — the campaign's already-associated numbers become sendable, so each is re-published with the new status + `mps` | live |
| `registration.number.deleted` | deleted | same | number disassociated from a campaign | planned |
| `registration.number.created` | created | `PhoneNumber.PhoneNumber` (`@repo/api`) | `RegistrationDomain.orderNumber` — a standalone search-then-order (LONG_CODE/TOLL_FREE), distinct from the campaign-embedded bulk row above | live |
| `registration.number.updated` | updated | `PhoneNumber.PhoneNumber` | `RegistrationDomain.releaseNumber` / `submitTollFreeVerification` / `reconcileNumber` — status or TFV transition | live |
| `registration.shortcode.created` | created | `PhoneNumber.ShortCodeApplication` (`@repo/api`) | `RegistrationDomain.submitShortCodeApplication` | live |
| `registration.shortcode.updated` | updated | `PhoneNumber.ShortCodeApplication` | `RegistrationDomain.patchShortCodeApplication` — staff-progressed status (no carrier webhook exists) | live |

> Note: `registration.campaign.updated` carrying `status: "active"` is the **`campaign-active`
> sending-precondition** signal texting gates outbound sending on (`apps/core/registration/SPECS.md`
> `registration-7.1`) — texting subscribes to this Object rather than looking up campaign status via a
> cross-service DB read. The same `updated` event (on any `mnoMetadata`/`status` refresh, e.g. from
> `RegistrationVettingJob`'s periodic re-vet) also carries the `mps` (`{ perMinute, perHour, perDay }`)
> trust-score → throughput fields (`registration-7.2`) — this is the **published interface** dispatch paces
> sends against, never a DB lookup into registration's own table. The standalone `PhoneNumber` rows above
> are the future consumption bridge into `Texting.NumberRecord` — no texting-side consumer subscribes yet.

### audit  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `audit.legal_hold.created` | created | `Audit.LegalHold` (`@repo/api`) | `PostAuditLegalHoldImpl` places a hold | live |
| `audit.legal_hold.deleted` | deleted | `Audit.LegalHold` | `PostAuditLegalHoldImpl` releases a hold | live |
| `audit.export.created` | created | `{ format, rowCount }` (inline) | `PostAuditExportImpl` — a DSAR/SOC 2 export ran | live |
| `audit.event.accessed` | accessed | `{ count?, crossTenant? }` (inline) | `GetAuditEventsImpl` / `GetAuditEventImpl` / `GetStaffAuditEventsImpl` — reads of the trail are themselves audited (audit-5.2) | live |

> Note: these four are emitted through `Application.audit()` (→ the platform audit SQS queue →
> `AuditSinkJob`), NOT `kafka.publishEvent` directly — audit is the one service whose own admin actions
> route through its own emit path rather than (or in addition to) Kafka, since the audit trail IS the
> destination. `Application.audit()` is the shared, platform-wide emitter EVERY service gets (see
> `packages/services/src/Application.ts`) — this table only lists the audit SERVICE's own emission
> sites; other services' `this.audit(...)` call sites land here as they're added, one row per action,
> as the catalog "grows by declaration" (apps/core/audit/SPECS.md).

### contact  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `contact.contact.created` | created | `Payloads.Contact` (`@repo/system`) | `PostContactImpl` | live |
| `contact.contact.updated` | updated | `Payloads.Contact` | `PatchContactImpl` | live |
| `contact.contact.deleted` | deleted | `Payloads.Contact` | `DeleteContactImpl` | live |
| `contact.contact.purged` | purged | redacted `Payloads.Contact` | GDPR forget worker (`ContactService.processForget`) | live |
| `contact.segment.created` | created | `Payloads.Segment` (`@repo/system`) | `PostSegmentImpl` / `PostSegmentCopyImpl` | live |
| `contact.segment.updated` | updated | `Payloads.Segment` | `PatchSegmentImpl` | live |
| `contact.segment.deleted` | deleted | `Payloads.Segment` | `DeleteSegmentImpl` | live |

> Consumed by: **search** (indexer — `contact`/`segment` doc types, `apps/core/search/SPECS.md` search-4.2).

### campaign  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `campaign.campaign.created` | created | `Payloads.Campaign` (`@repo/system`) | `PostCampaignImpl` | live |
| `campaign.campaign.updated` | updated | `Payloads.Campaign` | `PatchCampaignImpl` | live |
| `campaign.campaign.deleted` | deleted | `Payloads.Campaign` | `DeleteCampaignImpl` | live |

> Consumed by: **search** (indexer — `campaign` doc type, search-4.2).

### email  🟢 live
| action | verb | `data` model | emitted by | status |
|---|---|---|---|---|
| `email.template.created` | created | `Payloads.EmailTemplate` (`@repo/system`) | `EmailService.templateCreated` | live |
| `email.template.updated` | updated | `Payloads.EmailTemplate` | `EmailService.templateUpdated` | live |
| `email.template.deleted` | deleted | `Payloads.EmailTemplate` | `EmailService.templateDeleted` | live |
| `email.message.created` | created | `Payloads.EmailMessage` (`@repo/system`) | `EmailService.sendToRecipient` — one send-log row per recipient | live |
| `email.suppression.*`, `email.domain.*` | — | — | — | planned |

> Consumed by: **search** (indexer — `email` doc type, search-4.2).

### survey  🟢 live
| Event | Verb | `data` model | Emitting site | Status |
|---|---|---|---|---|
| `survey.survey.created` / `.updated` / `.deleted` | created/updated/deleted | `Survey.Entity` (`@repo/api`) | `SurveyService.emit` — survey CRUD/publish impls | live |
| `survey.response.created` | created | `SurveyResponse.Entity` (`@repo/api`) | `SurveyService.emit` — response capture starts (in_progress) | live |
| `survey.response.updated` | updated | `SurveyResponse.Entity` (`@repo/api`) | `SurveyService.emit` — completed/abandoned transition (survey-5.2's completion-as-conversion / workflow trigger) | live |

### everything else  ⚪ planned
`Object` topics are **defined** in [`Events.ts`](./src/Events.ts) for workflow, texting, print, links,
collab, marketplace, media variants, etc., but no emission is wired yet. Add a row here when a service
starts emitting.

---

## Adding an event (checklist)

1. **Topic** — ensure the entity has an `Events.Object` (`<service>.<noun>`) in [`Events.ts`](./src/Events.ts).
2. **Emit** — from the owning service, `kafka.publishEvent({ …, object, verb, action: Events.actionOf(object, verb), target: { type, id }, accountId, actor, data, source, outcome, sinks: [ Events.Sink.KAFKA ] })`.
   Best-effort: log a publish miss, never fail the request. (See `MediaService.publishAsset` for the pattern.)
3. **`data` = the wire model** — publish the entity's `@repo/api` model so subscribers share the contract.
4. **Document** — add the `<object>.<verb>` row above with its `data` model and emitting site.
