//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Browse } from "./model/Browse";
import { Media } from "./model/Media";

// Import (download-free or purchase) a provider asset into the account library (media-15). The service fetches
// the licensed bytes, creates a normal Media.Asset (scope ACCOUNT) with `source.origin = provider`, and runs
// the standard scan → process pipeline. Async: returns the created (SCANNING) asset; the client polls status.
export class PostBrowseImport extends RestfulEndpoint<{}, PostBrowseImport.Body, PostBrowseImport.Response>
{
    public readonly uri      : string = PostBrowseImport.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostBrowseImport.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "provider", "externalId" ], properties: {
            provider:   { type: "string", enum: Object.values( Browse.Provider ) },
            externalId: { type: "string", minLength: 1 },
            purchase:   { type: "boolean" },   // true = a priced acquisition (billed); false/absent = free download
        } };
    }
}

export namespace PostBrowseImport
{
    export const URI : string = apiPath( "media", 1, "/browse/import" );
    export interface Body extends RestfulEndpoint.AuthRequest { provider : Browse.Provider; externalId : string; purchase? : boolean; }
    export interface Response { asset : Media.Asset; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, PAYMENT_REQD = NetworkUtils.Status.PAYMENT_REQD, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostBrowseImport;
