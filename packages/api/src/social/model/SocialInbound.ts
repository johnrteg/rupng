//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";
import { SocialAccount } from "./SocialAccount";

//
// SocialInbound — the shared wire contract for one inbound item (a DM / comment / mention / reaction /
// review) arriving on a connected destination, normalized + keyword-tagged + sentiment-scored by
// `SocialInboundJob` (fed by both `SocialWebhookService` (Meta push) and `SocialPollJob` (X/TikTok/
// LinkedIn pull) — see apps/core/social/SPECS.md §4). Persisted with a DynamoDB TTL — inbound isn't
// kept forever.
//
// DynamoDB: inbox  PK: accountId  SK: id (itemId)
//
export namespace SocialInbound
{
    export enum Type_ { DM = "dm", COMMENT = "comment", MENTION = "mention", REACTION = "reaction", REVIEW = "review" }

    /** A cheap keyword-tag bucket — not a full moderation model, just enough to filter the inbox. */
    export enum Tag { GOOD = "good", BAD = "bad", RUDE = "rude", SPAM = "spam", QUESTION = "question" }

    /** A cheap keyword-score sentiment bucket (SPECS.md §5.4 — "rides the cheap keyword score"). */
    export enum Sentiment { POSITIVE = "positive", NEUTRAL = "neutral", NEGATIVE = "negative" }

    export enum Status { OPEN = "open", HANDLED = "handled" }

    export interface Entity
    {
        id:                     Type.UUID;
        accountId:              Type.UUID;
        connectionId:           Type.UUID;              // which connected destination this arrived on
        type:                   Type_;
        platform:               SocialAccount.Platform;
        authorHandle:           string;                 // platform-scoped, not a resolved contact
        text:                   string;
        rating?:                number;                 // present when type = REVIEW
        campaignId?:            Type.UUID;
        publishedPostId?:       Type.UUID;               // the post this comment/mention is attached to, if any
        replyWindowExpiresAt?:  Type.ISODateTime;        // DM platforms with a reply-window (e.g. 24h)
        tags:                   Array<Tag>;
        sentiment:              Sentiment;
        status:                 Status;
        receivedAt:             Type.ISODateTime;
        ttl:                    number;                 // DynamoDB TTL — unix epoch seconds
    }

    /**
     * Read-time DEFAULTs. Identity fields (`id`, `accountId`, `connectionId`, `type`, `platform`,
     * `authorHandle`, `text`, `receivedAt`, `ttl`) are OMITTED — a row missing those is an anomaly to
     * surface, not fabricate.
     */
    export const DEFAULT : Partial<Entity> =
    {
        tags:      [],
        sentiment: Sentiment.NEUTRAL,
        status:    Status.OPEN,
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "id", "accountId", "connectionId", "type", "platform", "authorHandle", "text", "tags", "sentiment", "status", "receivedAt", "ttl" ],
        properties:
        {
            id:                    { type: "string", format: "uuid" },
            accountId:             { type: "string", format: "uuid" },
            connectionId:          { type: "string", format: "uuid" },
            type:                  { type: "string", enum: Object.values( Type_ ) },
            platform:              { type: "string", enum: Object.values( SocialAccount.Platform ) },
            authorHandle:          { type: "string" },
            text:                  { type: "string" },
            rating:                { type: "number" },
            campaignId:            { type: "string" },
            publishedPostId:       { type: "string" },
            replyWindowExpiresAt:  { type: "string" },
            tags:                  { type: "array", items: { type: "string", enum: Object.values( Tag ) } },
            sentiment:             { type: "string", enum: Object.values( Sentiment ) },
            status:                { type: "string", enum: Object.values( Status ) },
            receivedAt:            { type: "string", format: "date-time" },
            ttl:                   { type: "number" },
        },
    };

    /** Validate a `SocialInbound.Entity` (a wire payload, a DynamoDB row). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );
}

export default SocialInbound;
// eof
