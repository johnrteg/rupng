//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";
import { SocialAccount } from "./SocialAccount";

//
// SocialPost — the shared wire contract for a `social` post: the compose record an account submits to
// publish across one or more connected destinations, plus the per-target result once it's attempted.
// Approval-workflow fields (`approvalsRequired`/`approvals`) are modeled now (SPECS.md §8) even though
// the submit/approve endpoints land later, so the stored shape doesn't churn when they do.
//
// DynamoDB: posts            PK: accountId  SK: id (postId)
//           published_posts  PK: postId     SK: platform#connectionId
//
export namespace SocialPost
{
    /** Lifecycle. Review states (`pending_review`/`approved`) only apply when `approvalsRequired ≥ 1`. */
    export enum Status
    {
        DRAFT          = "draft",
        PENDING_REVIEW = "pending_review",
        APPROVED       = "approved",
        SCHEDULED      = "scheduled",
        PUBLISHED      = "published",
        FAILED         = "failed",
        CANCELED       = "canceled",
    }

    export enum ApprovalDecision { APPROVE = "approve", REJECT = "reject" }

    /** Outcome of one target's publish attempt. */
    export enum PublishOutcome { PUBLISHED = "published", FAILED = "failed" }

    // ──────────────────────────────────────────────────────────────────────────
    // Value objects
    // ──────────────────────────────────────────────────────────────────────────

    /** One destination this post is aimed at (a connected account). */
    export interface PostTarget
    {
        platform:     SocialAccount.Platform;
        connectionId: Type.UUID;
    }

    /** A post's content adapted to one platform's rules — what an adapter actually publishes. */
    export interface Rendition
    {
        platform:     SocialAccount.Platform;
        connectionId: Type.UUID;
        body:         string;
        mediaKeys?:   Array<string>;
    }

    /** One approve/reject decision on a post under review. */
    export interface Approval
    {
        by:       Type.UUID;
        at:       Type.ISODateTime;
        decision: ApprovalDecision;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Post (the resource)
    // ──────────────────────────────────────────────────────────────────────────

    export interface Entity
    {
        id:                Type.UUID;
        accountId:         Type.UUID;
        body:               string;
        mediaKeys?:         Array<string>;
        targets:            Array<PostTarget>;
        scheduleAt?:        Type.ISODateTime;
        status:             Status;
        approvalsRequired:  number;           // snapshot of account policy at submit time (immutable after)
        approvals?:         Array<Approval>;
        createdBy:          Type.UUID;
        createdAt:          Type.ISODateTime;
        modifiedAt:         Type.ISODateTime;
    }

    /** Create payload — server assigns id / accountId / status / approvalsRequired / timestamps. */
    export type CreatePost = Pick<Entity, "body" | "targets"> & Partial<Pick<Entity, "mediaKeys" | "scheduleAt">>;

    /**
     * Read-time DEFAULTs. Identity fields (`id`, `accountId`, `body`, `targets`, `createdBy`,
     * `createdAt`, `modifiedAt`) are OMITTED — a row missing those is an anomaly to surface, not fabricate.
     */
    export const DEFAULT : Partial<Entity> =
    {
        status:            Status.DRAFT,
        approvalsRequired: 0,
    };

    const TARGET_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "platform", "connectionId" ],
        properties: {
            platform:     { type: "string", enum: Object.values( SocialAccount.Platform ) },
            connectionId: { type: "string" },
        },
    };

    const APPROVAL_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "by", "at", "decision" ],
        properties: {
            by:       { type: "string" },
            at:       { type: "string" },
            decision: { type: "string", enum: Object.values( ApprovalDecision ) },
        },
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "id", "accountId", "body", "targets", "status", "approvalsRequired", "createdBy", "createdAt", "modifiedAt" ],
        properties:
        {
            id:                { type: "string", format: "uuid" },
            accountId:         { type: "string", format: "uuid" },
            body:              { type: "string" },
            mediaKeys:         { type: "array", items: { type: "string" } },
            targets:           { type: "array", items: TARGET_SCHEMA },
            scheduleAt:        { type: "string" },
            status:            { type: "string", enum: Object.values( Status ) },
            approvalsRequired: { type: "number" },
            approvals:         { type: "array", items: APPROVAL_SCHEMA },
            createdBy:         { type: "string", format: "uuid" },
            createdAt:         { type: "string", format: "date-time" },
            modifiedAt:        { type: "string", format: "date-time" },
        },
    };

    /** Validate a `SocialPost.Entity` (a wire payload, a DynamoDB row). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );

    // ──────────────────────────────────────────────────────────────────────────
    // PublishedPost — one target's publish result (SPECS.md "Data model")
    // ──────────────────────────────────────────────────────────────────────────

    export interface PublishedPost
    {
        postId:         Type.UUID;
        platform:       SocialAccount.Platform;
        connectionId:   Type.UUID;
        platformPostId?: string;
        status:         PublishOutcome;
        error?:         string;
        publishedAt:    Type.ISODateTime;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Review thread + audit trail (SPECS.md §8) — modeled now, persisted starting with the approval
    // workflow milestone; not yet backed by a table.
    // ──────────────────────────────────────────────────────────────────────────

    export interface ReviewComment
    {
        id:          Type.UUID;
        postId:      Type.UUID;
        by:          Type.UUID;
        at:          Type.ISODateTime;
        text:        string;
        resolvedBy?: Type.UUID;
        resolvedAt?: Type.ISODateTime;
    }

    export enum AuditAction { SUBMIT = "submit", APPROVE = "approve", REJECT = "reject", COMMENT = "comment", RESOLVE = "resolve", SCHEDULE = "schedule", PUBLISH = "publish" }

    export interface ReviewAudit
    {
        postId: Type.UUID;
        seq:    number;
        action: AuditAction;
        by:     Type.UUID;
        at:     Type.ISODateTime;
        detail?: string;
    }
}

export default SocialPost;
// eof
