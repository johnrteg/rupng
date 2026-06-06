//
// S3 facade — common object ops + presigned URLs, keyed by cloud-spec LOGICAL bucket keys
// (CloudResolver turns them into physical names). Drop to `.client` for anything not wrapped.
//
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { GetObjectCommandOutput, PutObjectCommandInput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ClientUtils } from "./ClientUtils";

/**
 * S3 facade — the routine object operations over `@aws-sdk/client-s3`, addressed by cloud-spec
 * LOGICAL bucket keys (e.g. `"uploads"`) rather than physical names.
 *
 * Use it for get/put/delete and presigned URLs. For anything beyond that — multipart uploads,
 * S3 Select, tagging, lifecycle, batch — reach through `.client` to the raw SDK; this is a
 * convenience layer, not a full S3 wrapper.
 */
export class S3
{
    private _client? : S3Client;

    ////////////////////////////////////////////////////////////////////////////////////////
    /** @param cloud the owning service's resolver — maps logical bucket keys to physical names. */
    constructor( private readonly cloud : CloudResolver ) {}

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * The raw `S3Client` — escape hatch for operations this facade doesn't wrap (multipart,
     * S3 Select, tagging, …). Created lazily on first access and cached.
     */
    get client() : S3Client { return this._client ??= ClientUtils.createClient( S3Client ); }

    /** Resolve a cloud-spec logical bucket key (e.g. `"uploads"`) to its physical bucket name. */
    bucket( key : ResourceKey ) : string { return this.cloud.bucketName( key ); }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Fetch an object. The returned `Body` is a stream — read it with
     * `.Body.transformToString()` / `.transformToByteArray()`, or pipe it. Use for server-side
     * reads; to hand a download straight to an end user, prefer {@link presignGet} (no bytes
     * through your service).
     * @param bucketKey logical bucket key.
     * @param objectKey object key/path within the bucket.
     */
    get( bucketKey : ResourceKey, objectKey : string ) : Promise<GetObjectCommandOutput>
    {
        return this.client.send( new GetObjectCommand( { Bucket: this.bucket( bucketKey ), Key: objectKey } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Store an object. `body` may be a string, `Buffer`/`Uint8Array`, or a stream. Set
     * `contentType` so browsers render/download correctly. For large or browser-originated
     * uploads that shouldn't transit your service, hand out a {@link presignPut} URL instead.
     */
    async put( bucketKey : ResourceKey, objectKey : string, body : PutObjectCommandInput[ "Body" ], contentType? : string ) : Promise<void>
    {
        await this.client.send( new PutObjectCommand( { Bucket: this.bucket( bucketKey ), Key: objectKey, Body: body, ContentType: contentType } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /** Delete an object. Idempotent — succeeds even if the key doesn't exist. */
    async remove( bucketKey : ResourceKey, objectKey : string ) : Promise<void>
    {
        await this.client.send( new DeleteObjectCommand( { Bucket: this.bucket( bucketKey ), Key: objectKey } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * A time-limited **upload** URL the client `PUT`s to directly — keeps large/binary uploads
     * off your service and avoids a public bucket. Pairs with cloud-spec `presignedUpload`
     * buckets. Use over {@link put} whenever the uploader is a browser/mobile client.
     * @param ttlSec link lifetime in seconds (default 900 = 15 min); keep it short.
     */
    presignPut( bucketKey : ResourceKey, objectKey : string, ttlSec : number = 900 ) : Promise<string>
    {
        return getSignedUrl( this.client, new PutObjectCommand( { Bucket: this.bucket( bucketKey ), Key: objectKey } ), { expiresIn: ttlSec } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * A time-limited **download** URL for a private object — share this instead of proxying the
     * bytes through your service or making the bucket public. Use over {@link get} when the
     * consumer is an end user / external client.
     * @param ttlSec link lifetime in seconds (default 900).
     */
    presignGet( bucketKey : ResourceKey, objectKey : string, ttlSec : number = 900 ) : Promise<string>
    {
        return getSignedUrl( this.client, new GetObjectCommand( { Bucket: this.bucket( bucketKey ), Key: objectKey } ), { expiresIn: ttlSec } );
    }
}
