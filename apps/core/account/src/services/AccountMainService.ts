//
import { randomUUID } from "node:crypto";

import { Account } from "@repo/api";
import { Events } from "@repo/system";

import AccountService from './AccountService';

//
// MAIN role — the authed account BFF: account CRUD + status, hierarchy/sub-accounts, members & roles,
// plans/pricing, subscriptions/invoicing, billing ops. (Writes live here; reads scale on the read role.)
//
// It also runs the **account-provisioning consumer**: when auth publishes `auth.user.created` (a new
// verified identity), this service mints that user's primary account + owner membership and republishes
// `account.account.created` — the middle link of the event-driven sign-up chain
// (auth.user.created → [account] → account.account.created → app).
//
export class AccountMainService extends AccountService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AccountService.Role.MAIN );
    }

    /////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        await super.init();
        await this.startProvisioningConsumer();
    }

    /////////////////////////////////////////////////////////////////////
    // Subscribe to auth.user. Best-effort: a Kafka outage must not stop the service from booting (the
    // HTTP API still serves) — log and carry on; provisioning resumes when the bus is reachable.
    private async startProvisioningConsumer() : Promise<void>
    {
        try
        {
            await this.kafka.subscribeEvents( "account-provisioning", Events.Object.AUTH_USER, async ( event ) =>
            {
                if( event.verb === Events.Verb.CREATED )
                    await this.provisionAccount( event.data as AccountMainService.NewUser );
                // returning normally COMMITS the offset; THROWING redelivers (at-least-once) — provisionAccount is idempotent.
            } );
            this.log.info( "account-provisioning consumer subscribed", { topic: Events.Object.AUTH_USER } );
        }
        catch( error )
        {
            this.log.warn( "account-provisioning consumer failed to start (bus unreachable?) — accounts won't auto-provision until restart", { error: String( error ) } );
        }
    }

    /////////////////////////////////////////////////////////////////////
    // Create the user's primary account + owner membership, then publish account.account.created.
    // Idempotent: if the user already owns an account (members GSI userId), do nothing — so a redelivered
    // auth.user.created can't create duplicates.
    private async provisionAccount( user : AccountMainService.NewUser ) : Promise<void>
    {
        const userId : string = user.userId;
        if( !userId ) return;

        const existing = await this.dynamo.query<{ accountId : string }>( "members", {
            IndexName:                 "userId",
            KeyConditionExpression:    "userId = :u",
            ExpressionAttributeValues: { ":u": userId },
        } );
        if( existing.ok && existing.data.length > 0 )
        {
            this.log.info( "account already provisioned for user — skipping", { userId } );
            return;
        }

        const now       : string = new Date().toISOString();
        const accountId : string = randomUUID();
        const fullName  : string = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();

        const account : Account.Entity =
        {
            id:              accountId,
            name:            user.accountName || fullName || "New Account",
            status:          Account.Status.ACTIVE,
            organization:    { type: Account.OrganizationType.OTHER },
            parentAccess:    Account.ParentAccess.GRANTED,
            tags:            [],
            suspendedReason: "",
            poc:             { name: fullName || ( user.accountName ?? "" ), email: user.email ?? "" },
            timezone:        "UTC",
            featureFlags:    {},
            joinCode:        accountId.slice( 0, 8 ),
            address:         {} as Account.Entity[ "address" ],
            createdAt:       now,
            modifiedAt:      now,
        };

        await this.dynamo.put( "accounts", account as unknown as Record<string, unknown> );
        await this.dynamo.put( "members", {
            accountId,
            userId,
            role:      "account",        // the account-ladder owner role (Access.AccountRole.ACCOUNT)
            status:    "active",
            createdAt: now,
        } );

        this.log.info( "provisioned account for new user", { userId, accountId } );

        // republish: account.account.created — app (and other subscribers) consume this.
        await this.kafka.publishEvent( {
            version:    "1",
            eventId:    randomUUID(),
            occurredAt: now,
            accountId,
            actor:      { kind: Events.ActorKind.SERVICE, id: "account", onBehalfOfId: userId },
            object:     Events.Object.ACCOUNT_ACCOUNT,
            verb:       Events.Verb.CREATED,
            action:     Events.actionOf( Events.Object.ACCOUNT_ACCOUNT, Events.Verb.CREATED ),
            target:     { type: "account", id: accountId },
            source:     { channel: Events.SourceChannel.JOB },
            outcome:    Events.Outcome.SUCCESS,
            data:       account,
            sinks:      [ Events.Sink.KAFKA ],
        } );
    }
}

export namespace AccountMainService
{
    /** The auth.user.created payload this service consumes (mirrors auth's UserStore.Confirmed). */
    export interface NewUser
    {
        userId       : string;
        email?       : string;
        phone?       : string;
        firstName?   : string;
        lastName?    : string;
        accountName? : string;
    }
}

export default AccountMainService;
