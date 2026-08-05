//
import { randomUUID } from "node:crypto";

import { PostStudioProjectCopy, StudioProject } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Copy a Studio project — clone its metadata into a NEW project (fresh id/audit, no `libraryAssetId`) and
// carry over its canvas snapshot so the copy opens identically to the source.
export class PostStudioProjectCopyImpl extends PostStudioProjectCopy
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const sourceId : string = this.query?.id ?? "";
        if( !sourceId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        // source must exist and not already be soft-deleted
        const source : StudioProject.Entity | undefined = await this.service.getStudioProject( auth.accountId, sourceId );
        if( !source || source.deleted ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "project not found" } };

        // clone the metadata into a new project (fresh identity + audit; no inherited library asset)
        const now : string = new Date().toISOString();
        const copy : StudioProject.Entity =
        {
            accountId:  auth.accountId,
            id:         randomUUID(),
            name:       this.body?.name ?? `${ source.name } (copy)`,
            kind:       source.kind,
            campaignId: source.campaignId,
            tags:       [ ...source.tags ],
            page:       { ...source.page },
            createdAt:  now,
            modifiedAt: now,
            createdBy:  auth.userId,
            modifiedBy: auth.userId,
        };
        const wrote : Type.Result<void> = await this.service.putStudioProject( copy );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not copy the project" } };

        // carry over the canvas snapshot (best-effort — a missing/unreadable canvas leaves the copy blank)
        const canvas : string | null = await this.service.getStudioCanvas( auth.accountId, sourceId );
        if( canvas !== null ) await this.service.putStudioCanvas( auth.accountId, copy.id, canvas );

        return { status: NetworkUtils.Status.OK, data: { project: copy } };
    }
}

export default PostStudioProjectCopyImpl;
