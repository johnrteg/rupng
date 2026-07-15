//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Email } from "./model/Email";

//
// Start a BATCH email send (email-1.8/1.9) — a tracked BLAST addressed to a recipient list (contact UUIDs
// and/or email/name literals) and/or a segment the service expands. PUBLIC (public API, SENDER). Returns the
// created Blast (SCHEDULED) with a 202; the batch worker expands the audience, paces the fan-out per the
// schedule (rate + warm-up), and enqueues one send per recipient. Body validated loosely.
//
export class PostEmailBatch extends RestfulEndpoint< {}, PostEmailBatch.Body, PostEmailBatch.Response >
{
    public readonly uri      : string = PostEmailBatch.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "sendEmailBatch",
        summary:     "Start an email batch/blast",
        description: "Starts a tracked batch send (blast) to a recipient list and/or a contact segment, paced by an optional schedule (rate + warm-up). Returns the blast; the worker fans out per recipient.",
        tags:        [ "Email" ],
    };

    constructor( body? : PostEmailBatch.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        // loose — the batch worker resolves the audience / template / schedule and does full validation
        return { type: "object", additionalProperties: true, required: [ "audience" ], properties: { audience: { type: "object" } } };
    }

    // success body — the created blast (202)
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", required: [ "blast" ],
            properties: {
                blast: {
                    type: "object", description: "The created blast (SCHEDULED).",
                    properties: {
                        id:       { type: "string", description: "Blast id (suspend/resume/cancel by this)." },
                        status:   { type: "string", enum: Object.values( Email.BlastStatus ), description: "Lifecycle status." },
                        total:    { type: "number", description: "Resolved recipient count (0 until expanded)." },
                        sent:     { type: "number", description: "Recipients enqueued so far (the resume cursor)." },
                        startAt:  { type: "string", format: "date-time", description: "Effective start (after the safe buffer)." },
                    },
                },
            },
        };
    }
}

export namespace PostEmailBatch
{
    export const URI : string = apiPath( "email", 1, "/batch" );
    export interface Body extends RestfulEndpoint.AuthRequest, Email.BatchSendRequest {}
    export interface Response { blast : Email.Blast; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
    }
}

export default PostEmailBatch;
// eof
