//
import { randomUUID } from "node:crypto";

import { Application, Service, Register, Dynamo, Cache, Ports } from "@repo/services";
import { CollabConfig, Collab } from "@repo/api";
import { ObjectUtils } from "@repo/common";
import type { Type } from "@repo/common";

//
// CollabService — the collab domain's Service BASE (not deployed alone). Holds the shared domain wiring
// (Dynamo + Redis facades, the runtime config reader, room/member/message/presence CRUD) so both concrete
// roles (CollabControlService, CollabRoomServer) inherit it. v1 SCOPE IS CHAT ONLY — see CloudManifest.ts /
// SPECS.md for what's deferred (Y.js/Hocuspocus doc rooms, per-room KMS envelope encryption, GDPR erasure job).
//
export class CollabService extends Service
{
    private _dynamo? : Dynamo;
    private _cache?  : Cache;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : CollabService.Role )
    {
        // super( serviceId, role, defaultLocalPort ) — env PORT overrides the default when set.
        super( Register.Service.COLLAB, role, CollabService.PORT[ role ] );

        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the SoT for rooms/members/messages. Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    /** Redis facade — room registry + live presence + cross-node pub/sub. Lazy + cached. */
    public get cache() : Cache { return this._cache ??= new Cache( this.cloud, "cache" ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Seed the runtime config on a fresh environment so the service (and the Console Config tab) have usable
     *  defaults from first boot. */
    protected override async init() : Promise<void>
    {
        super.init();
        const seeded : Type.Result<CollabConfig.Config> = await this.appConfig.ensureSeeded( "config", "settings", CollabConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "collab config ready" );
        else this.log.warn( "collab config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig config/settings), deep-filled from DEFAULT so an older/partial
     *  hosted row tolerates schema drift. */
    public async collabConfig() : Promise<CollabConfig.Config>
    {
        const got : Type.Result<CollabConfig.Config | undefined> = await this.appConfig.json<CollabConfig.Config>( "config", "settings" );
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, CollabConfig.DEFAULT ) : CollabConfig.DEFAULT;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Persist a new config version + deploy it (AppConfig control plane) — the PUT-config write path. */
    public async saveConfig( config : CollabConfig.Config, environment : string = process.env.APPCONFIG_ENV ?? "default" ) : Promise<Type.Result<void>>
    {
        const profileId : Type.Result<string> = await this.appConfig.profileId( "config", "settings" );
        if( !profileId.ok ) return { ok: false, error: profileId.error };
        const environmentId : Type.Result<string> = await this.appConfig.environmentId( "config", environment );
        if( !environmentId.ok ) return { ok: false, error: environmentId.error };

        const version : Type.Result<number> = await this.appConfig.createVersion( "config", profileId.data, JSON.stringify( config ) );
        if( !version.ok ) return { ok: false, error: version.error };
        const deployed : Type.Result<number> = await this.appConfig.deploy( "config", profileId.data, environmentId.data, version.data, { description: "collab config update" } );
        if( !deployed.ok ) return { ok: false, error: deployed.error };
        return { ok: true, data: undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Rooms ──────────────────────────────────────────────────────────────────────────────────

    /** Create a CHANNEL room; the caller becomes owner + first member. Rooms never expire (no TTL — only
     *  messages do; the room record + its membership are durable for the account's lifetime). */
    public async createRoom( accountId : string, ownerId : string, name : string, visibility : Collab.Visibility ) : Promise<Type.Result<Collab.Room>>
    {
        const now : string = new Date().toISOString();
        const room : Collab.Room = {
            accountId, roomId: randomUUID(), type: Collab.RoomType.CHANNEL, visibility, name, ownerId,
            memberIds: [ ownerId ], createdAt: now, updatedAt: now,
        };
        const wrote : Type.Result<void> = await this.dynamo.put( "collab_rooms", { ...room } );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        const added : Type.Result<void> = await this.addMember( room.roomId, ownerId );
        if( !added.ok ) return { ok: false, error: added.error };
        return { ok: true, data: room };
    }

    /** Find the existing 1:1 DM room between two users (in the same account), or create it. Repeat calls with
     *  the same pair always resolve to the SAME room — never a duplicate. */
    public async findOrCreateDm( accountId : string, userId : string, otherUserId : string ) : Promise<Type.Result<Collab.Room>>
    {
        const mine : Type.Result<Array<{ roomId : string }>> = await this.dynamo.query<{ roomId : string }>( "collab_members", {
            IndexName: "userId", KeyConditionExpression: "userId = :u",
            ExpressionAttributeValues: { ":u": userId },
        } );
        if( mine.ok )
        {
            for( const row of mine.data )
            {
                const theirs : Type.Result<{ userId : string } | undefined> = await this.dynamo.get( "collab_members", { roomId: row.roomId, userId: otherUserId } );
                if( !theirs.ok || theirs.data === undefined ) continue;
                const room : Type.Result<Collab.Room | undefined> = await this.getRoom( accountId, row.roomId );
                if( room.ok && room.data && room.data.type === Collab.RoomType.DM ) return { ok: true, data: room.data };
            }
        }

        const now : string = new Date().toISOString();
        const room : Collab.Room = {
            accountId, roomId: randomUUID(), type: Collab.RoomType.DM, visibility: Collab.Visibility.PRIVATE,
            ownerId: userId, memberIds: [ userId, otherUserId ], createdAt: now, updatedAt: now,
        };
        const wrote : Type.Result<void> = await this.dynamo.put( "collab_rooms", { ...room } );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        await this.addMember( room.roomId, userId );
        await this.addMember( room.roomId, otherUserId );
        return { ok: true, data: room };
    }

    /** Fetch one room's metadata. */
    public getRoom( accountId : string, roomId : string ) : Promise<Type.Result<Collab.Room | undefined>>
    {
        return this.dynamo.get<Collab.Room>( "collab_rooms", { accountId, roomId } );
    }

    /** List the rooms a user belongs to (via the membership GSI), plus every non-archived PUBLIC channel on
     *  the account the user hasn't joined yet (public rooms admit any owning-account user without an invite). */
    public async listRoomsForUser( accountId : string, userId : string ) : Promise<Type.Result<Array<Collab.Room>>>
    {
        const memberships : Type.Result<Array<{ roomId : string }>> = await this.dynamo.query<{ roomId : string }>( "collab_members", {
            IndexName: "userId", KeyConditionExpression: "userId = :u", ExpressionAttributeValues: { ":u": userId },
        } );
        if( !memberships.ok ) return { ok: false, error: memberships.error };

        const rooms : Array<Collab.Room> = [];
        const seen : Set<string> = new Set<string>();
        for( const membership of memberships.data )
        {
            const found : Type.Result<Collab.Room | undefined> = await this.getRoom( accountId, membership.roomId );
            if( found.ok && found.data && !found.data.archived ) { rooms.push( found.data ); seen.add( found.data.roomId ); }
        }

        const accountRooms : Type.Result<Array<Collab.Room>> = await this.dynamo.query<Collab.Room>( "collab_rooms", {
            KeyConditionExpression: "accountId = :a", ExpressionAttributeValues: { ":a": accountId },
        } );
        if( accountRooms.ok )
            for( const room of accountRooms.data )
                if( !seen.has( room.roomId ) && !room.archived && room.visibility === Collab.Visibility.PUBLIC && room.type === Collab.RoomType.CHANNEL )
                    rooms.push( room );

        return { ok: true, data: rooms };
    }

    /** Rename / change visibility. */
    public async patchRoom( accountId : string, roomId : string, fields : { name? : string; visibility? : Collab.Visibility } ) : Promise<Type.Result<Collab.Room>>
    {
        const found : Type.Result<Collab.Room | undefined> = await this.getRoom( accountId, roomId );
        if( !found.ok ) return { ok: false, error: found.error };
        if( found.data === undefined ) return { ok: false, error: "room not found" };
        const room : Collab.Room = { ...found.data, ...fields, updatedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.dynamo.put( "collab_rooms", { ...room } );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        return { ok: true, data: room };
    }

    /** Archive (soft-delete) a room — the durable record + message history (within TTL) are retained. */
    public async archiveRoom( accountId : string, roomId : string ) : Promise<Type.Result<void>>
    {
        const found : Type.Result<Collab.Room | undefined> = await this.getRoom( accountId, roomId );
        if( !found.ok ) return { ok: false, error: found.error };
        if( found.data === undefined ) return { ok: false, error: "room not found" };
        return this.dynamo.put( "collab_rooms", { ...found.data, archived: true, updatedAt: new Date().toISOString() } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Membership ─────────────────────────────────────────────────────────────────────────────

    public async addMember( roomId : string, userId : string ) : Promise<Type.Result<void>>
    {
        return this.dynamo.put( "collab_members", { roomId, userId, joinedAt: new Date().toISOString() } );
    }

    public async removeMember( roomId : string, userId : string ) : Promise<Type.Result<void>>
    {
        return this.dynamo.remove( "collab_members", { roomId, userId } );
    }

    public isMember( roomId : string, userId : string ) : Promise<Type.Result<{ roomId : string; userId : string } | undefined>>
    {
        return this.dynamo.get( "collab_members", { roomId, userId } );
    }

    public listMemberIds( roomId : string ) : Promise<Type.Result<Array<{ userId : string }>>>
    {
        return this.dynamo.query<{ userId : string }>( "collab_members", {
            KeyConditionExpression: "roomId = :r", ExpressionAttributeValues: { ":r": roomId },
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Cross-node room event fan-out (Redis pub/sub — collab-4.3/5.3) ────────────────────────────
    // A CHAT message, presence change, or eviction may need to reach a room member connected to a DIFFERENT
    // `CollabRoomServer` instance than the one handling the write — every instance subscribes to a room's
    // channel while it holds ANY local connection for that room; publishing here reaches all of them.

    public roomChannel( roomId : string ) : string { return `collab:room:${ roomId }:events`; }

    public async publishRoomEvent( roomId : string, event : CollabService.RoomEvent ) : Promise<void>
    {
        await this.cache.client.publish( this.roomChannel( roomId ), JSON.stringify( event ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Messages (per-item TTL — CollabConfig.messageTtlDays governs EVERY message written; the "durable
    //    retention opt-in" case (collab-6.6) is a documented gap — one global TTL today, not per-account) ────

    public async postMessage( roomId : string, authorId : string, text : string ) : Promise<Type.Result<Collab.Message>>
    {
        const config : CollabConfig.Config = await this.collabConfig();
        const createdAt : string = new Date().toISOString();
        const message : Collab.Message = { roomId, messageId: randomUUID(), authorId, text, createdAt };

        // TTL is an epoch-SECONDS attribute (DynamoDB's own convention) — computed from the service's config
        // at write time, so a later config change only affects NEW messages, never retroactively.
        const expiresAt : number = Math.floor( Date.now() / 1000 ) + ( config.messageTtlDays * 24 * 60 * 60 );
        const wrote : Type.Result<void> = await this.dynamo.put( "collab_messages", {
            ...message, createdAtMessageId: `${ createdAt }#${ message.messageId }`, expiresAt,
        } );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        return { ok: true, data: message };
    }

    public async listMessages( roomId : string, limit : number = 50 ) : Promise<Type.Result<Array<Collab.Message>>>
    {
        const found : Type.Result<Array<Collab.Message>> = await this.dynamo.query<Collab.Message>( "collab_messages", {
            KeyConditionExpression: "roomId = :r", ExpressionAttributeValues: { ":r": roomId },
            ScanIndexForward: true, Limit: limit,
        } );
        return found;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Presence (Redis — live, ephemeral; never the system of record) ────────────────────────────
    // Online = the user holds at least one open collab-room connection ANYWHERE (a Redis counter, since a
    // user may have several room tabs/sockets open at once); ACTIVE/IDLE further refines that from the
    // client's own mouse/keyboard/click activity detector, reported over the room socket's `presence.status`
    // frame — TTL'd so a crashed connection's status self-expires rather than sticking forever.

    private onlineSetKey( accountId : string ) : string { return `collab:online:${ accountId }`; }
    private connectionCountKey( accountId : string, userId : string ) : string { return `collab:conn:${ accountId }:${ userId }`; }
    private statusKey( accountId : string, userId : string ) : string { return `collab:status:${ accountId }:${ userId }`; }

    /** Call on every room-socket OPEN for this user. */
    public async presenceConnected( accountId : string, userId : string ) : Promise<void>
    {
        const count : number = await this.cache.client.incr( this.connectionCountKey( accountId, userId ) );
        if( count === 1 ) await this.cache.client.sadd( this.onlineSetKey( accountId ), userId );
    }

    /** Call on every room-socket CLOSE for this user — only drops them from "online" once their LAST
     *  connection closes (they may have several room tabs open). */
    public async presenceDisconnected( accountId : string, userId : string ) : Promise<void>
    {
        const count : number = await this.cache.client.decr( this.connectionCountKey( accountId, userId ) );
        if( count <= 0 )
        {
            await this.cache.client.del( this.connectionCountKey( accountId, userId ) );
            await this.cache.client.srem( this.onlineSetKey( accountId ), userId );
            await this.cache.client.del( this.statusKey( accountId, userId ) );
        }
    }

    /** The client's own active/idle signal (from its mouse/keyboard/click detector) — TTL'd so a client that
     *  stops reporting (crashed tab) doesn't stick at "active" forever. */
    public async presenceSetStatus( accountId : string, userId : string, status : Collab.PresenceStatus.ACTIVE | Collab.PresenceStatus.IDLE ) : Promise<void>
    {
        await this.cache.client.set( this.statusKey( accountId, userId ), status, "EX", 300 );
    }

    /** How many DISTINCT users on this account currently hold an open collab connection (a pragmatic v1
     *  stand-in for "account-wide online" — SPECS.md assigns that concept to `realtime`, which has no real
     *  presence tracking yet; see apps/core/collab/SPECS.md). */
    public onlineCount( accountId : string ) : Promise<number>
    {
        return this.cache.client.scard( this.onlineSetKey( accountId ) );
    }

    /** One user's live presence entry — ONLINE (connected, no recent activity signal), ACTIVE/IDLE (a recent
     *  client signal), or OFFLINE (no open connection). */
    public async presenceOf( accountId : string, userId : string ) : Promise<Collab.PresenceEntry>
    {
        const isOnline : boolean = ( await this.cache.client.sismember( this.onlineSetKey( accountId ), userId ) ) === 1;
        const raw : string | null = isOnline ? await this.cache.client.get( this.statusKey( accountId, userId ) ) : null;
        const status : Collab.PresenceStatus = !isOnline ? Collab.PresenceStatus.OFFLINE
            : ( raw === Collab.PresenceStatus.ACTIVE || raw === Collab.PresenceStatus.IDLE ) ? raw : Collab.PresenceStatus.ONLINE;
        return { accountId, userId, status, updatedAt: new Date().toISOString() };
    }
}

export namespace CollabService
{
    export enum Role { CONTROL = "control", ROOM = "room" }
    export const PORT : Record<Role, number> = { [ Role.CONTROL ]: Ports.COLLAB.MAIN, [ Role.ROOM ]: Ports.COLLAB.ROOM };

    /** A cross-node room event, published on `roomChannel(roomId)` — every `CollabRoomServer` instance
     *  holding a local connection for this room is subscribed and re-broadcasts to its own sockets. */
    export type RoomEvent =
        | { kind : "chat.message"; message : Collab.Message }
        | { kind : "presence"; userId : string; status : Collab.PresenceStatus }
        | { kind : "evict"; userId : string };
}

export default CollabService;
// eof
