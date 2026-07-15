//
import { Access } from "@repo/endpoint";

//
// ApiKey — the WIRE view of a developer API key (auth service `api_keys` table). The full credential is
// `rup_<keyId>.<secret>` and is shown to the caller EXACTLY ONCE at creation (only a hash of the secret is
// stored). This view never carries the secret — just the public `keyId` + metadata for the "manage keys" UI.
// A key is tied to an ACCOUNT and carries a max `role` (≤ the creator's role at mint) + a throttle `tier`.
//
export namespace ApiKey
{
    /** Lifecycle of a key. */
    export enum Status { ACTIVE = "active", REVOKED = "revoked" }

    /** Throttle tier the gateway/limiter applies to a key. */
    export enum Tier { PUBLIC = "public", PARTNER = "partner", ADMIN = "admin" }

    /** The public, secret-free view of a key (list / after-create). */
    export interface View
    {
        keyId       : string;               // the public lookup half of `rup_<keyId>.<secret>`
        name        : string;               // human label
        role        : Access.Role;          // max role the key can act as (≤ creator's role)
        tier        : Tier;
        status      : Status;
        scopes?     : Array<string>;         // optional endpoint allow-list narrowing below the role
        createdAt   : string;
        expiresAt?  : number;                // epoch seconds (DynamoDB TTL); absent = no expiry
        lastUsedAt? : string;
    }
}

export default ApiKey;
