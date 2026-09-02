//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import type { Dispatch } from "../dispatch/model/Dispatch";

//
// Read print's `WorkQueue` governor state (print-9.4) — queue depth vs its low-water-mark, resolved defaults,
// and the accounts currently active on it (fairness score, rate windows, suspension). Operator visibility
// only. APPLICATION.
//
export class GetPrintDispatchState extends RestfulEndpoint< {}, undefined, GetPrintDispatchState.Response >
{
    public readonly uri      : string = GetPrintDispatchState.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getPrintDispatchState",
        summary:     "Print dispatch (WorkQueue) operational state",
        description: "Queue depth/defaults and the currently-active accounts' fairness/rate/suspension state for print's WorkQueue governor.",
        tags:        [ "Print" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPrintDispatchState
{
    export const URI : string = apiPath( "print", 1, "/dispatch/state" );
    export interface Response { snapshot : Dispatch.QueueSnapshot; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetPrintDispatchState;
// eof
