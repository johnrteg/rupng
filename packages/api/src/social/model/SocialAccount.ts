//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";

//
// SocialAccount — the shared wire contract for a `social` connected destination (a Page/profile/org
// the account can publish to). Credentials are BYO, vaulted in `marketplace` — this record holds only
// a reference (`marketplaceInstallationId`) + the display/lifecycle state; the OAuth token itself is
// never stored here (see apps/core/social/SPECS.md "Auth / OAuth handling approach").
//
// DynamoDB: connections  PK: accountId  SK: id (connectionId)
//
export namespace SocialAccount
{
    /** Phase 1 native adapters (apps/core/social/SPECS.md §11.1). */
    export enum Platform
    {
        FACEBOOK  = "facebook",
        INSTAGRAM = "instagram",
        X         = "x",
        TIKTOK    = "tiktok",
        LINKEDIN  = "linkedin",
    }

    /** Connection health, surfaced from marketplace's installation lifecycle. */
    export enum ConnectionStatus { CONNECTED = "connected", EXPIRED = "expired", REVOKED = "revoked" }

    /** A pull-only account's poll schedule + on-demand-refresh lock (SPECS.md §4.8/4.9). */
    export enum PullStatus { IDLE = "idle", IN_FLIGHT = "in_flight" }

    export interface Pull
    {
        cadenceSeconds:   number;             // poll interval
        cooldownSeconds:  number;             // minimum gap between on-demand refreshes
        status:           PullStatus;
        lastPullAt?:      Type.ISODateTime;
        cooldownUntil?:   Type.ISODateTime;   // set while the manual Refresh button is locked out
        lastError?:       string;             // the alert surface for provider errors/rate limits
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ConnectedAccount (the resource)
    // ──────────────────────────────────────────────────────────────────────────

    export interface Entity
    {
        id:                        Type.UUID;   // connectionId
        accountId:                 Type.UUID;
        platform:                  Platform;
        handle?:                   string;      // display handle/page name once known
        marketplaceInstallationId: Type.UUID;    // → marketplace Installation (the OAuth broker's connectionKey)
        scopes?:                   Array<string>;
        status:                    ConnectionStatus;
        pull?:                     Pull;         // present for poll-only platforms (X / TikTok / LinkedIn)
        createdAt:                 Type.ISODateTime;
        modifiedAt:                Type.ISODateTime;
    }

    /** Create payload — server assigns id / accountId / status / marketplaceInstallationId / timestamps. */
    export type CreateConnection = Pick<Entity, "platform"> & Partial<Pick<Entity, "handle" | "scopes">>;

    /**
     * Read-time DEFAULTs. Identity fields (`id`, `accountId`, `platform`, `marketplaceInstallationId`,
     * `createdAt`, `modifiedAt`) are OMITTED — a row missing those is an anomaly to surface, not fabricate.
     */
    export const DEFAULT : Partial<Entity> =
    {
        status: ConnectionStatus.CONNECTED,
    };

    const PULL_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "cadenceSeconds", "cooldownSeconds", "status" ],
        properties:
        {
            cadenceSeconds:  { type: "number" },
            cooldownSeconds: { type: "number" },
            status:          { type: "string", enum: Object.values( PullStatus ) },
            lastPullAt:      { type: "string" },
            cooldownUntil:   { type: "string" },
            lastError:       { type: "string" },
        },
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "id", "accountId", "platform", "marketplaceInstallationId", "status", "createdAt", "modifiedAt" ],
        properties:
        {
            id:                        { type: "string", format: "uuid" },
            accountId:                 { type: "string", format: "uuid" },
            platform:                  { type: "string", enum: Object.values( Platform ) },
            handle:                    { type: "string" },
            marketplaceInstallationId: { type: "string", format: "uuid" },
            scopes:                    { type: "array", items: { type: "string" } },
            status:                    { type: "string", enum: Object.values( ConnectionStatus ) },
            pull:                      PULL_SCHEMA,
            createdAt:                 { type: "string", format: "date-time" },
            modifiedAt:                { type: "string", format: "date-time" },
        },
    };

    /** Validate a `SocialAccount.Entity` (a wire payload, a DynamoDB row). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );
}

export default SocialAccount;
// eof
