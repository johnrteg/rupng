//
import CollabService from "./CollabService";

import PostCollabRoomsImpl from "../endpoints/PostCollabRoomsImpl";
import GetCollabRoomsImpl from "../endpoints/GetCollabRoomsImpl";
import GetCollabRoomImpl from "../endpoints/GetCollabRoomImpl";
import PatchCollabRoomImpl from "../endpoints/PatchCollabRoomImpl";
import DeleteCollabRoomImpl from "../endpoints/DeleteCollabRoomImpl";
import PostCollabDmsImpl from "../endpoints/PostCollabDmsImpl";
import GetCollabRoomMembersImpl from "../endpoints/GetCollabRoomMembersImpl";
import PostCollabRoomMembersImpl from "../endpoints/PostCollabRoomMembersImpl";
import DeleteCollabRoomMemberImpl from "../endpoints/DeleteCollabRoomMemberImpl";
import GetCollabMessagesImpl from "../endpoints/GetCollabMessagesImpl";
import GetCollabConfigImpl from "../endpoints/GetCollabConfigImpl";
import PutCollabConfigImpl from "../endpoints/PutCollabConfigImpl";

//
// CONTROL role — the stateless `/collab/*` REST control plane (room CRUD, DMs, membership, message history,
// config). Scales freely, deploys apart from the stateful room-server fleet (CollabRoomServer). Same shape as
// apps/core/voice/src/services/VoiceMainService.ts, minus any SQS consumers (v1 collab has no work queues —
// writes are synchronous REST + the live room socket, not a fire-and-forget enqueue).
//
export class CollabControlService extends CollabService
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor() { super( CollabService.Role.CONTROL ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the collab endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new PostCollabRoomsImpl( this ) );
        this.register( new GetCollabRoomsImpl( this ) );
        this.register( new GetCollabRoomImpl( this ) );
        this.register( new PatchCollabRoomImpl( this ) );
        this.register( new DeleteCollabRoomImpl( this ) );
        this.register( new PostCollabDmsImpl( this ) );
        this.register( new GetCollabRoomMembersImpl( this ) );
        this.register( new PostCollabRoomMembersImpl( this ) );
        this.register( new DeleteCollabRoomMemberImpl( this ) );
        this.register( new GetCollabMessagesImpl( this ) );
        this.register( new GetCollabConfigImpl( this ) );
        this.register( new PutCollabConfigImpl( this ) );
    }
}

export default CollabControlService;
// eof
