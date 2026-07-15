//
import { randomUUID } from "node:crypto";

import { Dynamo } from "@repo/services";
import { AuthAction } from "@repo/api";
import type { Type } from "@repo/common";

//
// ActionStore — the pending no-auth ACTION queue (the `auth_actions` DDB table: PK actionId, TTL expiresAt,
// GSI byStatus). Mints TTL landing tokens (verify / reset / mfa / invite / unsubscribe), verifies + consumes
// them, cancels them, and lists them for the Console. Rows auto-expire via the DynamoDB TTL, so old ones fade
// off on their own. Never throws — returns `Type.Result`.
//
export class ActionStore
{
    private static readonly TABLE : string = "auth_actions";

    constructor( private readonly dynamo : Dynamo ) {}

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Mint a pending action — status PENDING, `expiresAt` = now + the type's window (minutes → epoch seconds). */
    public async create( input : ActionStore.CreateInput ) : Promise<Type.Result<AuthAction.Entity>>
    {
        const now : Date = new Date();
        const ttlMinutes : number = input.ttlMinutes ?? AuthAction.DEFAULT_TTL_MINUTES[ input.type ] ?? 60;
        const entity : AuthAction.Entity =
        {
            actionId:    randomUUID(),
            type:        input.type,
            status:      AuthAction.Status.PENDING,
            target:      input.target,
            accountId:   input.accountId,
            userId:      input.userId,
            createdAt:   now.toISOString(),
            expiresAt:   Math.floor( now.getTime() / 1000 ) + ttlMinutes * 60,
            requestedBy: input.requestedBy,
            params:      input.params,
        };
        const wrote : Type.Result<void> = await this.dynamo.put( ActionStore.TABLE, { ...entity } );
        if( !wrote.ok ) return { ok: false, error: wrote.error, cause: wrote.cause };
        return { ok: true, data: entity };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Fetch an action by its id (= the URL token), or undefined. */
    public async get( actionId : string ) : Promise<Type.Result<AuthAction.Entity | undefined>>
    {
        return this.dynamo.get<AuthAction.Entity>( ActionStore.TABLE, { actionId } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Mark an action CONSUMED (stamping `consumedAt`) — the caller has already validated it's usable. */
    public async consume( entity : AuthAction.Entity ) : Promise<Type.Result<AuthAction.Entity>>
    {
        const consumed : AuthAction.Entity = { ...entity, status: AuthAction.Status.CONSUMED, consumedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.dynamo.put( ActionStore.TABLE, { ...consumed } );
        if( !wrote.ok ) return { ok: false, error: wrote.error, cause: wrote.cause };
        return { ok: true, data: consumed };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Cancel a pending action (marks CANCELLED). Returns false when there's nothing to cancel. */
    public async cancel( actionId : string ) : Promise<Type.Result<boolean>>
    {
        const got : Type.Result<AuthAction.Entity | undefined> = await this.get( actionId );
        if( !got.ok ) return { ok: false, error: got.error, cause: got.cause };
        if( !got.data || got.data.status !== AuthAction.Status.PENDING ) return { ok: true, data: false };
        const cancelled : AuthAction.Entity = { ...got.data, status: AuthAction.Status.CANCELLED, cancelledAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.dynamo.put( ActionStore.TABLE, { ...cancelled } );
        if( !wrote.ok ) return { ok: false, error: wrote.error, cause: wrote.cause };
        return { ok: true, data: true };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** List actions of a given status (via the byStatus GSI), newest first. `status` is a DDB reserved word →
     *  aliased through `#s`. */
    public async list( status : AuthAction.Status ) : Promise<Type.Result<Array<AuthAction.Entity>>>
    {
        return this.dynamo.query<AuthAction.Entity>( ActionStore.TABLE, {
            IndexName:                 "status",
            KeyConditionExpression:    "#s = :s",
            ExpressionAttributeNames:  { "#s": "status" },
            ExpressionAttributeValues: { ":s": status },
        } );
    }
}

export namespace ActionStore
{
    /** The inputs to mint an action (the type's default window applies unless `ttlMinutes` overrides it). */
    export interface CreateInput
    {
        type        : AuthAction.Type;
        target      : string;
        accountId?  : string;
        userId?     : string;
        ttlMinutes? : number;
        requestedBy? : string;
        params?     : Record<string, string>;
    }
}

export default ActionStore;
// eof
