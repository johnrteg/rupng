//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { ImportMap } from "./model/ImportMap";

//
// Create an account import map. Server assigns id / accountId / scope (ACCOUNT) / status (ACTIVE) / audit.
// ACCOUNT-gated (managing the account's maps). System maps are NOT created here — they're platform-seeded.
//
export class PostImportMap extends RestfulEndpoint< {}, PostImportMap.Body, PostImportMap.Response >
{
    public readonly uri      : string = PostImportMap.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createImportMap",
        summary:     "Create an import map",
        description: "Creates a reusable column→field import map for the account.",
        tags:        [ "Contact" ],
    };

    constructor( body? : PostImportMap.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "name", "target", "sourceFormat" ],
            properties: {
                name:          { type: "string", minLength: 1 },
                description:   { type: "string" },
                target:        { type: "string", enum: Object.values( ImportMap.Target ) },
                sourceFormat:  { type: "string", enum: Object.values( ImportMap.SourceFormat ) },
                parse:         { type: "object" },
                mappings:      { type: "array" },
                dedupe:        { type: "object" },
                defaultTags:   { type: "array", items: { type: "string" } },
                sampleHeaders: { type: "array", items: { type: "string" } },
            },
        };
    }
}

export namespace PostImportMap
{
    export const URI : string = apiPath( "contact", 1, "/importmaps" );

    export interface Body extends RestfulEndpoint.AuthRequest, ImportMap.Create {}
    export interface Response extends ImportMap.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostImportMap;
