//
import { randomUUID } from "node:crypto";

import { SvgAsset, Browse } from "@repo/api";
import { FileUtils, ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";

import MediaService from "./MediaService";
import { BrowseFactory } from "../browse/BrowseFactory";
import { BrowseProvider, BrowseContext, BrowseAcquisition } from "../browse/BrowseProvider";
import SvgSanitizer from "../utils/SvgSanitizer";
import SvgThreatScanner from "../utils/SvgThreatScanner";

//
// SvgAssetService — the server side of the SVG library (icons/logos/clipart placeable onto any SVG editor
// page). A helper over the shared media plane, mirroring SvgService's template pattern: markup lives as a
// sanitized SVG string in S3 (`svg-assets/{owner}/{id}.svg`), DynamoDB holds the metadata row in two owner
// partitions — SYSTEM_OWNER (platform-wide, read-only to regular users) or the account's own. No scan/
// process/variant pipeline — sanitizing + storing text is fast synchronous work, not a job. Never throws —
// every method returns a Type.Result.
//
export class SvgAssetService
{
    private readonly media : MediaService;
    private readonly browseFactory : BrowseFactory = new BrowseFactory();

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( media : MediaService )
    {
        this.media = media;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── S3 key layout ────────────────────────────────────────────────────────────────────

    private static svgKey( owner : string, id : string ) : string
    {
        return `svg-assets/${ owner }/${ id }.svg`;
    }

    // quarantined raw markup lives in the STAGING bucket (never the library bucket) — its 7-day lifecycle
    // rule bounds the S3 object's lifetime alongside the DDB row's own `ttl`
    private static quarantineKey( owner : string, id : string ) : string
    {
        return `svg-quarantine/${ owner }/${ id }.svg`;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── List ─────────────────────────────────────────────────────────────────────────────

    /** List the system (platform-wide) graphics + the account's own, newest first. */
    public async list( accountId : string ) : Promise<Type.Result<Array<SvgAsset.Summary>>>
    {
        const system : Type.Result<Array<SvgAsset.Entity>> = await this.media.dynamo.query<SvgAsset.Entity>( "svg-assets", {
            KeyConditionExpression:    "#owner = :owner",
            ExpressionAttributeNames:  { "#owner": "owner" },
            ExpressionAttributeValues: { ":owner": SvgAssetService.SYSTEM_OWNER },
        } );
        const account : Type.Result<Array<SvgAsset.Entity>> = await this.media.dynamo.query<SvgAsset.Entity>( "svg-assets", {
            KeyConditionExpression:    "#owner = :owner",
            ExpressionAttributeNames:  { "#owner": "owner" },
            ExpressionAttributeValues: { ":owner": accountId },
        } );

        const merged : Array<SvgAsset.Entity> = [ ...( system.ok ? system.data : [] ), ...( account.ok ? account.data : [] ) ];
        const summaries : Array<SvgAsset.Summary> = merged
            .sort( ( first : SvgAsset.Entity, second : SvgAsset.Entity ) : number => second.updatedAt - first.updatedAt )
            .map( ( entity : SvgAsset.Entity ) : SvgAsset.Summary => this.toSummary( entity ) );
        return ResultUtils.ok( summaries );
    }

    /** Project a stored asset Entity to its list Summary (drops the S3 markup key). */
    private toSummary( entity : SvgAsset.Entity ) : SvgAsset.Summary
    {
        return {
            id: entity.id, scope: entity.scope, accountId: entity.accountId, name: entity.name,
            thumbnailKey: entity.thumbnailKey, tags: entity.tags, source: entity.source,
            createdAt: entity.createdAt, updatedAt: entity.updatedAt,
        };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── Create ───────────────────────────────────────────────────────────────────────────

    /** Add a graphic from raw markup (direct upload) or a Browse provider pick, into either the account's own
     *  library (`system = false`) or the platform-wide library (`system = true`). The ROOT gate for system-
     *  wide creates lives on the calling endpoint (PostSystemSvgAsset) — this service trusts its caller.
     *  Returns the sanitized markup too, so the caller can place it immediately without a second fetch. */
    public async create( accountId : string, system : boolean, body : SvgAsset.CreateBody ) : Promise<Type.Result<{ assetId : string; svg : string }>>
    {
        const raw : Type.Result<string> = await this.resolveMarkup( body );
        if( !raw.ok ) return ResultUtils.err( raw.error, raw.cause );

        // reject-and-quarantine outright on a genuine attack vector, rather than silently sanitizing it away —
        // the uploader gets no signal their file was tampered with otherwise, and the constructs SvgSanitizer
        // re-legitimizes (same-document <use>/gradient xlink:href, class-based <style>) are never flagged here
        const threats : Array<SvgAsset.RejectReason> = SvgThreatScanner.scan( raw.data );
        if( threats.length > 0 ) return this.quarantine( accountId, system, body, raw.data, threats );

        const sanitized : string = SvgSanitizer.sanitize( raw.data );
        if( sanitized.trim() === "" ) return ResultUtils.err( "the SVG markup was empty after sanitization" );

        const owner : string = system ? SvgAssetService.SYSTEM_OWNER : accountId;
        const id : string = randomUUID();
        const key : string = SvgAssetService.svgKey( owner, id );
        const wrote : Type.Result<void> = await this.media.s3.put( "media", key, Buffer.from( sanitized, "utf8" ), FileUtils.Mime.IMAGE_SVG );
        if( !wrote.ok ) return ResultUtils.err( "could not store the SVG", wrote.cause );

        const now : number = Date.now();
        const entity : SvgAsset.Entity & { owner : string } =
        {
            owner, id, scope: system ? SvgAsset.Scope.SYSTEM : SvgAsset.Scope.ACCOUNT,
            accountId: system ? null : accountId, name: body.name.trim(), svgKey: key, thumbnailKey: null,
            tags: body.tags ?? [], source: body.provider !== undefined ? SvgAsset.SourceKind.PROVIDER : SvgAsset.SourceKind.UPLOAD,
            provider: body.provider, createdAt: now, updatedAt: now,
        };
        const row : Type.Result<void> = await this.media.dynamo.put( "svg-assets", { ...entity } );
        if( !row.ok ) return ResultUtils.err( "could not create the SVG asset row", row.cause );

        return ResultUtils.ok( { assetId: id, svg: sanitized } );
    }

    /** Store a rejected upload's raw markup + why, rather than sanitizing it away. Best-effort: an S3/DDB
     *  failure here still surfaces the ORIGINAL rejection to the caller (the quarantine store is an audit
     *  trail, not something the reject decision should hinge on). */
    private async quarantine(
        accountId : string, system : boolean, body : SvgAsset.CreateBody, raw : string, reasons : Array<SvgAsset.RejectReason>,
    ) : Promise<Type.Result<{ assetId : string; svg : string }>>
    {
        const owner : string = system ? SvgAssetService.SYSTEM_OWNER : accountId;
        const id : string = randomUUID();
        const key : string = SvgAssetService.quarantineKey( owner, id );

        const wrote : Type.Result<void> = await this.media.s3.put( "media-staging", key, Buffer.from( raw, "utf8" ), FileUtils.Mime.IMAGE_SVG );
        if( !wrote.ok ) this.media.log.warn( "svg quarantine: S3 store failed", { id, error: wrote.error } );

        const nowSeconds : number = Math.floor( Date.now() / 1000 );
        const entity : SvgAsset.QuarantineEntity & { owner : string } =
        {
            owner, id, accountId: system ? null : accountId, name: body.name.trim(), reasons, svgKey: key,
            createdAt: nowSeconds, ttl: nowSeconds + SvgAssetService.QUARANTINE_TTL_SECONDS,
        };
        const row : Type.Result<void> = await this.media.dynamo.put( "svg-asset-quarantine", { ...entity } );
        if( !row.ok ) this.media.log.warn( "svg quarantine: row write failed", { id, error: row.error } );

        const rejection : SvgAsset.QuarantineRejection = { quarantined: true, reasons };
        return ResultUtils.err( `SVG rejected — contains disallowed content: ${ reasons.join( ", " ) }`, rejection );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── Read (single, for preview + placement) ──────────────────────────────────────────

    /** Read one asset's markup — `scope` picks the owner partition (SYSTEM vs this account); the caller
     *  already has it from the Summary the list returned, so there's no partition-guessing here. */
    public async get( id : string, accountId : string, scope : SvgAsset.Scope | undefined ) : Promise<Type.Result<{ name : string; svg : string }>>
    {
        const owner : string = scope === SvgAsset.Scope.SYSTEM ? SvgAssetService.SYSTEM_OWNER : accountId;
        const got : Type.Result<SvgAsset.Entity | undefined> = await this.media.dynamo.get<SvgAsset.Entity>( "svg-assets", { owner, id } );
        if( !got.ok ) return ResultUtils.err( "could not read the asset", got.cause );
        if( got.data === undefined ) return ResultUtils.err( "asset not found" );

        const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.media.s3.get( "media", got.data.svgKey );
        if( !object.ok || !object.data.Body ) return ResultUtils.err( "SVG markup not found" );
        const bytes : Uint8Array = await object.data.Body.transformToByteArray();

        return ResultUtils.ok( { name: got.data.name, svg: new TextDecoder().decode( bytes ) } );
    }

    /** Resolve the raw (unsanitized) markup for a create request — either the body's own `svg` text, or a
     *  fetch of a Browse provider's acquired SVG bytes (SVGL/Iconify only — both keyless, so an empty/dummy
     *  BrowseContext is fine; neither adapter's acquire() reads it beyond passing it through unused). */
    private async resolveMarkup( body : SvgAsset.CreateBody ) : Promise<Type.Result<string>>
    {
        if( body.svg !== undefined && body.svg.trim() !== "" ) return ResultUtils.ok( body.svg );
        if( body.provider === undefined || body.externalId === undefined ) return ResultUtils.err( "either svg or provider+externalId is required" );

        if( body.provider !== Browse.Provider.SVGL && body.provider !== Browse.Provider.ICONIFY )
            return ResultUtils.err( "unsupported provider for SVG import" );

        const adapter : BrowseProvider | undefined = this.browseFactory.get( body.provider );
        if( adapter === undefined ) return ResultUtils.err( "provider unavailable" );

        const ctx : BrowseContext = { apiKey: "", limits: { maxResultsPerProvider: 1, perProviderTimeoutMs: 8000, resultCacheTtlSec: 0 } };
        const acquisition : BrowseAcquisition | null = await adapter.acquire( body.externalId, ctx );
        if( acquisition === null || acquisition.fetchUrl === undefined ) return ResultUtils.err( "could not acquire the provider asset" );

        try
        {
            const response : Response = await fetch( acquisition.fetchUrl );
            if( !response.ok ) return ResultUtils.err( "could not fetch the provider's SVG" );
            return ResultUtils.ok( await response.text() );
        }
        catch( err )
        {
            return ResultUtils.err( "could not fetch the provider's SVG", err );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── Delete ───────────────────────────────────────────────────────────────────────────

    /** Delete an account-owned asset (its S3 markup + row). System-wide rows are never deletable here — the
     *  lookup key is scoped to `accountId`, so a system row simply reads as not found. */
    public async remove( id : string, accountId : string ) : Promise<Type.Result<void>>
    {
        const got : Type.Result<SvgAsset.Entity | undefined> = await this.media.dynamo.get<SvgAsset.Entity>( "svg-assets", { owner: accountId, id } );
        if( !got.ok ) return ResultUtils.err( "could not read the asset", got.cause );
        if( got.data === undefined ) return ResultUtils.err( "asset not found" );

        const removedRow : Type.Result<void> = await this.media.dynamo.remove( "svg-assets", { owner: accountId, id } );
        if( !removedRow.ok ) return ResultUtils.err( "could not delete the asset row", removedRow.cause );

        // best-effort S3 cleanup — the row is already gone; a leaked object isn't fatal to the delete
        const removedObject : Type.Result<void> = await this.media.s3.remove( "media", got.data.svgKey );
        if( !removedObject.ok ) this.media.log.warn( "svg asset delete: S3 cleanup failed", { id, error: removedObject.error } );

        return ResultUtils.ok( undefined );
    }
}

export namespace SvgAssetService
{
    /** The reserved DynamoDB partition value for platform (system) SVG assets — same sentinel convention as
     *  SvgService.SYSTEM_OWNER, declared independently to avoid coupling two otherwise-unrelated services. */
    export const SYSTEM_OWNER : string = "__system__";

    /** How long a quarantined upload's row/S3 object survive before DynamoDB's native TTL deletion sweeps
     *  them — a 30-day window to review/audit a rejected upload before it's gone for good. */
    export const QUARANTINE_TTL_SECONDS : number = 30 * 24 * 60 * 60;
}

export default SvgAssetService;
// eof
