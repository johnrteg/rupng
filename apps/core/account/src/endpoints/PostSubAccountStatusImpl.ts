//
import { PostSubAccountStatus, Account } from '@repo/api';
import { NetworkUtils, ObjectUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import { Events } from '@repo/system';
import AccountService from '../services/AccountService';

//
// Suspend or reactivate a DIRECT sub-account of the acting account (parent admin action). Authorization: the
// target's parentId must equal the acting account — you may only change your own children.
//
//   • SUSPEND    — set the target SUSPENDED, then cascade to EVERY descendant. Descendants transitioned by
//                  the cascade are flagged `suspendedByAncestor` so a later reactivation knows to lift them;
//                  descendants already in a suspended/terminal state are left untouched (their own state wins).
//   • REACTIVATE — set the target ACTIVE and clear its flag, then reactivate only the descendants the cascade
//                  had suspended (flag set). Independently-suspended descendants stay suspended.
//
// `cascaded` in the response counts the descendants actually changed (excludes the target itself).
//
export class PostSubAccountStatusImpl extends PostSubAccountStatus
{
    private service : AccountService;
    constructor( service : AccountService ) { super(); this.service = service; }

    // statuses we won't override when cascading a suspend (terminal / already-off states keep their own meaning)
    private static readonly PROTECTED : ReadonlyArray<Account.Status> =
        [ Account.Status.SUSPENDED, Account.Status.DISABLED, Account.Status.CANCELLED, Account.Status.DELETED ];

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const subAccountId : string = this.query?.subAccountId ?? "";
        if( !subAccountId )  return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "subAccountId required" } };

        const nextStatus : Account.Status = this.body?.status as Account.Status;
        if( nextStatus !== Account.Status.SUSPENDED && nextStatus !== Account.Status.ACTIVE )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "status must be suspended or active" } };

        // target must exist AND be a direct child of the acting account
        const target : Type.Result<( Account.Entity ) | undefined> = await this.service.dynamo.get<Account.Entity>( "accounts", { accountId: subAccountId } );
        if( !target.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "sub-account read failed" } };
        if( !target.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "sub-account not found" } };
        if( target.data.parentId !== accountId )
            return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "not a sub-account of this account" } };

        const descendants : Array<Account.Entity> = await this.descendantsOf( subAccountId );

        const cascaded : number = nextStatus === Account.Status.SUSPENDED
            ? await this.suspend( target.data, descendants, ( this.body?.reason ?? "" ).trim() )
            : await this.reactivate( target.data, descendants );

        void this.service.emit( Events.Object.ACCOUNT_ACCOUNT, Events.Verb.UPDATED, "account", subAccountId, subAccountId, { id: subAccountId, status: nextStatus }, auth.userId );
        return { status: NetworkUtils.Status.OK, data: { subAccountId, status: nextStatus, cascaded } };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // Suspend the target + cascade to descendants; returns the count of descendants changed.
    private async suspend( target : Account.Entity, descendants : Array<Account.Entity>, reason : string ) : Promise<number>
    {
        await this.write( target, { status: Account.Status.SUSPENDED, suspendedReason: reason, suspendedByAncestor: false } );

        let changed : number = 0;
        for( const node of descendants )
        {
            if( PostSubAccountStatusImpl.PROTECTED.includes( node.status ) ) continue;   // leave already-off / terminal
            await this.write( node, { status: Account.Status.SUSPENDED, suspendedReason: "A parent account was suspended.", suspendedByAncestor: true } );
            changed++;
        }
        return changed;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // Reactivate the target + only the descendants the cascade suspended; returns the count changed.
    private async reactivate( target : Account.Entity, descendants : Array<Account.Entity> ) : Promise<number>
    {
        await this.write( target, { status: Account.Status.ACTIVE, suspendedReason: "", suspendedByAncestor: false } );

        let changed : number = 0;
        for( const node of descendants )
        {
            if( node.suspendedByAncestor !== true ) continue;   // independently suspended → leave it
            await this.write( node, { status: Account.Status.ACTIVE, suspendedReason: "", suspendedByAncestor: false } );
            changed++;
        }
        return changed;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // Merge a status patch onto an account row (preserving the accountId key + bumping modifiedAt).
    private async write( entity : Account.Entity, patch : Partial<Account.Entity> ) : Promise<void>
    {
        // backfill missing fields from the model DEFAULT so the row we write back is complete (self-healing)
        const merged : Record<string, unknown> = { ...( ObjectUtils.withDefaults( entity, Account.DEFAULT ) as unknown as Record<string, unknown> ), ...patch, accountId: entity.id, modifiedAt: new Date().toISOString() };
        const put : Type.Result<void> = await this.service.dynamo.put( "accounts", merged );
        if( !put.ok ) this.service.log.warn( "sub-account status write failed", { accountId: entity.id, error: put.error } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // Every descendant of `rootId` (children, grandchildren, …) via the accounts parentId GSI. Breadth-first
    // with a visited set so a malformed cycle can't loop forever.
    private async descendantsOf( rootId : string ) : Promise<Array<Account.Entity>> 
    {
        const out     : Array<Account.Entity> = [];
        const visited : Set<string> = new Set( [ rootId ] );
        let   frontier : Array<string> = [ rootId ];

        while( frontier.length > 0 )
        {
            const next : Array<string> = [];
            for( const parentId of frontier )
            {
                const kids : Type.Result<Array<Account.Entity>> = await this.service.dynamo.query<Account.Entity>( "accounts", {
                    IndexName:                 "parentId",
                    KeyConditionExpression:    "parentId = :p",
                    ExpressionAttributeValues: { ":p": parentId },
                } );
                if( !kids.ok ) continue;
                for( const child of kids.data )
                {
                    const childId : string = child.id ?? "";
                    if( childId === "" || visited.has( childId ) ) continue;
                    visited.add( childId );
                    out.push( child );
                    next.push( childId );
                }
            }
            frontier = next;
        }
        return out;
    }
}

export default PostSubAccountStatusImpl;
