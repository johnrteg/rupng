//
import { randomUUID } from "node:crypto";

import { PostPost, SocialPost } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/services";
import SocialService from "../services/SocialService";

//
// Create a post in DRAFT state (SCHEDULED when `scheduleAt` is supplied — actually firing at that
// time is `SocialScheduleJob`, a Milestone 3 addition; for now a scheduled post just sits until a
// manual publish). `approvalsRequired` defaults to 0 until `SocialConfig` lands.
//
export class PostPostImpl extends PostPost
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const body : string | undefined = this.body?.body;
        const targets : Array<SocialPost.PostTarget> | undefined = this.body?.targets;
        if( !body )                    return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "body required" } };
        if( !targets?.length )         return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "at least one target required" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const id  : Type.UUID = randomUUID();
        const entity : SocialPost.Entity =
        {
            id,
            accountId,
            body,
            mediaKeys:         this.body?.mediaKeys,
            targets,
            scheduleAt:        this.body?.scheduleAt,
            status:            this.body?.scheduleAt ? SocialPost.Status.SCHEDULED : SocialPost.Status.DRAFT,
            approvalsRequired: 0,
            createdBy:         auth.userId,
            createdAt:         now,
            modifiedAt:        now,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "posts", { ...entity } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "post write failed" } };

        await this.service.emitPostEvent( Events.Verb.CREATED, entity );

        return { status: NetworkUtils.Status.OK, data: entity };
    }
}

export default PostPostImpl;
