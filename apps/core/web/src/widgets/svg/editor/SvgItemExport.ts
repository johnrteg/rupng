//
import AppModel from "@model/AppModel";

import { SvgDocument, GetMediaUrl } from "@repo/api";
import { RestfulService } from "@repo/endpoint";
import { Type, ResultUtils } from "@repo/common";

import JSZip from "jszip";

import { collectAssetIds, findObject } from "./SvgDocOps";
import { Manifest, ManifestAsset, SCHEMA_VERSION, extensionForMime } from "./SvgItemExportModel";

//
// SvgItemExport — build a downloadable `.zip` for a single canvas item: the object subtree (found by id,
// groups recurse) plus the `doc.assets` entries it references. Media-library-backed images are fetched via
// a presigned GET (`GetMediaUrl`) and bundled as bytes so the zip is portable across accounts/environments;
// embedded/cdn-only assets stay inline in the manifest. See SvgItemImport.ts for the reverse direction.
//

/** Build the exported `.zip` for the object `objectId` in `doc`, or an error Result if the object or one of
 *  its referenced assets can't be resolved/fetched. */
export async function buildExportBundle( doc : SvgDocument.Doc, objectId : string, appmodel : AppModel ) : Promise<Type.Result<Blob>>
{
    const object : SvgDocument.ObjectNode | undefined = findObject( doc, objectId );
    if( object === undefined ) return ResultUtils.err( "item not found" );

    // resolve the subtree's referenced doc.assets entries
    const assetIds : Array<string> = collectAssetIds( object );
    const assets   : Array<SvgDocument.Asset> = doc.assets.filter( ( asset : SvgDocument.Asset ) : boolean => assetIds.includes( asset.id ) );

    const zip : JSZip = new JSZip();
    const manifestAssets : Array<ManifestAsset> = [];

    // one asset at a time — a media-backed asset needs a presigned URL + fetch before it can be zipped
    for( const asset of assets )
    {
        const bundled : Type.Result<ManifestAsset> = await bundleAsset( asset, zip, appmodel );
        if( !bundled.ok ) return ResultUtils.err( bundled.error );
        manifestAssets.push( bundled.data );
    }

    const manifest : Manifest = { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), object, assets: manifestAssets };
    zip.file( "manifest.json", JSON.stringify( manifest, null, 2 ) );

    return ResultUtils.from( async () : Promise<Blob> => zip.generateAsync( { type: "blob" } ) );
}

/** Resolve one `doc.assets` entry into its manifest description, fetching + zipping bytes for a media-
 *  library-backed asset (embedded/cdn-only assets need no bytes and stay inline in the manifest). */
async function bundleAsset( asset : SvgDocument.Asset, zip : JSZip, appmodel : AppModel ) : Promise<Type.Result<ManifestAsset>>
{
    if( asset.mediaId === null )
        return ResultUtils.ok( {
            id: asset.id, kind: asset.kind, name: asset.name, mimeType: asset.mimeType,
            sourceMediaId: null, file: null, cdnUrl: asset.cdnUrl, embedded: asset.embedded,
        } );

    // media-library-backed — resolve a presigned GET, fetch the bytes, and add them to the zip
    const signed : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( asset.mediaId ) );
    if( !signed.ok || !signed.data ) return ResultUtils.err( RestfulService.error( signed, `could not resolve "${ asset.name }"` ) );

    const fetched : Type.Result<Blob> = await ResultUtils.from( async () : Promise<Blob> =>
    {
        const response : Response = await fetch( signed.data!.url );
        if( !response.ok ) throw new Error( `download failed (${ response.status })` );
        return response.blob();
    } );
    if( !fetched.ok ) return ResultUtils.err( `could not download "${ asset.name }": ${ fetched.error }` );

    const file : string = `assets/${ asset.id }.${ extensionForMime( asset.mimeType ) }`;
    zip.file( file, fetched.data );

    return ResultUtils.ok( {
        id: asset.id, kind: asset.kind, name: asset.name, mimeType: asset.mimeType,
        sourceMediaId: asset.mediaId, file, cdnUrl: asset.cdnUrl, embedded: asset.embedded,
    } );
}
