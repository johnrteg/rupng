//
// S3 facade — common object ops + presigned URLs, keyed by cloud-manifest LOGICAL bucket keys
// (CloudResolver turns them into physical names). Drop to `.client` for anything not wrapped.
//
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectVersionsCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import type { GetObjectCommandOutput, PutObjectCommandInput, ListObjectVersionsCommandOutput, CopyObjectCommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CloudResolver, ResourceKey } from "@repo/cloud-manifest";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
import { ClientUtils } from "./ClientUtils";

/**
 * S3 facade — the routine object operations over `@aws-sdk/client-s3`, addressed by cloud-manifest
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
     *
     * `*ChecksumCalculation/Validation: WHEN_REQUIRED` opts OUT of the SDK's default
     * (`WHEN_SUPPORTED`) automatic CRC32 checksums. The default breaks **presigned PUT** URLs: it
     * folds an `x-amz-checksum-*` header into the signature (so a browser PUT that doesn't send that
     * exact header fails `SignatureDoesNotMatch`), and while presigning a body-less PutObject the
     * checksum middleware hashes an empty body and throws "The 'string' argument must be of type
     * string or an instance of Buffer or ArrayBuffer." WHEN_REQUIRED keeps checksums off unless a
     * command explicitly needs one — the correct posture for our presigned-upload flow.
     */
    get client() : S3Client { return this._client ??= ClientUtils.createClient( S3Client, { requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" } ); }

    /** Resolve a cloud-manifest logical bucket key (e.g. `"uploads"`) to its physical bucket name. */
    bucket( key : ResourceKey ) : string { return this.cloud.bucketName( key ); }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Build an object key from a **typed, per-usage descriptor** ({@link S3.ObjectKey}) — a
     * discriminated union keyed on the central {@link S3.Domain} enum. Each asset family has its **own
     * fixed shape and path**, so there are **no free-form segments to typo or reorder** (a whole class
     * of "lost file" bugs): the scope (`acct/` vs `user/`), the domain token, and the path order are
     * baked into the builder per case, and variants are **enums**.
     *
     * Adding a new asset family is a deliberate edit in **one place** — add a {@link S3.Domain} member, a
     * descriptor interface, and a `case` here; the `switch` is **exhaustive**, so omitting the case is a
     * **compile error**. Two services therefore can't silently reuse a domain for different shapes.
     *
     * **Non-throwing:** a malformed *dynamic* segment (an id/ext containing `/`, whitespace, empty, …)
     * returns `ok: false`; otherwise `ok: true` with the key in `data`. The I/O methods propagate it.
     *
     * `variant` is the filename stem (a required string) — use `"default"` for an asset with only one
     * form, never an optional/omitted value.
     *
     * @example
     *   key({ domain: S3.Domain.MEDIA, accountId, mediaId, variant: "1080p", ext: "mp4" })
     *     → "acct/<accountId>/media/<mediaId>/1080p.mp4"
     *   key({ domain: S3.Domain.AVATAR, userId, variant: "256", ext: "webp" })
     *     → "user/<userId>/avatar/256.webp"
     *   key({ domain: S3.Domain.BRANDING, accountId, variant: "logo", ext: "png" })
     *     → "acct/<accountId>/branding/logo.png"
     */
    key( spec : S3.ObjectKey ) : Type.Result<string>
    {
        switch( spec.domain )
        {
            case S3.Domain.MEDIA:
                return S3.build( [ "acct", spec.accountId, "media", spec.mediaId ], spec.variant, spec.ext );
            case S3.Domain.AVATAR:
                return S3.build( [ "user", spec.userId, "avatar" ], spec.variant, spec.ext );
            case S3.Domain.BRANDING:
                return S3.build( [ "acct", spec.accountId, "branding" ], spec.variant, spec.ext );
            case S3.Domain.REPORT:
                return S3.build( [ "acct", spec.accountId, "reports", spec.reportId ], spec.submissionId, spec.ext );
            case S3.Domain.MARKETPLACE:
                return S3.build( [ "global", "marketplace", spec.integrationId ], spec.variant, spec.ext );
            default:
                return S3.unhandled( spec );   // exhaustiveness: `spec` is `never` here once every case is handled
        }
    }

    /** Allowed characters in an object-key segment — no `/` (phantom path), whitespace, or oddities. */
    private static readonly SEGMENT : RegExp = /^[A-Za-z0-9._-]+$/;

    /** Validate one segment — `ok: true` with the value when valid, else `ok: false` (no throw). */
    private static segment( value : string ) : Type.Result<string>
    {
        return S3.SEGMENT.test( value )
            ? ResultUtils.ok( value )
            : ResultUtils.err( `S3.key: invalid segment ${JSON.stringify( value )} — must be non-empty and contain only [A-Za-z0-9._-] (no "/", whitespace, or PII).` );
    }

    /** Join `<…dir>/<stem>.<ext>` after validating every (dynamic) segment. Enum tokens pass trivially. */
    private static build( dirs : Array<string>, stem : string, ext : string ) : Type.Result<string>
    {
        for( const value of [ ...dirs, stem, ext ] )
        {
            const checked : Type.Result<string> = S3.segment( value );
            if( ! checked.ok ) return checked;
        }
        return ResultUtils.ok( `${dirs.join( "/" )}/${stem}.${ext}` );
    }

    /** Compile-time exhaustiveness guard — reached only if a {@link S3.Domain} lacks a `case` in {@link key}. */
    private static unhandled( spec : never ) : Type.Result<string>
    {
        return ResultUtils.err( `S3.key: unhandled domain ${JSON.stringify( ( spec as { domain : string } ).domain )}` );
    }

    /** Normalize an {@link S3.Key} (raw string or {@link S3.ObjectKey}) to the physical object key (no throw). */
    private resolveKey( key : S3.Key ) : Type.Result<string> { return typeof key === "string" ? ResultUtils.ok( key ) : this.key( key ); }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Fetch an object. The returned `Body` is a stream — read it with
     * `.Body.transformToString()` / `.transformToByteArray()`, or pipe it. Use for server-side
     * reads; to hand a download straight to an end user, prefer {@link presignGet} (no bytes
     * through your service).
     * @param bucketKey logical bucket key.
     * @param objectKey object key — a built string or structured {@link S3.ObjectKey}.
     */
    get( bucketKey : ResourceKey, objectKey : S3.Key ) : Promise<Type.Result<GetObjectCommandOutput>>
    {
        const objectName : Type.Result<string> = this.resolveKey( objectKey );
        if( ! objectName.ok ) return Promise.resolve( objectName );
        return ResultUtils.from( () => this.client.send( new GetObjectCommand( { Bucket: this.bucket( bucketKey ), Key: objectName.data } ) ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Store an object. `body` may be a string, `Buffer`/`Uint8Array`, or a stream. Set
     * `contentType` so browsers render/download correctly. For large or browser-originated
     * uploads that shouldn't transit your service, hand out a {@link presignPut} URL instead.
     */
    put( bucketKey : ResourceKey, objectKey : S3.Key, body : PutObjectCommandInput[ "Body" ], contentType? : string ) : Promise<Type.Result<void>>
    {
        const objectName : Type.Result<string> = this.resolveKey( objectKey );
        if( ! objectName.ok ) return Promise.resolve( objectName );
        return ResultUtils.from( async () : Promise<void> =>
        {
            await this.client.send( new PutObjectCommand( { Bucket: this.bucket( bucketKey ), Key: objectName.data, Body: body, ContentType: contentType } ) );
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /** Does an object exist? `ok:true, data:true|false` — a `NotFound`/`NoSuchKey` maps to `false`
     *  (not an error); any other failure is `ok:false`. HeadObject, so no bytes transfer. */
    exists( bucketKey : ResourceKey, objectKey : S3.Key ) : Promise<Type.Result<boolean>>
    {
        const objectName : Type.Result<string> = this.resolveKey( objectKey );
        if( ! objectName.ok ) return Promise.resolve( objectName );
        return ResultUtils.from( async () : Promise<boolean> =>
        {
            try
            {
                await this.client.send( new HeadObjectCommand( { Bucket: this.bucket( bucketKey ), Key: objectName.data } ) );
                return true;
            }
            catch( err )
            {
                const name : string = ( err as { name? : string } )?.name ?? "";
                const status : number = ( err as { $metadata? : { httpStatusCode? : number } } )?.$metadata?.httpStatusCode ?? 0;
                if( name === "NotFound" || name === "NoSuchKey" || status === 404 ) return false;   // missing → false
                throw err;                                                                          // real error → ok:false
            }
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /** Delete an object. Idempotent — succeeds even if the key doesn't exist. */
    remove( bucketKey : ResourceKey, objectKey : S3.Key ) : Promise<Type.Result<void>>
    {
        const objectName : Type.Result<string> = this.resolveKey( objectKey );
        if( ! objectName.ok ) return Promise.resolve( objectName );
        return ResultUtils.from( async () : Promise<void> =>
        {
            await this.client.send( new DeleteObjectCommand( { Bucket: this.bucket( bucketKey ), Key: objectName.data } ) );
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * A time-limited **upload** URL the client `PUT`s to directly — keeps large/binary uploads
     * off your service and avoids a public bucket. Pairs with cloud-manifest `presignedUpload`
     * buckets. Use over {@link put} whenever the uploader is a browser/mobile client.
     * @param ttlSec link lifetime in seconds (default 900 = 15 min); keep it short.
     */
    presignPut( bucketKey : ResourceKey, objectKey : S3.Key, ttlSec : number = 900 ) : Promise<Type.Result<string>>
    {
        const objectName : Type.Result<string> = this.resolveKey( objectKey );
        if( ! objectName.ok ) return Promise.resolve( objectName );
        return ResultUtils.from( () => getSignedUrl( this.client, new PutObjectCommand( { Bucket: this.bucket( bucketKey ), Key: objectName.data } ), { expiresIn: ttlSec } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * A time-limited **download** URL for a private object — share this instead of proxying the
     * bytes through your service or making the bucket public. Use over {@link get} when the
     * consumer is an end user / external client.
     * @param ttlSec link lifetime in seconds (default 900).
     */
    presignGet( bucketKey : ResourceKey, objectKey : S3.Key, ttlSec : number = 900 ) : Promise<Type.Result<string>>
    {
        const objectName : Type.Result<string> = this.resolveKey( objectKey );
        if( ! objectName.ok ) return Promise.resolve( objectName );
        return ResultUtils.from( () => getSignedUrl( this.client, new GetObjectCommand( { Bucket: this.bucket( bucketKey ), Key: objectName.data } ), { expiresIn: ttlSec } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * List the S3 object versions for a single key, newest first — the history a caller can revert to
     * ({@link restoreVersion}). Requires a versioning-enabled bucket; on an un-versioned bucket the sole
     * "null" version is returned. Filtered to the exact key (ListObjectVersions is prefix-based). Delete
     * markers are excluded — a revert restores content, not a deletion.
     */
    listVersions( bucketKey : ResourceKey, objectKey : S3.Key ) : Promise<Type.Result<Array<S3.Version>>>
    {
        const objectName : Type.Result<string> = this.resolveKey( objectKey );
        if( ! objectName.ok ) return Promise.resolve( objectName );
        return ResultUtils.from( async () : Promise<Array<S3.Version>> =>
        {
            const output : ListObjectVersionsCommandOutput = await this.client.send(
                new ListObjectVersionsCommand( { Bucket: this.bucket( bucketKey ), Prefix: objectName.data } ) );
            const versions : NonNullable<ListObjectVersionsCommandOutput[ "Versions" ]> = output.Versions ?? [];
            return versions
                .filter( ( version ) => version.Key === objectName.data && !!version.VersionId )
                .map( ( version ) : S3.Version => ( {
                    versionId:    version.VersionId as string,
                    size:         version.Size ?? 0,
                    lastModified: ( version.LastModified ?? new Date( 0 ) ).toISOString(),
                    isLatest:     version.IsLatest === true,
                } ) );
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Restore a prior version of an object by copying that version back onto the current key — which
     * writes a NEW latest version with the old bytes (nothing is destroyed; the just-replaced content
     * stays in history). No-op-safe if `versionId` is already the latest. Returns the new latest
     * version id when S3 reports one.
     */
    restoreVersion( bucketKey : ResourceKey, objectKey : S3.Key, versionId : string ) : Promise<Type.Result<string | undefined>>
    {
        const objectName : Type.Result<string> = this.resolveKey( objectKey );
        if( ! objectName.ok ) return Promise.resolve( objectName );
        return ResultUtils.from( async () : Promise<string | undefined> =>
        {
            const bucket : string = this.bucket( bucketKey );
            const output : CopyObjectCommandOutput = await this.client.send( new CopyObjectCommand( {
                Bucket: bucket, Key: objectName.data,
                CopySource: `${ bucket }/${ encodeURIComponent( objectName.data ) }?versionId=${ encodeURIComponent( versionId ) }`,
            } ) );
            return output.VersionId;
        } );
    }
}

export namespace S3
{
    /**
     * The **asset family** — the central registry of object-key shapes. Adding a family is a deliberate
     * edit *here*: add a member, a descriptor interface, and a `case` in {@link S3.key} (the `switch` is
     * exhaustive, so a missing case is a compile error). Because each domain maps to exactly one typed
     * shape, two services **can't** silently reuse a domain for different layouts.
     */
    export enum Domain
    {
        MEDIA       = "media",      // account media library — transcoded assets + renditions
        AVATAR      = "avatar",     // user profile image — USER-scoped (follows the person across accounts)
        BRANDING    = "branding",   // account branding — logo / icon / …
        REPORT      = "reports",    // generated report artifacts
        MARKETPLACE = "marketplace",// platform-GLOBAL marketplace catalog assets (e.g. integration icons)
    }

    // Each descriptor's path order + scope (acct/ vs user/ vs platform-global) is fixed by {@link S3.key};
    // there are no free-form segments to typo or reorder. `variant` is the filename stem — a required
    // string; use "default" for an asset with a single form (never optional/omitted). `ext` has no leading dot.

    /** `acct/<accountId>/media/<mediaId>/<variant>.<ext>` — variant e.g. `"original"` | `"1080p"` | `"thumb"`. */
    export interface MediaKey    { domain : Domain.MEDIA;    accountId : string; mediaId : string; variant : string; ext : string; }

    /** `user/<userId>/avatar/<variant>.<ext>` — user-scoped; variant e.g. `"original"` | `"256"` | `"64"`. */
    export interface AvatarKey   { domain : Domain.AVATAR;   userId : string; variant : string; ext : string; }

    /** `acct/<accountId>/branding/<variant>.<ext>` — variant e.g. `"logo"` | `"icon"`. */
    export interface BrandingKey { domain : Domain.BRANDING; accountId : string; variant : string; ext : string; }

    /** `acct/<accountId>/reports/<reportId>/<submissionId>.<ext>` — submissions grouped under the report
     *  definition (`reportId`, stable across a schedule's runs); each execution is its own `submissionId`.
     *  The reports DB holds the metadata (type, schedule, requester, record count, timestamps) — not the key. */
    export interface ReportKey   { domain : Domain.REPORT;   accountId : string; reportId : string; submissionId : string; ext : string; }

    /** `global/marketplace/<integrationId>/<variant>.<ext>` — **platform-global** (the `global/` root, no
     *  account/user scope); catalog assets like an integration's icon, e.g. variant `"icon"`. */
    export interface MarketplaceKey { domain : Domain.MARKETPLACE; integrationId : string; variant : string; ext : string; }

    /** A fully-typed object-key descriptor — one shape per {@link Domain} (discriminated on `domain`). */
    export type ObjectKey = MediaKey | AvatarKey | BrandingKey | ReportKey | MarketplaceKey;

    /** A key arg to the object methods: a raw string or a typed {@link S3.ObjectKey}. */
    export type Key = string | ObjectKey;

    /** One stored version of an object (newest first from {@link S3.listVersions}) — the history a caller
     *  can revert to via {@link S3.restoreVersion}. */
    export interface Version { versionId : string; size : number; lastModified : string; isLatest : boolean; }
}
