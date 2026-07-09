//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Email } from "./model/Email";

//
// Control a BLAST (email-1.9) — SUSPEND (pause mid-fan-out), RESUME (continue from the cursor), or RESCHEDULE
// (change `startAt`, re-validated against the safe buffer). Works while the blast is SCHEDULED or SENDING. A
// state-changing action → confirmed in the UI. Body validated loosely (the impl runs the state-machine check).
//
export class PatchEmailBlast extends RestfulEndpoint< PatchEmailBlast.Query, PatchEmailBlast.Body, PatchEmailBlast.Response >
{
    public readonly uri      : string = PatchEmailBlast.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "controlEmailBlast",
        summary:     "Control an email blast",
        description: "Suspends, resumes, or reschedules a scheduled/in-progress blast.",
        tags:        [ "Email" ],
    };

    constructor( id? : string, body? : PatchEmailBlast.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "action" ],
            properties: { action: { type: "string", enum: Object.values( Email.BlastAction ) }, startAt: { type: "string" } },
        };
    }
}

export namespace PatchEmailBlast
{
    export const URI : string = apiPath( "email", 1, "/blasts/:id" );
    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { action : Email.BlastAction; startAt? : string; }
    export interface Response { blast : Email.Blast; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
        CONFLICT     = NetworkUtils.Status.CONFLICT,   // action invalid for the current status
    }
}

export default PatchEmailBlast;
// eof
