//
import type AppModel from "../AppModel";
import { Account, GetMembers, User } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

//
// CacheService — in-memory caches shared across the app. Currently: a USER-INFO cache keyed by userId (name /
// email / avatar asset guid / role / status). It's populated in ONE call from the account's member list
// (GetMembers) and seeded from the signed-in session; individual surfaces (UserChip, UserAvatar, activity
// lists, …) read a user's info by id WITHOUT re-fetching or reloading the physical avatar image (only the
// avatar GUID is cached — UserAvatar resolves + caches the actual variant URL). Websockets will keep it in
// sync later; today it refreshes on account switch (reset) + on demand.
//
export default class CacheService
{
    public tracker : boolean;

    private readonly app : AppModel;
    private readonly users : Map<string, CacheService.UserInfo> = new Map<string, CacheService.UserInfo>();
    private usersLoaded : boolean = false;
    private loading : Promise<void> | null = null;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( app : AppModel )
    {
        this.app     = app;
        this.tracker = true;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public makeEmpty() : void
    {
        this.tracker = true;
        this.resetUsers();
    }

    // ── user-info cache ─────────────────────────────────────────────────────────────────────────────────────
    /** A cached user's info (by userId) — enough to render them anywhere without a per-user fetch. */
    public getUser( userId : string ) : CacheService.UserInfo | undefined { return this.users.get( userId ); }

    /** Upsert one user's info (merges over any existing entry). */
    public putUser( info : CacheService.UserInfo ) : void
    {
        if( !info.userId ) return;
        this.users.set( info.userId, { ...this.users.get( info.userId ), ...info } );
    }

    /** Clear the user cache — call on account switch (membership differs per account). */
    public resetUsers() : void { this.users.clear(); this.usersLoaded = false; this.loading = null; }

    /** Ensure the account's users are cached (one GetMembers call + the session seed). Idempotent + coalesced;
     *  pass `force` to refresh. Safe to call from many places — the fetch runs once. */
    public async loadAccountUsers( force : boolean = false ) : Promise<void>
    {
        if( this.usersLoaded && !force ) return;
        if( this.loading !== null ) return this.loading;
        this.loading = this.doLoad();
        try { await this.loading; this.usersLoaded = true; }
        finally { this.loading = null; }
    }

    // seed the acting user from the session (has avatarAssetId) + the account's members (one call)
    private async doLoad() : Promise<void>
    {
        const me : User.Entity | null = this.app.auth.user;
        if( me ) this.putUser( { userId: me.id, name: ( `${ me.firstName ?? "" } ${ me.lastName ?? "" }` ).trim() || me.displayName, email: me.email, avatarAssetId: me.avatarAssetId } );

        const reply : RestfulService.Reply<GetMembers.Response> = await this.app.server.fetch( new GetMembers() );
        if( !reply.ok || !reply.data ) return;
        reply.data.records.forEach( ( member : Account.Member ) : void =>
            this.putUser( { userId: member.userId, name: member.name, email: member.email, avatarAssetId: member.avatarAssetId, role: String( member.role ), status: String( member.status ) } ) );
    }
}

export namespace CacheService
{
    /** Cached, display-ready info about a user. `avatarAssetId` is the media guid (not the image) — UserAvatar
     *  resolves the actual variant URL and caches that separately. */
    export interface UserInfo
    {
        userId         : string;
        name?          : string;
        email?         : string;
        avatarAssetId? : string;
        role?          : string;
        status?        : string;
    }
}
