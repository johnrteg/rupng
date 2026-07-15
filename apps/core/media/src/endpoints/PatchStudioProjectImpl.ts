//
import { PatchStudioProject, StudioProject } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Update a Studio project's mutable fields (name / tags / campaign / page / library asset). Re-stamps the
// modified metadata. Only the supplied fields change.
export class PatchStudioProjectImpl extends PatchStudioProject
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const id : string = this.query?.id ?? "";
        if( !id ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const existing : StudioProject.Entity | undefined = await this.service.getStudioProject( auth.accountId, id );
        if( existing === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "project not found" } };

        const body : PatchStudioProject.Body = this.body ?? {};
        // apply only the supplied fields, then re-stamp modified
        const project : StudioProject.Entity =
        {
            ...existing,
            name:           body.name !== undefined ? body.name.trim() : existing.name,
            tags:           body.tags ?? existing.tags,
            campaignId:     body.campaignId !== undefined ? body.campaignId : existing.campaignId,
            libraryAssetId: body.libraryAssetId !== undefined ? body.libraryAssetId : existing.libraryAssetId,
            page:           body.page ?? existing.page,
            modifiedAt:     new Date().toISOString(),
            modifiedBy:     auth.userId,
        };

        const wrote : Type.Result<void> = await this.service.putStudioProject( project );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not update the project" } };

        return { status: NetworkUtils.Status.OK, data: { project } };
    }
}

export default PatchStudioProjectImpl;
