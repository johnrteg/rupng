//
import { randomUUID } from "crypto";
import { PostAuditLegalHold, Audit as AuditWire } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/system";
import { ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

import AuditQueryService from "../services/AuditQueryService";
import { Audit } from "../AuditModel";

//
// Place OR release a legal hold (audit-4.2) — ROOT only. Both actions land in the trail (the SAME
// `Application.audit()` path every action uses — a hold's own placement/release is exactly the kind
// of admin action the trail exists to record).
//
export class PostAuditLegalHoldImpl extends PostAuditLegalHold
{
    private service : AuditQueryService;
    constructor( service : AuditQueryService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !this.body )   return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "body is required" } };

        return this.body.mode === "place"
            ? this.place( this.body, auth.userId )
            : this.release( this.body, auth.userId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async place( body : PostAuditLegalHold.Body & { mode : "place" }, actorUserId : string ) : Promise<RestfulEndpoint.Response>
    {
        if( !body.accountId || !body.reason ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId + reason are required" } };

        const hold : Audit.LegalHold =
        {
            holdId:    randomUUID(),
            accountId: body.accountId,
            subjectId: body.subjectId,
            from:      body.from,
            to:        body.to,
            reason:    body.reason,
            placedBy:  actorUserId,
            placedAt:  new Date().toISOString(),
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "legal_holds", { ...hold } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not place the hold" } };

        await this.service.audit( {
            action:      Events.actionOf( Events.Object.AUDIT_LEGAL_HOLD, Events.Verb.CREATED ),
            accountId:   hold.accountId,
            target:      { type: "legal_hold", id: hold.holdId },
            actorUserId,
            context:     { subjectId: hold.subjectId ?? null },
        } );

        return { status: NetworkUtils.Status.OK, data: hold as AuditWire.LegalHold };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async release( body : PostAuditLegalHold.Body & { mode : "release" }, actorUserId : string ) : Promise<RestfulEndpoint.Response>
    {
        if( !body.holdId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "holdId is required" } };

        // legal_holds' PK is accountId (unknown from a bare holdId) — find it via a Scan; the table is
        // small and holds are rare, so this is cheap. (Same tradeoff as AuditRetentionJob's own Scan.)
        const found : Audit.LegalHold | undefined = await this.findByHoldId( body.holdId );
        if( !found ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "no such hold" } };
        if( found.releasedAt ) return { status: NetworkUtils.Status.OK, data: found as AuditWire.LegalHold };   // already released — idempotent

        const released : Audit.LegalHold = { ...found, releasedBy: actorUserId, releasedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "legal_holds", { ...released } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not release the hold" } };

        await this.service.audit( {
            action:      Events.actionOf( Events.Object.AUDIT_LEGAL_HOLD, Events.Verb.DELETED ),
            accountId:   released.accountId,
            target:      { type: "legal_hold", id: released.holdId },
            actorUserId,
        } );

        return { status: NetworkUtils.Status.OK, data: released as AuditWire.LegalHold };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async findByHoldId( holdId : Type.ID ) : Promise<Audit.LegalHold | undefined>
    {
        const page = await this.service.dynamo.client.send( new ScanCommand( {
            TableName: this.service.dynamo.table( "legal_holds" ),
            FilterExpression: "holdId = :h",
            ExpressionAttributeValues: { ":h": { S: holdId } },
        } ) );
        const item = ( page.Items ?? [] )[ 0 ];
        return item ? ( unmarshall( item ) as Audit.LegalHold ) : undefined;
    }
}

export default PostAuditLegalHoldImpl;
