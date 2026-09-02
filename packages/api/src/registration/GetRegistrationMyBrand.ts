//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";

//
// Get the CALLER'S OWN brand (registration-1.0/1.1) — brand-per-account means there's no id to look up by
// until one exists, so `GetRegistrationBrand` (fetch-by-id) alone can't answer "does my account have a brand
// yet, and what's its status" — the question every registration UI needs answered first. `brand` is
// undefined when the account hasn't created one yet (not a 404 — "no brand yet" is a normal state, not an error).
//
export class GetRegistrationMyBrand extends RestfulEndpoint< {}, undefined, GetRegistrationMyBrand.Response >
{
    public readonly uri      : string = GetRegistrationMyBrand.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getRegistrationMyBrand",
        summary:     "Get the caller's own brand",
        description: "Fetches the caller's account brand, if one has been created. `brand` is absent (not a 404) when none exists yet.",
        tags:        [ "Registration" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetRegistrationMyBrand
{
    export const URI : string = apiPath( "registration", 1, "/brand-mine" );   // NOT /brand/mine — avoids ambiguity with GetRegistrationBrand's /brand/:brandId
    export interface Response { brand? : Registration.Brand; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetRegistrationMyBrand;
// eof
