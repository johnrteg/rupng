//
// Collab — wire model for the collab service (rooms + DMs + chat + presence). See apps/core/collab/SPECS.md.
// v1 SCOPE: chat only — no Y.js/CRDT document room type, no whiteboard (a documented, deferred gap; the
// substrate is designed to accept those room types later without a model change here).
//
export namespace Collab
{
    /** v1 room types — `CHANNEL` (named, multi-member) and `DM` (exactly 2 members, unnamed, find-or-created).
     *  `doc`/`whiteboard` room types are a deferred gap (SPECS.md gap — Y.js/Hocuspocus not built yet). */
    export enum RoomType { CHANNEL = "channel", DM = "dm" }

    /** `PUBLIC` — any user of the room's OWNING account may join, no invite (account-scoped, not
     *  internet-public). `PRIVATE` — invite-only, explicit membership (incl. outside guests). A `DM` room is
     *  always `PRIVATE`. */
    export enum Visibility { PUBLIC = "public", PRIVATE = "private" }

    /** A member's live status. `ONLINE` = connected to at least one collab room, `ACTIVE`/`IDLE` further
     *  refine that (client-detected mouse/keyboard/click activity vs. an idle timeout), `OFFLINE` = no open
     *  connection (the default once a presence entry's Redis TTL lapses). */
    export enum PresenceStatus { ONLINE = "online", ACTIVE = "active", IDLE = "idle", OFFLINE = "offline" }

    /** A room record — the durable metadata (DynamoDB system of record); the live session rides the WS. */
    export interface Room
    {
        accountId:   string;          // the OWNING account (isolation/key domain) — never two owning accounts
        roomId:      string;
        type:        RoomType;
        visibility:  Visibility;
        name?:       string;          // unset for a DM room
        ownerId:     string;          // the creator by default; room-admin rights (rename/visibility/archive)
        memberIds:   Array<string>;   // exactly 2 for a DM room
        archived?:   boolean;
        createdAt:   string;
        updatedAt:   string;
    }

    /** One chat message — durable in DynamoDB with a per-item TTL (see CollabConfig.messageTtlDays); no
     *  structured `@`-mention entity-ref system in v1 (a documented, deferred GDPR-redaction gap). */
    export interface Message
    {
        roomId:    string;
        messageId: string;
        authorId:  string;
        text:      string;
        createdAt: string;
    }

    /** A member's live presence entry (Redis, TTL'd — self-expires to effectively OFFLINE if a connection
     *  never cleanly closes). `roomId` is the room the status was last reported from, if any. */
    export interface PresenceEntry
    {
        accountId: string;
        userId:    string;
        status:    PresenceStatus;
        roomId?:   string;
        updatedAt: string;
    }
}

export default Collab;
// eof
