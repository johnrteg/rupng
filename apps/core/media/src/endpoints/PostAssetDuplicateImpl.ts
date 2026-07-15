//
import { randomUUID } from "node:crypto";

import { PostAssetDuplicate, Media } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import { MediaPipeline } from '../pipeline/MediaPipeline';

//
// Duplicate an envelope: mint a new guid, copy the ORIGINAL bytes (+ derived items when asked) to the new S3
// keys, and write a fresh index row — name "Copy of <original>", createdAt = now, createdBy = the copier, no
// campaign links. Then re-kick the pipeline (scan → process) so the copy re-derives its own items + stats,
// unless the caller asked to copy the derived items verbatim.
//
export class PostAssetDuplicateImpl extends PostAssetDuplicate
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid : string = this.query?.guid ?? "";
        if( !guid )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        const source : Media.Asset = got.data;
        if( source.status === Media.Status.UPLOADING || source.status === Media.Status.DELETED )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "asset has no content to duplicate" } };
        const sourceOriginal : Media.Item | undefined = Media.originalItem( source );
        if( !sourceOriginal ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "asset has no original to duplicate" } };

        // copy the derived items too (skip re-deriving) when asked AND the source actually has some
        const includeDerived : boolean = ( this.body?.includeDerived === true ) && source.items.some( ( item ) => item.usage !== Media.Usage.ORIGINAL );

        const now     : string = new Date().toISOString();
        const newGuid : string = randomUUID();
        // the items the copy carries: always the ORIGINAL; the derived items only when asked. Each item gets a
        // fresh id + version reset; versionId is dropped (the copy's S3 objects have their own version history).
        const copiedItems : Array<Media.Item> = source.items
            .filter( ( item ) => includeDerived || item.usage === Media.Usage.ORIGINAL )
            .map( ( item ) => ( { ...item, id: randomUUID(), version: 1, versionId: undefined } ) );
        const copy : Media.Asset = {
            ...source,
            guid:        newGuid,
            name:        this.body?.name?.trim() || `Copy of ${ source.name }`,
            createdBy:   auth.userId,               // the person who copied it
            createdAt:   now,                       // when it was copied
            modifiedAt:  now,
            // copying derived items → the copy is already processed (byte-identical, already-scanned source);
            // else re-run the pipeline to re-derive items + probe metadata
            status:      includeDerived ? source.status : Media.Status.SCANNING,
            items:       copiedItems,
            campaignIds: [],                        // a copy starts unassociated
            lastAccessedAt: undefined,
            deletedAt:   undefined,
            ttl:         undefined,
        };

        // copy the item bytes to the new keys (map source item → copy item by their aligned index)
        const sourceItemsToCopy : Array<Media.Item> = source.items.filter( ( item ) => includeDerived || item.usage === Media.Usage.ORIGINAL );
        for( let index : number = 0; index < sourceItemsToCopy.length; index++ )
        {
            const sourceItem : Media.Item = sourceItemsToCopy[ index ]!;
            const copyItem   : Media.Item = copiedItems[ index ]!;
            const isOriginal : boolean = sourceItem.usage === Media.Usage.ORIGINAL;
            const srcObject : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.service.s3.get( "media", MediaPipeline.itemKey( source, sourceItem ) );
            if( !srcObject.ok || !srcObject.data.Body )
            {
                if( isOriginal ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "source bytes unavailable" } };
                continue;   // a missing derived object is skipped, not fatal
            }
            const bytes : Uint8Array = await ( srcObject.data.Body as { transformToByteArray() : Promise<Uint8Array> } ).transformToByteArray();
            const putObject : Type.Result<void> = await this.service.s3.put( "media", MediaPipeline.itemKey( copy, copyItem ), Buffer.from( bytes ), sourceItem.mime );
            if( !putObject.ok && isOriginal ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not copy the media bytes" } };
        }

        const put : Type.Result<void> = await this.service.dynamo.put( "media", { ...copy } );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not create the copy" } };

        // re-derive only when we didn't copy the derived items (a large item set could move this copy to a Job later)
        if( !includeDerived ) await this.service.sqs.send( "media-scan", { accountId, guid: newGuid } );   // → scan → process
        void this.service.assetCreated( copy, auth.userId );                                                // media.asset created (best-effort)

        return { status: NetworkUtils.Status.CREATED, data: { asset: copy } };
    }
}

export default PostAssetDuplicateImpl;
