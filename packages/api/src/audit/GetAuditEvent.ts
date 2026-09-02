//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Audit } from "./model/Audit";

//
// Fetch a single audit event by id (tenant-scoped — 404s across tenants, never leaks existence).
// ACCOUNT admin only.
//
export class GetAuditEvent extends RestfulEndpoint< GetAuditEvent.Query, undefined, GetAuditEvent.Response >
{
    public readonly uri      : string = GetAuditEvent.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getAuditEvent",
        summary:     "Get a single audit event",
        description: "Fetches one audit event by id, scoped to the caller's account.",
        tags:        [ "Audit" ],
        errors:      { 404: "No such event in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetAuditEvent
{
    export const URI : string = apiPath( "audit", 1, "/events/:id" );

    export interface Query { id : Type.ID; }

    export interface Response extends Audit.EventView {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetAuditEvent;
// eof
