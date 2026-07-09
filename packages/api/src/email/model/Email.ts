//
// Email — the core wire contracts for the email SEND channel (see apps/core/email/specs/SPECS.md). Defined ONCE
// here in @repo/api so the email service, its jobs, the web composer, and S2S callers (campaign / workflow /
// transactional) all share one vocabulary. Send is S2S: a caller enqueues a `SendRequest`; the send worker
// renders it to an `Outbound` (canSend-gated) and a `Transport` puts it on the wire, returning a `SendResult`.
//
export namespace Email
{
    /** The ESP / transport a message is sent through — the provider factory selects by this value. A closed set
     *  (one adapter per value): SES is primary; `lettr` is the chosen ESP; `smtp` backs the dev sink + BYO relay;
     *  `marketplace` routes to an account-installed marketplace provider; `fake` simulates for tests. (email-3.1) */
    export enum Provider
    {
        SES         = "ses",
        LETTR       = "lettr",
        SMTP        = "smtp",
        MAILGUN     = "mailgun",
        POSTMARK    = "postmark",
        SPARKPOST   = "sparkpost",
        SENDGRID    = "sendgrid",
        BREVO       = "brevo",
        MAILCHIMP   = "mailchimp",
        MAILJET     = "mailjet",
        MAILERSEND  = "mailersend",
        MAILTRAP    = "mailtrap",
        RESEND      = "resend",
        MARKETPLACE = "marketplace",
        FAKE        = "fake",
    }

    /** How a rendered message physically leaves the platform (distinct from the ESP-API {@link Provider}): the
     *  SES API, or plain SMTP (nodemailer) for the dev sink OR a per-account BYO relay. (email-3.5) */
    export enum TransportKind { SES = "ses", SMTP = "smtp" }

    /** A single email address + optional display name — a LITERAL sending/receiving identity. */
    export interface Address { email : string; name? : string; }

    /** A NAMED outbound sending identity (email-4.9) — a verified from-address kept for a specific need
     *  (e.g. `no-reply` for verification, `security` for alerts, `billing` for receipts). The platform holds a
     *  SET of these for system mail; an account holds its own verified set (a from-address pick-list). `key` is
     *  the stable id referenced by routing; `purpose` is the human label shown in the admin UI. */
    export interface Sender { key : string; email : string; name : string; purpose? : string; }

    /** A send TARGET (a `to`/`cc`/`bcc` entry). Either a literal `email` (+ optional `name`), OR a `contactId`
     *  the send worker resolves to the contact's address + merge fields (name, first/last, custom attributes)
     *  just before handoff — so callers can address a contact by UUID and let the service do the placeholder
     *  name-merge at send time. At least one of `email` / `contactId` must be present. Per-recipient `mergeData`
     *  layers over the request-level `mergeData` for per-recipient personalization. (email-1.1/1.4) */
    export interface Recipient
    {
        email?     : string;
        name?      : string;
        contactId? : string;                              // a contact UUID → service resolves address + merge fields
        mergeData? : Record<string, unknown>;             // per-recipient overrides layered over request mergeData
        sendAt?    : string;                              // ISO — this recipient's own send time (overrides the send schedule)
    }

    /** A deliverability WARM-UP ramp (email-6) — start slow and increase the pace over a window so a new
     *  domain/IP or a large batch doesn't spike volume and trip spam heuristics. The effective rate ramps
     *  linearly from `startRatePerMinute` to `targetRatePerMinute` across `rampMinutes`. */
    export interface WarmupPlan
    {
        startRatePerMinute  : number;
        targetRatePerMinute : number;
        rampMinutes         : number;
    }

    /** A SEND SCHEDULE (email-6) — when + how fast to send. `startAt` delays the whole send; `ratePerMinute`
     *  throttles the steady-state pace (e.g. 5/min) to look human, not bursty; `warmup` overrides the pace with
     *  a ramp during its window. Applied by the send/batch worker (paced enqueue); a per-recipient `sendAt`
     *  overrides it for that recipient. All fields optional → send immediately, provider-default pace. */
    export interface SendSchedule
    {
        startAt?       : string;                          // ISO — begin at/after this time (else immediately)
        ratePerMinute? : number;                          // steady-state throttle (messages/minute)
        warmup?        : WarmupPlan;                       // optional ramp that supersedes ratePerMinute while active
        timezone?      : string;                           // optional tz for quiet-hours windows (future)
    }

    /** A per-account named test address (email-1.6) — a reusable target for pre-launch test sends. */
    export interface TestAddress { id : string; name : string; address : string; }

    /** A send REQUEST from a caller (S2S / composer). Recipients + merge data resolve from contact; the body is
     *  either an inline `html`/`text` or a `templateId` rendered with `mergeData`. `notificationType` marks a
     *  SYSTEM/transactional send (reset, verification) so the right published template + system sender is used. */
    export interface SendRequest
    {
        accountId?       : string;                       // omit for platform/system sends (uses the system sender)
        to               : Array<Recipient>;             // literal addresses and/or contact UUIDs (resolved at send)
        cc?              : Array<Recipient>;
        bcc?             : Array<Recipient>;
        from?            : Address;                       // a VERIFIED sending identity; default = account/system default
        replyTo?         : Address;
        subject?         : string;                        // overrides the template subject when set
        templateId?      : string;                        // render this stored template …
        html?            : string;                        // … OR send this inline body (one of the two)
        text?            : string;
        mergeData?       : Record<string, unknown>;       // contact / account / campaign merge values
        notificationType? : NotificationType;             // system/transactional case → its published template + system sender
        campaignId?      : string;
        provider?        : Provider;                      // override the resolved provider (else config default)
        idempotencyKey?  : string;                        // dedup across retries / A→B failover
        attachments?     : Array<Attachment>;
        schedule?        : SendSchedule;                   // when/how fast to send (delay + rate + warm-up)
    }

    /** The audience of a BATCH send (email-1.7) — an explicit recipient list (contact UUIDs and/or
     *  email/name literals) AND/OR a saved SEGMENT the service expands to its members at send time. */
    export interface BatchAudience { recipients? : Array<Recipient>; segmentId? : string; }

    /** A BATCH send REQUEST — the same message parts as {@link SendRequest} but addressed to many recipients
     *  (a recipient list and/or a segment). The batch worker expands the audience, paces the fan-out per the
     *  `schedule` (rate + warm-up) so a large send doesn't look like spam, and enqueues one send per recipient. */
    export interface BatchSendRequest extends Omit<SendRequest, "to">
    {
        audience : BatchAudience;
    }

    /** The lifecycle status of a {@link Blast} (email-1.9). */
    export enum BlastStatus
    {
        SCHEDULED = "scheduled",   // accepted, waiting for startAt / the safe buffer to elapse
        SENDING   = "sending",     // fanning out to recipients (paced by the schedule)
        SUSPENDED = "suspended",   // paused mid-fan-out; resumable from the cursor
        COMPLETED = "completed",   // every recipient enqueued
        CANCELLED = "cancelled",   // stopped and will not resume (soft-deleted)
    }

    /** A control action on a {@link Blast} (email-1.9) — suspend/resume/reschedule an in-flight or scheduled blast. */
    export enum BlastAction { SUSPEND = "suspend", RESUME = "resume", RESCHEDULE = "reschedule" }

    /** A BLAST — a tracked batch/scheduled send you can **suspend / resume / reschedule / cancel** while
     *  SCHEDULED or in progress (email-1.9). The batch worker checks `status` before each recipient (suspend or
     *  cancel stops the fan-out; resume continues from `sent`, the cursor). `startAt` is the effective start
     *  after the safe-buffer + timezone resolution. */
    export interface Blast
    {
        id          : string;
        accountId   : string;
        status      : BlastStatus;
        request     : BatchSendRequest;             // the message + audience + schedule
        total       : number;                       // resolved recipient count (0 until the audience is expanded)
        sent        : number;                       // recipients enqueued so far (the resume cursor)
        startAt?    : string;                       // effective ISO start (after buffer/timezone resolution)
        timezone?   : string;                       // the tz `startAt` is relative to
        createdAt   : string;
        createdBy?  : string;
        modifiedAt  : string;
        modifiedBy? : string;
    }

    /** An attachment sourced from the media service (email-2.3) — referenced by asset, not inlined bytes. */
    export interface Attachment { filename : string; assetGuid : string; contentType : string; }

    /** A rendered, `canSend()`-approved message ready to hand to a {@link Transport} — the send worker's product. */
    export interface Outbound
    {
        idempotencyKey : string;
        accountId?     : string;
        from           : string;                          // a verified sending identity (or the platform system sender)
        to             : Array<string>;
        cc?            : Array<string>;
        bcc?           : Array<string>;
        subject        : string;
        html?          : string;
        text?          : string;
        headers?       : Record<string, string>;          // List-Unsubscribe (RFC 8058), etc.
        attachments?   : Array<{ filename : string; contentRef : string; contentType : string }>;
    }

    /** The result of a transport send — `retryable` distinguishes a transient failure (→ retry/DLQ) from a
     *  permanent one (email-5.2). */
    export interface SendResult { ok : boolean; providerMessageId? : string; error? : string; retryable? : boolean; }

    /** The per-message operational status in the send-log (email-8.1). */
    export enum Status
    {
        QUEUED    = "queued",
        SENT      = "sent",
        DELIVERED = "delivered",
        OPENED    = "opened",
        CLICKED   = "clicked",
        BOUNCED   = "bounced",
        COMPLAINED = "complained",
        SUPPRESSED = "suppressed",   // blocked by canSend() (unsubscribe / consent / quiet-hours)
        FAILED    = "failed",
    }

    /** A SYSTEM/transactional email CASE — each has 1-of-many templates (one published/active). Application/root
     *  system mail (reset, verification, …) uses the platform system sender; account cases use the account
     *  provider. A closed, nameable set → enum. (email-2 / email-4.9) */
    export enum NotificationType
    {
        // ── system / platform (system sender) ──
        PASSWORD_RESET      = "password-reset",
        EMAIL_VERIFICATION  = "email-verification",
        MFA_CODE            = "mfa-code",
        ACCOUNT_INVITE      = "account-invite",
        WELCOME             = "welcome",
        SECURITY_ALERT      = "security-alert",
        // ── account transactional ──
        RECEIPT             = "receipt",
        NOTIFICATION        = "notification",
        DIGEST              = "digest",
    }

    /** The viewport a rendered email is PREVIEWED at (the preview drawer's desktop/mobile toggle). A closed,
     *  nameable set → enum (single source; imported by the template list, the editor, and the preview drawer). */
    export enum PreviewViewport
    {
        DESKTOP = "desktop",
        MOBILE  = "mobile",
    }
}

export default Email;
// eof
