//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Switch the acting account/role (≤ the account-owned ceiling; may auto-clamp + step-up). Returns the
// new acting context so the client can re-render. (account owns eligibility; auth runs the mechanics.)
//
export class PostSessionSwitch extends RestfulEndpoint<{}, PostSessionSwitch.Body, PostSessionSwitch.Response>
{
    public readonly uri      : string = PostSessionSwitch.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostSessionSwitch.Body ) { super( {}, body ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: 'object', properties: { accountId: { type: 'string', minLength: 1 }, role: { type: 'string' } }, required: ['accountId'], additionalProperties: false };
    }
}

export namespace PostSessionSwitch
{
    export const URI : string = apiPath( "auth", 1, "/session/switch" );   // /api/auth/v1/session/switch

    export interface Body extends RestfulEndpoint.NonAuthRequest { accountId : string; role? : string; }
    export interface Response { accountId : string; role : string; clamped : boolean; }

    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostSessionSwitch;
