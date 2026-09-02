//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Contact } from "./model/Contact";

//
// S2S: resolve a normalized phone/email VALUE to its contactId within one account (contact-1.7 /
// gap #6 of apps/core/analytics/SPECS.md — identity resolution is contact's job, done upstream of
// any channel event). INTERNAL audience; the caller (texting/email/print) already knows the
// account it's sending from, so this is account-scoped, not a platform-wide lookup — a contact's
// identifiers never cross accounts. No GSI yet: today this queries the account's contact partition
// and filters in-memory (mirrors GetInternalContactsImpl's shape); revisit with a dedicated
// identifier GSI if a single account's contact volume makes that scan too slow.
//
export class GetInternalContactByIdentifier extends RestfulEndpoint< GetInternalContactByIdentifier.Query, undefined, GetInternalContactByIdentifier.Response >
{
    public readonly uri      : string = GetInternalContactByIdentifier.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getInternalContactByIdentifier",
        summary:     "Resolve a phone/email to its contactId (S2S)",
        description: "Resolves a normalized phone (E.164) or email value to the owning contactId within one account. Returns 404 (not an empty match) when unknown — the caller falls back to an anonId.",
        tags:        [ "Contact" ],
        errors:      { 404: "No contact matches that identifier" },
    };

    constructor( query? : GetInternalContactByIdentifier.Query ) { super( query ?? { accountId: "", value: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId", "value" ],
            properties: {
                accountId: { type: "string" },
                value:     { type: "string" },   // normalized E.164 phone or lowercased email
            },
        };
    }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInternalContactByIdentifier
{
    export const URI : string = apiPath( "contact", 1, "/internal/contacts/by-identifier" );

    export interface Query
    {
        accountId : string;
        value     : string;   // normalized E.164 phone or lowercased email — caller normalizes
    }

    export interface Response
    {
        contactId : Contact.Entity[ "id" ];
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetInternalContactByIdentifier;
// eof
