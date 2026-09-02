//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// S2S forget hook (links-7.2) — the `contact` forget fan-out calls this to null `contactId` on every
// TrackedLink for the forgotten contact (via `gsi_contactId`). The code keeps resolving (aggregate
// counts unaffected); it's just no longer attributed to a person. Idempotent — same contract as
// print/voice/report's `/internal/erase`.
//
export class PostLinksInternalErase extends RestfulEndpoint< {}, PostLinksInternalErase.Body, PostLinksInternalErase.Response >
{
    public readonly uri      : string = PostLinksInternalErase.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "eraseLinksContact",
        summary:     "Erase a contact's tracked-link attribution",
        description: "S2S forget hook — nulls contactId on every tracked link addressed to this contact. Aggregate counts are unaffected.",
        tags:        [ "Links" ],
    };

    constructor( body? : PostLinksInternalErase.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "accountId", "contactId" ], properties: { accountId: { type: "string" }, contactId: { type: "string" } } }; }
}

export namespace PostLinksInternalErase
{
    export const URI : string = apiPath( "links", 1, "/internal/erase" );
    export interface Body extends RestfulEndpoint.NonAuthRequest { accountId : string; contactId : string; }
    export interface Response { erased : number; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST }
}

export default PostLinksInternalErase;
// eof
