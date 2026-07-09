//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { ImportMap } from "./model/ImportMap";

//
// Edit an account import map — name / description / target / sourceFormat / parse / mappings / dedupe /
// defaultTags / sampleHeaders / status. `version` is bumped server-side on each edit. ACCOUNT-gated. A SYSTEM
// map is read-only — editing one returns 403 (copy it into the account first).
//
export class PatchImportMap extends RestfulEndpoint< PatchImportMap.Query, PatchImportMap.Body, PatchImportMap.Response >
{
    public readonly uri      : string = PatchImportMap.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateImportMap",
        summary:     "Update an import map",
        description: "Edits an account import map. System maps are read-only (403 — copy first).",
        tags:        [ "Contact" ],
        errors:      { 403: "System maps are read-only — copy the map to edit it", 404: "No such import map in this account" },
    };

    constructor( id? : string, body? : PatchImportMap.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: true, properties: {} };
    }
}

export namespace PatchImportMap
{
    export const URI : string = apiPath( "contact", 1, "/importmaps/:id" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest, ImportMap.Update
    {
        status? : ImportMap.Status;    // archive / activate a map
    }
    export interface Response extends ImportMap.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,   // system map — read-only
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PatchImportMap;
