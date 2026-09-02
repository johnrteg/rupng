//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Audit } from "./model/Audit";

//
// Place OR release a legal hold on a scope (account / subject / time-range) — a litigation/investigation
// freeze that overrides retention expiry until released (audit-4.2). ROOT only (a hold changes what the
// platform is legally obligated to retain, not an ops toggle).
//
export class PostAuditLegalHold extends RestfulEndpoint< {}, PostAuditLegalHold.Body, PostAuditLegalHold.Response >
{
    public readonly uri      : string = PostAuditLegalHold.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "postAuditLegalHold",
        summary:     "Place or release a legal hold",
        description: "Places a NEW legal hold (mode: place) or releases an existing one by holdId (mode: release).",
        tags:        [ "Audit" ],
    };

    constructor( body? : PostAuditLegalHold.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "mode" ], properties: {
            mode:      { type: "string", enum: [ "place", "release" ] },
            accountId: { type: "string" },
            subjectId: { type: "string" },
            from:      { type: "string" },
            to:        { type: "string" },
            reason:    { type: "string" },
            holdId:    { type: "string" },
        } };
    }
}

export namespace PostAuditLegalHold
{
    export const URI : string = apiPath( "audit", 1, "/legal-hold" );

    export type Body = RestfulEndpoint.AuthRequest & (
        | { mode : "place"; accountId : Type.ID; subjectId? : Type.ID; from? : Type.ISODateTime; to? : Type.ISODateTime; reason : string }
        | { mode : "release"; holdId : Type.ID }
    );

    export interface Response extends Audit.LegalHold {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostAuditLegalHold;
// eof
