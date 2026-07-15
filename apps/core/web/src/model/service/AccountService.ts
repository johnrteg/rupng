//
import { GetMemberships, GetUserMeta, PostUserMeta, GetAccount, User, Account } from "@repo/api";
import { Access, RestfulService } from "@repo/endpoint";

import AppModel from "../AppModel";
import PubSubService from "./PubSubService";
import navModel from "@widgets/app/navigation/navModel";

//
// AccountService (web) — the accounts the signed-in user can act in + which one is current. A user belongs
// to 1..N accounts (auth/GetAccounts → memberships). The "current" account is remembered across sign-ins
// (LocalStorage); if the saved account is no longer in the list (they were removed), we reset to the
// account they OWN (the one they registered under), else the first available. Drives the nav's account
// switcher.
//
export class AccountService
{
    private appmodel : AppModel;

    public accounts : Array<User.Membership> = [];          // accounts the user can act in
    public current  : User.Membership | null = null;        // the account currently being acted in
    public palette  : Array<string> = [];                   // the acting account's brand palette (for app-wide color pickers)
    public fonts    : Array<Account.BrandFont> = [];        // the acting account's brand fonts (for app-wide font choices)

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( app : AppModel )
    {
        this.appmodel = app;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public makeEmpty() : void
    {
        this.accounts = [];
        this.current  = null;
        this.palette  = [];
        this.fonts    = [];
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** The user's "own" account — the one they own/registered under (the reset target). */
    private ownAccount() : User.Membership | null
    {
        return this.accounts.find( ( m : User.Membership ) => m.owner ) ?? null;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Load the user's accounts (account/GetMemberships) and pick the current one: the last account saved on
     * the user profile (user_meta) if they're still a member, else their OWN account, else the first
     * available — so a user removed from their last-used account resets to the one they registered under.
     * Publishes ACCOUNT so the UI (the switcher) re-renders. Best-effort — leaves the list empty on failure.
     */
    public async load() : Promise<void>
    {
        const reply : RestfulService.Reply<GetMemberships.Response> = await this.appmodel.server.fetch( new GetMemberships() );
        if( !reply.ok || !reply.data ) return;

        this.accounts = reply.data.accounts;

        // last account: prefer the server-saved preference (resumes on any device), then the local fallback
        const savedId : string | null = await this.savedAccountId() ?? this.appmodel.localStorage.currentAccount();
        const saved : User.Membership | undefined = this.accounts.find( ( m : User.Membership ) => m.accountId === savedId );

        this.applyCurrent( saved ?? this.ownAccount() ?? this.accounts[ 0 ] ?? null );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Make `account` the current one: cache it, remember it locally, apply the caller's role IN THAT account
     *  (drives the role-based nav), and broadcast ACCOUNT so the UI re-renders. */
    private applyCurrent( account : User.Membership | null ) : void
    {
        this.current = account;
        this.palette = [];   // cleared until the acting account's brand identity (re)loads below
        this.fonts   = [];
        // the effective role is the caller's max role in the ACTING account — so the nav reflects this account
        this.appmodel.auth.setRole( account ? account.maxRole : Access.AccountRole.USER );
        if( account )
        {
            this.appmodel.localStorage.setCurrentAccount( account.accountId );
            // tell the server which account we're acting in (X-Account) so it resolves the role for THIS
            // account on every request (the JWT is identity-only).
            this.appmodel.server.setHeader( "X-Account", account.accountId );
            // cache the acting account's brand palette for app-wide color pickers (best-effort, async)
            void this.loadPalette();
        }
        this.appmodel.pubsub.publish( PubSubService.Type.ACCOUNT, account );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Fetch the ACTING account's brand identity (Account.palette + Account.fonts, via the X-Account header) and
     *  cache it so every color picker / font choice can offer the account's brand. Best-effort — a miss leaves
     *  them empty. */
    private async loadPalette() : Promise<void>
    {
        const reply : RestfulService.Reply<GetAccount.Response> = await this.appmodel.server.fetch( new GetAccount() );
        this.palette = reply.ok && reply.data ? ( reply.data.palette ?? [] ) : [];
        this.fonts   = reply.ok && reply.data ? ( reply.data.fonts ?? [] ) : [];
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Switch the acting account (from the nav switcher): apply it, persist to the user profile (resumes next
     *  sign-in), and RE-SCOPE the view (back to the dashboard for the new account). No-op if the id isn't one
     *  the user can act in / is already current. */
    public switchTo( accountId : string ) : void
    {
        const next : User.Membership | undefined = this.accounts.find( ( m : User.Membership ) => m.accountId === accountId );
        if( !next || next.accountId === this.current?.accountId ) return;

        this.applyCurrent( next );
        void this.saveAccountId( next.accountId );    // persist to the user profile (user_meta)

        // stay on the current page after switching — UNLESS the new account's role can't reach it (then fall
        // back to the dashboard). applyCurrent() already broadcast ACCOUNT so the page re-renders in-context.
        const path : string = window.location.pathname;
        if( !navModel.pathAllowed( next.maxRole, path ) ) this.appmodel.goto( "/dashboard" );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** The last/current account id saved on the user profile (user_meta), or null. */
    private async savedAccountId() : Promise<string | null>
    {
        const reply : RestfulService.Reply<GetUserMeta.Response> = await this.appmodel.server.fetch( new GetUserMeta( { type: AccountService.CURRENT_ACCOUNT_META } ) );
        const entry = reply.ok && reply.data ? reply.data.meta[ 0 ] : undefined;
        const accountId : unknown = entry ? ( entry.object as { accountId? : unknown } ).accountId : undefined;
        return typeof accountId === "string" ? accountId : null;
    }

    /** Persist the current account id to the user profile (user_meta) — resumes on next sign-in, any device. */
    private async saveAccountId( accountId : string ) : Promise<void>
    {
        await this.appmodel.server.fetch( new PostUserMeta( { type: AccountService.CURRENT_ACCOUNT_META, object: { accountId } } ) );
    }
}

export namespace AccountService
{
    /** user_meta `type` under which the user's last/current account is stored on their profile. */
    export const CURRENT_ACCOUNT_META : string = "pref.currentAccount";
}

export default AccountService;
