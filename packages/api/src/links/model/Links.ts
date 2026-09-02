//
// Links domain model — tracked links, QR/PURL rendering, and the short-domain registry
// (apps/core/links/SPECS.md). Everything is scoped under the `Links` namespace. Scalars come from
// `Type` in @repo/common; the role ladder from `Access` in @repo/endpoint.
//
// MVP cut (SPECS.md priority A only — see the file's own gap register for what's deferred):
//   * whitelabel DNS/cert automation (links-5.5/5.6), PURL landing render (links-3.2), conversion
//     threading (links-4.3), cost-cap metering (links-10.3), rate limiting (links-8.4), and the full
//     abuse subsystem (report/hibernate/restore/scan — links-10) are NOT built. `status` is modeled
//     (resolve gates on it — links-2.7) but every mint creates an `active` row; nothing transitions
//     it yet.
//
import type { Type } from "@repo/common";
import { Access } from "@repo/endpoint";   // value import — AccountRole enum is used at runtime

export namespace Links
{
    /** Which channel carried the link — keeps the same target distinguishable across channels. */
    export type Channel = "sms" | "mms" | "email" | "print" | "social" | (string & {});

    /** What the account is trying to make the user do (links-1.2). */
    export enum TargetType
    {
        CTA          = "cta",
        REGISTRATION = "registration",
        LANDING      = "landing",
        CONTENT      = "content",
        UNSUBSCRIBE  = "unsubscribe",
        DEEP_LINK    = "deep-link",
    }

    /** A `TrackedLink`'s lifecycle status (links-10.2's vocabulary; only ACTIVE is reachable in the
     *  MVP cut — the transitions into the others aren't built yet). */
    export enum LinkStatus
    {
        ACTIVE     = "active",
        FLAGGED    = "flagged",
        HIBERNATED = "hibernated",
        TAKEN_DOWN = "taken_down",
    }

    /** One opaque `code` → `target`, stamped with the attribution tuple (links-1.1). Tracked links are
     *  per-recipient (`contactId` set); untracked links are a shared CTA redirect (`contactId` absent). */
    export interface TrackedLink
    {
        code:        string;             // opaque base62 surrogate key (links-1.5) — the DDB sort key
        accountId:   Type.ID;
        target:      Type.Url;
        targetType:  TargetType;
        campaignId?: Type.ID;
        contactId?:  Type.ID;            // absent = untracked (shared CTA, no attribution)
        channel:     Channel;
        messageId?:  Type.ID;
        domain:      string;             // the ShortDomain this code was minted under
        status:      LinkStatus;
        createdAt:   Type.ISODateTime;
        expiresAt?:  Type.ISODateTime;
    }

    /** Input to a mint call — the caller (campaign/workflow/channel) supplies the attribution tuple;
     *  the service allocates the opaque `code`. */
    export interface MintRequest
    {
        accountId:   Type.ID;
        target:      Type.Url;
        targetType:  TargetType;
        campaignId?: Type.ID;
        contactId?:  Type.ID;            // omit for an untracked/shared link
        channel:     Channel;
        messageId?:  Type.ID;
        domain?:     string;             // an assigned domain, or the account default when omitted
    }

    /** What a mint call returns — the short URL + the code (for later QR render / metadata reads). */
    export interface MintResult { code : string; url : Type.Url; }

    // ──────────────────────────────────────────────────────────────────────────
    // Short-domain registry (links-5/6)
    // ──────────────────────────────────────────────────────────────────────────

    export enum DomainKind { SHARED = "shared", WHITELABEL = "whitelabel" }
    export enum DomainStatus { PENDING = "pending", ACTIVE = "active", DISABLED = "disabled", EXPIRED = "expired" }

    /** A registry entry — a host usable in `<short-domain>/<code>` (links-5.1). */
    export interface ShortDomain
    {
        domain:              string;             // the host, e.g. "rmbl.to" or "go.acme.com" — the DDB partition key
        kind:                DomainKind;
        ownerAccountId?:     Type.ID;             // set for WHITELABEL (single-account); absent for SHARED
        status:              DomainStatus;
        dnsVerifiedAt?:      Type.ISODateTime;
        certStatus?:         string;              // MVP: opaque status string from the (future) cert-automation step
        assignedAccountIds:  Array<Type.ID>;
        defaultForAccountIds: Array<Type.ID>;     // which of assignedAccountIds treat this as their default
        createdAt:           Type.ISODateTime;
    }

    /** Minimum access to read tracked-link metadata (analogous to Analytics.QUERY_MIN_ACCESS). */
    export const READ_MIN_ACCESS : Access.AccountRole = Access.AccountRole.USER;
}

export default Links;
// eof
