//
import AppModel from "@model/AppModel";

import { SvgDocument, Media, GetAsset, PostUpload, PostUploadComplete } from "@repo/api";
import { RestfulService } from "@repo/endpoint";
import { Type, ResultUtils } from "@repo/common";

import JSZip from "jszip";

import { remapAssetIds } from "./SvgDocOps";
import { makeId } from "./SvgEditorModel";
import { cloneWithFreshIds } from "./svgEditorReducer";
import { Manifest, ManifestAsset, SCHEMA_VERSION } from "./SvgItemExportModel";

//
// SvgItemImport — the reverse of SvgItemExport.ts: unzip a previously-exported item bundle, check each
// referenced asset's original Media Library id against the destination account's library, materialize the
// assets (reuse the existing one, or upload the bundled bytes as a new one), then remap the object subtree
// onto the freshly-materialized local asset ids so it can be dropped into the current document.
//

/** Whether an imported asset's original Media Library id still exists in the destination account, and (if
 *  the user is asked) which way to resolve it. "existing" reuses the found asset; "new" always uploads the
 *  bundled bytes — the default when nothing is found (no prompt needed in that case). */
export type AssetDecision = "existing" | "new";

/** One manifest asset's existence check against the destination account's Media Library. */
export interface AssetCheck
{
    readonly manifestAssetId : string;
    readonly found           : boolean;
    readonly existing?       : Media.Asset;
}

/** Unzip an exported item bundle and parse its manifest, rejecting an unrecognized/missing schema version. */
export async function parseImportBundle( file : File ) : Promise<Type.Result<{ manifest : Manifest; zip : JSZip }>>
{
    return ResultUtils.from( async () : Promise<{ manifest : Manifest; zip : JSZip }> =>
    {
        const zip  : JSZip = await JSZip.loadAsync( file );
        const entry : JSZip.JSZipObject | null = zip.file( "manifest.json" );
        if( entry === null ) throw new Error( "not a valid item bundle (missing manifest.json)" );
        const manifest : Manifest = JSON.parse( await entry.async( "text" ) ) as Manifest;
        if( manifest.schemaVersion !== SCHEMA_VERSION ) throw new Error( `unsupported item bundle version ${ manifest.schemaVersion }` );
        return { manifest, zip };
    } );
}

/** Check each manifest asset with a `sourceMediaId` against the destination account's Media Library
 *  (in parallel) — the result drives whether the import dialog needs to prompt for that asset. */
export async function checkExistingAssets( manifest : Manifest, appmodel : AppModel ) : Promise<Array<AssetCheck>>
{
    const withSource : Array<ManifestAsset> = manifest.assets.filter( ( asset : ManifestAsset ) : boolean => asset.sourceMediaId !== null );
    return Promise.all( withSource.map( async ( asset : ManifestAsset ) : Promise<AssetCheck> =>
    {
        const got : RestfulService.Reply<GetAsset.Response> = await appmodel.server.fetch( new GetAsset( asset.sourceMediaId! ) );
        return got.ok && got.data
            ? { manifestAssetId: asset.id, found: true, existing: got.data.asset }
            : { manifestAssetId: asset.id, found: false };
    } ) );
}

/** The presigned-upload handshake (mirrors `MediaUploadDialog.uploadOne`) — uploads raw bytes as a new,
 *  account-scoped Media Library asset. */
async function uploadBytesAsAsset( appmodel : AppModel, filename : string, mime : string, bytes : Blob ) : Promise<Type.Result<Media.Asset>>
{
    const begin : RestfulService.Reply<PostUpload.Response> = await appmodel.server.fetch( new PostUpload( { filename, mime, size: bytes.size, scope: Media.Scope.ACCOUNT, kind: Media.Kind.IMAGE } ) );
    if( !begin.ok || !begin.data ) return ResultUtils.err( RestfulService.error( begin, `could not start the upload for "${ filename }"` ) );

    const put : RestfulService.Reply = await appmodel.server.put( begin.data.upload.url, null, bytes, { "Content-Type": mime } );
    if( !put.ok ) return ResultUtils.err( RestfulService.error( put, `upload failed for "${ filename }"` ) );

    const done : RestfulService.Reply<PostUploadComplete.Response> = await appmodel.server.fetch( new PostUploadComplete( begin.data.asset.guid ) );
    if( !done.ok || !done.data ) return ResultUtils.err( RestfulService.error( done, `could not finalize the upload for "${ filename }"` ) );

    return ResultUtils.ok( done.data.asset );
}

/** Materialize every manifest asset into a local `doc.assets` entry: "existing" reuses the found
 *  `mediaId`, "new" (also the default when the source wasn't found) uploads the bundled bytes. Returns the
 *  finished assets to merge into `doc.assets`, plus the old→new asset-id map for {@link remapAssetIds}. */
export async function materializeAssets(
    manifest  : Manifest,
    zip       : JSZip,
    decisions : Record<string, AssetDecision>,
    appmodel  : AppModel,
) : Promise<Type.Result<{ idMap : Record<string, string>; assets : Array<SvgDocument.Asset> }>>
{
    const idMap : Record<string, string> = {};
    const assets : Array<SvgDocument.Asset> = [];

    for( const manifestAsset of manifest.assets )
    {
        const localId : string = makeId();
        idMap[ manifestAsset.id ] = localId;

        // embedded/cdn-only asset (no Media Library link) — carry it through unchanged, just a fresh local id
        if( manifestAsset.sourceMediaId === null )
        {
            assets.push( {
                id: localId, kind: manifestAsset.kind, mediaId: null,
                cdnUrl: manifestAsset.cdnUrl, embedded: manifestAsset.embedded,
                name: manifestAsset.name, mimeType: manifestAsset.mimeType,
            } );
            continue;
        }

        // "existing" reuses the found mediaId as-is; anything else (including "not found") uploads the bytes
        if( decisions[ manifestAsset.id ] === "existing" )
        {
            assets.push( {
                id: localId, kind: manifestAsset.kind, mediaId: manifestAsset.sourceMediaId,
                cdnUrl: null, embedded: null, name: manifestAsset.name, mimeType: manifestAsset.mimeType,
            } );
            continue;
        }

        if( manifestAsset.file === null ) return ResultUtils.err( `"${ manifestAsset.name }" has no bundled bytes to import as new` );
        const entry : JSZip.JSZipObject | null = zip.file( manifestAsset.file );
        if( entry === null ) return ResultUtils.err( `"${ manifestAsset.name }" is missing from the bundle` );
        const bytes : Blob = await entry.async( "blob" );

        const uploaded : Type.Result<Media.Asset> = await uploadBytesAsAsset( appmodel, manifestAsset.name, manifestAsset.mimeType, bytes );
        if( !uploaded.ok ) return ResultUtils.err( uploaded.error );

        assets.push( {
            id: localId, kind: manifestAsset.kind, mediaId: uploaded.data.guid,
            cdnUrl: null, embedded: null, name: manifestAsset.name, mimeType: manifestAsset.mimeType,
        } );
    }

    return ResultUtils.ok( { idMap, assets } );
}

/** Clone the manifest's object subtree with fresh object ids, then rewrite its `assetId` references onto
 *  the freshly-materialized local asset ids — ready to dispatch as `IMPORT_ITEM`. */
export function buildImportPayload( manifest : Manifest, idMap : Record<string, string> ) : { object : SvgDocument.ObjectNode }
{
    const cloned : SvgDocument.ObjectNode = cloneWithFreshIds( manifest.object );
    return { object: remapAssetIds( cloned, idMap ) };
}
