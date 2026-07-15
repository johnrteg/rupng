//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { ImportMap } from "./model/ImportMap";

//
// Fetch a single import map by id — the account's own map or a visible SYSTEM map. USER-gated. 404 when the
// id isn't a map the account can see.
//
export class GetImportMap extends RestfulEndpoint< GetImportMap.Query, undefined, GetImportMap.Response >
{
    public readonly uri      : string = GetImportMap.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getImportMap",
        summary:     "Get an import map",
        description: "Fetches one import map (the account's own, or a visible system map) by id.",
        tags:        [ "Contact" ],
        errors:      { 404: "No such import map visible to this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetImportMap
{
    export const URI : string = apiPath( "contact", 1, "/importmaps/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response extends ImportMap.Entity {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetImportMap;
