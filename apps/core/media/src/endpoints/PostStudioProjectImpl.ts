//
import { randomUUID } from "node:crypto";

import { PostStudioProject, StudioProject } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Create a Studio project — the service mints the id, stamps timestamps + actor, and defaults the page.
export class PostStudioProjectImpl extends PostStudioProject
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostStudioProjectImpl", { userId: auth.userId, accountId: auth.accountId } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const body : PostStudioProject.Body | null = this.body;
        if( !body || !body.name || !body.kind ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name and kind required" } };

        const now : string = new Date().toISOString();
        const project : StudioProject.Entity =
        {
            accountId:  auth.accountId,
            id:         randomUUID(),
            name:       body.name.trim(),
            kind:       body.kind,
            campaignId: body.campaignId,
            tags:       body.tags ?? [],
            page:       body.page ?? { ...StudioProject.DEFAULT_PAGE },
            createdAt:  now,
            modifiedAt: now,
            createdBy:  auth.userId,
            modifiedBy: auth.userId,
        };

        const wrote : Type.Result<void> = await this.service.putStudioProject( project );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not create the project" } };

        return { status: NetworkUtils.Status.OK, data: { project } };
    }
}

export default PostStudioProjectImpl;
