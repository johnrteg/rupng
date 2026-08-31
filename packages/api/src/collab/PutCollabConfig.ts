//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { CollabConfig } from "./model/CollabConfig";

//
// Set the collab service's runtime config (AppConfig-backed). ROOT. The impl validates against
// CollabConfig.SCHEMA + persists to AppConfig.
//
export class PutCollabConfig extends RestfulEndpoint< {}, PutCollabConfig.Body, PutCollabConfig.Response >
{
    public readonly uri      : string = PutCollabConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "setCollabConfig",
        summary:     "Set collab service config",
        description: "Replaces the collab service's runtime configuration (validated against the config schema).",
        tags:        [ "Collab" ],
    };

    constructor( body? : PutCollabConfig.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // the config is a nested object; validate loosely here (the impl runs the strict CollabConfig.SCHEMA)
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, required: [ "config" ], properties: { config: { type: "object" } } }; }
}

export namespace PutCollabConfig
{
    export const URI : string = apiPath( "collab", 1, "/config" );
    export interface Body extends RestfulEndpoint.AuthRequest { config : CollabConfig.Config; }
    export interface Response { config : CollabConfig.Config; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PutCollabConfig;
// eof
