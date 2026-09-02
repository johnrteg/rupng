//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Suspend ONE account's print dispatch (print-9.4) — holds that account's mailpieces on the `WorkQueue`
// governor (priority 0, per-channel) without affecting any other account or channel. APPLICATION.
//
export class PostPrintDispatchSuspend extends RestfulEndpoint< {}, PostPrintDispatchSuspend.Body, PostPrintDispatchSuspend.Response >
{
    public readonly uri      : string = PostPrintDispatchSuspend.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "suspendPrintDispatch",
        summary:     "Suspend an account's print dispatch",
        description: "Holds one account's mailpieces on print's WorkQueue governor (this channel only) until resumed.",
        tags:        [ "Print" ],
    };

    constructor( body? : PostPrintDispatchSuspend.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "accountId" ], properties: { accountId: { type: "string" } } }; }
}

export namespace PostPrintDispatchSuspend
{
    export const URI : string = apiPath( "print", 1, "/dispatch/suspend" );
    export interface Body extends RestfulEndpoint.AuthRequest { accountId : string; }
    export interface Response { suspended : true; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PostPrintDispatchSuspend;
// eof
