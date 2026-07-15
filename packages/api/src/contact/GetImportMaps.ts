//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { ImportMap } from "./model/ImportMap";
import { Paging } from "../model/Paging";

//
// List import maps visible to the account — its OWN maps plus the platform SYSTEM catalog (both in one page).
// USER-gated (the import wizard + Settings manager both list them). Default hides archived + deleted maps.
//
export class GetImportMaps extends RestfulEndpoint< GetImportMaps.Query, undefined, GetImportMaps.Response >
{
    public readonly uri      : string = GetImportMaps.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listImportMaps",
        summary:     "List import maps",
        description: "Lists the account's own import maps plus the platform system catalog (system maps are read-only; copy to edit).",
        tags:        [ "Contact" ],
    };

    constructor( query? : GetImportMaps.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetImportMaps
{
    export const URI : string = apiPath( "contact", 1, "/importmaps" );

    export interface Query extends Paging.Request
    {
        status? : ImportMap.Status;    // default: hide archived + deleted
        target? : ImportMap.Target;    // filter to a destination (e.g. contact)
        scope?  : ImportMap.Scope;     // filter to system-only or account-only
    }
    export interface Response extends Paging.Result<ImportMap.Entity> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetImportMaps;
