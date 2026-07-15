//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { ImportMap } from "./model/ImportMap";

//
// Copy an existing map (a SYSTEM catalog map or one of the account's own) into the account's space as a new,
// editable ACCOUNT map. This is the primitive behind "start from a system map" and "clone-and-tweak". The new
// map records `sourceMapId`; the original is untouched. ACCOUNT-gated.
//
export class PostImportMapCopy extends RestfulEndpoint< PostImportMapCopy.Query, PostImportMapCopy.Body, PostImportMapCopy.Response >
{
    public readonly uri      : string = PostImportMapCopy.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "copyImportMap",
        summary:     "Copy an import map",
        description: "Clones a system or account map into the account as a new editable map (records sourceMapId).",
        tags:        [ "Contact" ],
        errors:      { 404: "No such import map visible to this account" },
    };

    constructor( id? : string, body? : PostImportMapCopy.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties: { name: { type: "string", minLength: 1 } },
        };
    }
}

export namespace PostImportMapCopy
{
    export const URI : string = apiPath( "contact", 1, "/importmaps/:id/copy" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        name? : string;    // optional new name (defaults to "<original> (copy)")
    }
    export interface Response extends ImportMap.Entity {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostImportMapCopy;
