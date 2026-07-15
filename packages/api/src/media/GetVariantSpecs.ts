//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// List the configured variant PROFILES (name → specs). A consumer (campaign / social) reads this to learn a
// platform's targets and request an asset be processed to confirm/produce its platform-fit renditions.
// Includes the generic "display" profile; named platform profiles come from MediaConfig (owned by their consumer).
export class GetVariantSpecs extends RestfulEndpoint<{}, undefined, GetVariantSpecs.Response>
{
    public readonly uri      : string = GetVariantSpecs.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVariantSpecs
{
    export const URI : string = apiPath( "media", 1, "/variant-specs" );
    export interface Response { profiles : Record<string, Array<Media.VariantSpec>>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetVariantSpecs;
