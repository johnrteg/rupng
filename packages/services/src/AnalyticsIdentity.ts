//
// AnalyticsIdentity — resolves a channel-message's sender (a phone/email value) to the opaque id an
// analytics `Analytics.Event` carries: a `contactId` when contact recognizes it, else a stable
// `anonId` (a salted hash of the normalized value). Composed as a member by each channel service
// (texting/email/print), exactly like `Webhook` — not a base class to extend.
//
// This is the ONE rule the analytics lake depends on for GDPR-survivability (apps/core/analytics/
// SPECS.md gap #1/#6, analytics-1.7): NO raw PII (phone/email) ever reaches the lake. Every channel
// service resolves through THIS helper at its webhook-normalization site, never rolling its own
// lookup/hash — so every service's `anonId` for the same identifier is bit-identical (same salt).
//
import { createHmac } from "node:crypto";

import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { GetInternalContactByIdentifier } from "@repo/api";
import type { CloudResolver } from "@repo/cloud-manifest";

import { Ports } from "@repo/cloud-manifest";
import { Secrets } from "./aws/Secrets";

export class AnalyticsIdentity
{
    private readonly contact : RestfulService;
    private readonly secrets : Secrets;
    private salt? : string;   // cached for this process's lifetime — fetched once, not per resolve()

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** @param cloud the owning service's resolver — resolves the shared `analytics-anon-salt`
     *               platform secret (auto-granted to every service; no per-service manifest edit). */
    constructor( cloud : CloudResolver )
    {
        this.contact = new RestfulService(
            process.env.CONTACT_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.CONTACT.MAIN, null, null ) );
        this.secrets = new Secrets( cloud );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Resolve `value` (a normalized E.164 phone or lowercased email) to the id an `Analytics.Event`
     * carries — `contactId` when contact recognizes it within `accountId`, else `anonId`. Never
     * throws; a contact-lookup failure falls back to `anonId` rather than blocking the caller's
     * primary send/webhook path (identity resolution is best-effort — analytics-1.7).
     */
    public async resolve( accountId : Type.ID, value : string ) : Promise<AnalyticsIdentity.Result>
    {
        const reply : RestfulService.Reply<GetInternalContactByIdentifier.Response> = await this.contact.fetch(
            new GetInternalContactByIdentifier( { accountId, value } ) );
        if( reply.ok ) return { contactId: ( reply.data as GetInternalContactByIdentifier.Response ).contactId };

        // unknown sender (404) OR a lookup failure — either way, record the event under a stable
        // anonId rather than dropping it (gap #6: "still recorded, it's real history")
        const anonId : Type.Result<string> = await this.anonId( value );
        return anonId.ok ? { anonId: anonId.data } : { anonId: `unresolved:${ value.length }` };   // last-resort: never leak the raw value
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** `HMAC-SHA256(salt, normalizedValue)`, hex-encoded — the same salt across every service (the
     *  shared `analytics-anon-salt` platform secret) makes repeat events from the same unknown
     *  sender group under one `anonId`, and lets a later contact-match re-attribute them (gap #6). */
    private async anonId( value : string ) : Promise<Type.Result<string>>
    {
        if( this.salt === undefined )
        {
            const got : Type.Result<string | undefined> = await this.secrets.get( "analytics-anon-salt" );
            if( !got.ok || !got.data ) return ResultUtils.err( "analytics-anon-salt unavailable" );
            this.salt = got.data;
        }
        return ResultUtils.ok( createHmac( "sha256", this.salt ).update( value ).digest( "hex" ) );
    }
}

export namespace AnalyticsIdentity
{
    /** Exactly one of `contactId` / `anonId` is set — never both, never neither. */
    export interface Result { contactId? : Type.ID; anonId? : string; }
}

export default AnalyticsIdentity;
// eof
