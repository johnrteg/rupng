//
import { PutAccount, Account } from '@repo/api';
import { NetworkUtils, ObjectUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import { Events } from '@repo/system';
import AccountService from '../services/AccountService';

//
// Update the caller's ACTING account (X-Account → auth.accountId). Admin-only — the base authorize gate
// already enforced access=ACCOUNT before this runs. Merges only the editable subset (Account.Update) onto
// the stored row, bumps modifiedAt, and returns the updated Entity. Identity/lifecycle fields are never
// touched here.
//
export class PutAccountImpl extends PutAccount
{
    private service : AccountService;

    constructor( service : AccountService )
    {
        super();
        this.service = service;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        // read the current row
        const found : Type.Result<( Account.Entity & { accountId? : string } ) | undefined> =
            await this.service.dynamo.get<Account.Entity & { accountId? : string }>( "accounts", { accountId } );
        if( !found.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "account read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "account not found" } };

        // whitelist the editable fields from the body (ignore anything else the client sent)
        const patch  : Account.Update = this.body ?? {};
        const edits  : Partial<Account.Entity> = {};
        if( patch.name         !== undefined ) edits.name         = patch.name;
        if( patch.organization !== undefined ) edits.organization = patch.organization;
        if( patch.poc          !== undefined ) edits.poc          = patch.poc;
        if( patch.billingPoc   !== undefined ) edits.billingPoc   = patch.billingPoc;
        if( patch.website      !== undefined ) edits.website       = patch.website;
        if( patch.timezone     !== undefined ) edits.timezone     = patch.timezone;
        if( patch.address      !== undefined ) edits.address       = patch.address;
        if( patch.channels     !== undefined ) edits.channels     = patch.channels;
        if( patch.palette      !== undefined ) edits.palette      = patch.palette;
        if( patch.fonts        !== undefined ) edits.fonts        = patch.fonts;
        if( patch.svgs         !== undefined ) edits.svgs         = patch.svgs;

        // backfill any fields an older row is missing from the model DEFAULT, so the row we write back is
        // complete (self-healing on save); identity fields are never defaulted
        const current : Account.Entity & { accountId? : string } = ObjectUtils.withDefaults( found.data, Account.DEFAULT );

        // merge onto the stored row; keep the partition key + authoritative id; bump modifiedAt
        const merged : Record<string, unknown> = {
            ...current,
            ...edits,
            accountId,
            id:         found.data.id ?? accountId,
            modifiedAt: new Date().toISOString(),
        };

        const put = await this.service.dynamo.put( "accounts", merged );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "account write failed" } };

        const { accountId: _key, ...entity } = merged as unknown as ( Account.Entity & { accountId? : string } );
        void this.service.emit( Events.Object.ACCOUNT_ACCOUNT, Events.Verb.UPDATED, "account", accountId, accountId, entity, auth.userId );
        return { status: NetworkUtils.Status.OK, data: entity as PutAccount.Response };
    }
}

export default PutAccountImpl;
