//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Resume ONE account's print dispatch (print-9.4) — releases a prior `PostPrintDispatchSuspend` hold.
// APPLICATION.
//
export class PostPrintDispatchResume extends RestfulEndpoint< {}, PostPrintDispatchResume.Body, PostPrintDispatchResume.Response >
{
    public readonly uri      : string = PostPrintDispatchResume.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "resumePrintDispatch",
        summary:     "Resume an account's print dispatch",
        description: "Releases a prior suspend hold on one account's print WorkQueue governor.",
        tags:        [ "Print" ],
    };

    constructor( body? : PostPrintDispatchResume.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "accountId" ], properties: { accountId: { type: "string" } } }; }
}

export namespace PostPrintDispatchResume
{
    export const URI : string = apiPath( "print", 1, "/dispatch/resume" );
    export interface Body extends RestfulEndpoint.AuthRequest { accountId : string; }
    export interface Response { resumed : true; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PostPrintDispatchResume;
// eof
