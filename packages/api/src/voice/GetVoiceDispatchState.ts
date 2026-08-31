//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import type { Dispatch } from "../dispatch/model/Dispatch";

//
// Read voice's `WorkQueue` governor state — queue depth vs its low-water-mark, resolved defaults, and the
// accounts currently active on it (fairness score, rate windows, suspension). Operator visibility only; the
// governor itself makes the dispatch decision (see `VoiceService.dispatchPending`) — this never mutates it.
// APPLICATION (an ops surface, not account-scoped).
//
export class GetVoiceDispatchState extends RestfulEndpoint< {}, undefined, GetVoiceDispatchState.Response >
{
    public readonly uri      : string = GetVoiceDispatchState.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getVoiceDispatchState",
        summary:     "Voice dispatch (WorkQueue) operational state",
        description: "Queue depth/defaults and the currently-active accounts' fairness/rate/suspension state for voice's WorkQueue governor.",
        tags:        [ "Voice" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVoiceDispatchState
{
    export const URI : string = apiPath( "voice", 1, "/dispatch/state" );
    export interface Response { snapshot : Dispatch.QueueSnapshot; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetVoiceDispatchState;
// eof
