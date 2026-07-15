//
import { randomUUID } from "node:crypto";

import { PostUpload, Media, MediaConfig } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint, Access } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import { MediaPipeline } from '../pipeline/MediaPipeline';

//
// Begin an upload: create the media index row (status UPLOADING) and hand back a pre-signed S3 PUT URL. The
// client PUTs the bytes DIRECT to S3 (never through the service), then calls PostUploadComplete to kick off
// the scan → process pipeline. Media is account-partitioned; a USER-avatar upload (scope USER) is indexed
// here too but its bytes use the user-scoped AVATAR key.
//
export class PostUploadImpl extends PostUpload
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const body : PostUpload.Body | null = this.body;
        if( !body || !body.filename || !body.mime || !body.size || !body.scope )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "filename, mime, size, scope required" } };

        // live upload policy (limits / default tier / presign + retention windows) — tunable via AppConfig.
        const config : MediaConfig.Config = await this.service.mediaConfig();
        const kind   : Media.Kind = body.kind ?? this.kindOf( body.mime );

        // enforce the mime allow-list (empty = allow any) and the size cap (per-kind override wins).
        if( config.upload.allowedMime.length > 0 && !config.upload.allowedMime.some( ( pattern ) => MediaPipeline.mimeMatches( pattern, body.mime ) ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `mime not allowed: ${ body.mime }` } };
        const maxBytes : number = ( config.upload.maxSizeMbByKind[ kind ] ?? config.upload.maxSizeMb ) * 1024 * 1024;
        if( body.size > maxBytes )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `file exceeds the ${ Math.round( maxBytes / ( 1024 * 1024 ) ) }MB limit for ${ kind }` } };

        const now  : string = new Date().toISOString();
        const guid : string = randomUUID();
        // the envelope's sole ORIGINAL item (status UPLOADING — awaiting the direct-to-S3 PUT). Derived items
        // are added by the pipeline after scan → process.
        const original : Media.Item =
        {
            id:         randomUUID(),
            usage:      Media.Usage.ORIGINAL,
            kind,
            mime:       body.mime,
            extension:  this.extensionOf( body.filename, body.mime ),
            size:       body.size,
            version:    1,
            status:     Media.Status.UPLOADING,
            createdAt:  now,
            modifiedAt: now,
        };
        const asset : Media.Asset =
        {
            accountId, guid,
            name:       body.filename,
            kind,
            tier:       body.tier ?? config.delivery.defaultTier,
            accessRole: Access.AccountRole.USER,
            status:     Media.Status.UPLOADING,
            scope:      body.scope,
            scopeId:    body.scopeId,
            tags:       [],
            campaignIds: [],
            items:      [ original ],
            source:     { origin: Media.SourceOrigin.UPLOAD, acquiredBy: auth.userId, acquiredAt: now },   // uploaded from a computer (media-15.2)
            createdBy:  auth.userId,
            createdAt:  now,
            modifiedAt: now,
            // auto-expiry only when configured (0 = keep forever); epoch seconds for the DDB TTL attribute.
            ...( config.lifecycle.defaultTtlDays > 0
                ? { ttl: Math.floor( Date.now() / 1000 ) + config.lifecycle.defaultTtlDays * 86400 }
                : {} ),
        };

        const put : Type.Result<void> = await this.service.dynamo.put( "media", { ...asset } );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not create the media record" } };

        const ttlSec : number = config.upload.presignTtlSec;
        const signed : Type.Result<string> = await this.service.s3.presignPut( "media", MediaPipeline.itemKey( asset, original ), ttlSec );
        if( !signed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not presign the upload" } };

        const reply : PostUpload.Response = {
            asset,
            upload: { url: signed.data, method: "PUT", expiresAt: new Date( Date.now() + ttlSec * 1000 ).toISOString() },
        };
        return { status: NetworkUtils.Status.OK, data: reply };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // the file extension (no dot) — from the filename, else guessed from the mime subtype
    private extensionOf( filename : string, mime : string ) : string
    {
        const dot : number = filename.lastIndexOf( "." );
        if( dot >= 0 && dot < filename.length - 1 ) return filename.slice( dot + 1 ).toLowerCase();
        const sub : string = mime.split( "/" )[ 1 ] ?? "bin";
        return sub.toLowerCase();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // the media Kind from a mime type
    private kindOf( mime : string ) : Media.Kind
    {
        if( mime.startsWith( "image/" ) ) return Media.Kind.IMAGE;
        if( mime.startsWith( "video/" ) ) return Media.Kind.VIDEO;
        if( mime.startsWith( "audio/" ) ) return Media.Kind.AUDIO;
        if( mime === "application/pdf" )  return Media.Kind.DOCUMENT;   // PDFs only
        return Media.Kind.OTHER;
    }
}

export default PostUploadImpl;
