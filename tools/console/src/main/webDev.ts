import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { join, relative, sep } from "node:path";

import { DescribeStackResourcesCommand } from "@aws-sdk/client-cloudformation";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { awsErr, cfnClient, s3Client } from "./aws";
import { logStore } from "./logStore";
import { processManager } from "./processManager";
import { serviceDir } from "./paths";

//
// Fast deployed loop for a frontend: `vite build --watch` rebuilds bin/ incrementally, and a file
// watcher syncs the output straight into the LocalStack S3 site bucket via the SDK — bypassing the
// slow `cdklocal deploy` (full synth + BucketDeployment custom resource). The bucket is discovered
// from the service stack's resources, so we don't couple to the naming convention.
//

interface SyncState { watcher : FSWatcher; bucket : string; timer? : NodeJS.Timeout; busy : boolean; }
const active = new Map<string, SyncState>();

/** Find the static-site S3 bucket physical name from the deployed `<service>-local` stack. */
async function siteBucket( service : string ) : Promise<string | undefined>
{
    try
    {
        const out = await cfnClient().send( new DescribeStackResourcesCommand( { StackName: `${service}-local` } ) );
        const bucketResource = ( out.StackResources ?? [] )
            .find( ( resource ) => resource.ResourceType === "AWS::S3::Bucket" && ( resource.LogicalResourceId ?? "" ).startsWith( "Bucket" ) );
        return bucketResource?.PhysicalResourceId;
    }
    catch { return undefined; }
}

const CONTENT_TYPE : Record<string, string> = {
    html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css",
    json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", map: "application/json", txt: "text/plain",
};

function contentType( file : string ) : string
{
    const ext : string = file.slice( file.lastIndexOf( "." ) + 1 ).toLowerCase();
    return CONTENT_TYPE[ ext ] ?? "application/octet-stream";
}

/** Recursively list every file under a directory (absolute paths). */
function walk( dir : string ) : Array<string>
{
    const out : Array<string> = [];
    for ( const name of readdirSync( dir ) )
    {
        const fullPath : string = join( dir, name );
        if ( statSync( fullPath ).isDirectory() ) out.push( ...walk( fullPath ) );
        else out.push( fullPath );
    }
    return out;
}

/** Upload the whole build output into the bucket (keys = paths relative to bin/, POSIX separators). */
async function uploadAll( dir : string, bucket : string ) : Promise<number>
{
    const files : Array<string> = walk( dir );
    const s3 = s3Client();
    for ( const file of files )
    {
        const key : string = relative( dir, file ).split( sep ).join( "/" );
        await s3.send( new PutObjectCommand( {
            Bucket: bucket, Key: key, Body: readFileSync( file ), ContentType: contentType( file ),
        } ) );
    }
    return files.length;
}

/** Start the fast deployed loop: spawn `vite build --watch` and sync each rebuild into the site bucket. */
export async function startWatchSync( service : string ) : Promise<{ ok : boolean; error? : string }>
{
    if ( active.has( service ) ) return { ok: true };

    const bin : string = join( serviceDir( service ), "bin" );
    const bucket : string | undefined = await siteBucket( service );
    if ( !bucket )
        return { ok: false, error: `couldn't find the site bucket — deploy ${service} once (Build + Deploy) so the stack exists, then start watch-sync.` };

    // kick off the incremental builder; its output lands in the Build stream
    processManager.startBuildWatch( service );

    // upload the current build output, guarding against overlapping runs via the busy flag
    const doSync = () : void =>
    {
        const sync : SyncState | undefined = active.get( service );
        if ( !sync || sync.busy || !existsSync( bin ) ) return;
        sync.busy = true;
        uploadAll( bin, bucket )
            .then( ( count : number ) => logStore.sys( service, "deploy", `⇡ synced ${count} file(s) → s3://${bucket}` ) )
            .catch( ( err ) => logStore.sys( service, "deploy", `✖ sync failed: ${awsErr( err )}` ) )
            .finally( () => { const current = active.get( service ); if ( current ) current.busy = false; } );
    };

    // debounce rebuild bursts (vite writes many files per build)
    const watcher : FSWatcher = watch( existsSync( bin ) ? bin : serviceDir( service ), { recursive: true }, () =>
    {
        const sync : SyncState | undefined = active.get( service );
        if ( !sync ) return;
        if ( sync.timer ) clearTimeout( sync.timer );
        sync.timer = setTimeout( doSync, 600 );
    } );

    active.set( service, { watcher, bucket, busy: false } );
    logStore.sys( service, "deploy", `▶ watch-sync started — vite build --watch → s3://${bucket} (no cdk deploy)` );
    if ( existsSync( bin ) ) doSync();   // push the current build immediately
    return { ok: true };
}

/** Stop watch-sync for a service: clear the debounce timer, close the watcher, and kill the build process. */
export function stopWatchSync( service : string ) : void
{
    const sync : SyncState | undefined = active.get( service );
    if ( !sync ) return;
    if ( sync.timer ) clearTimeout( sync.timer );
    try { sync.watcher.close(); } catch { /* already closed */ }
    active.delete( service );
    processManager.kill( service, "build" );
    logStore.sys( service, "deploy", "■ watch-sync stopped" );
}

export function isWatchSyncing( service : string ) : boolean { return active.has( service ); }

/**
 * One-shot: push the current build output into the site bucket. Called right after a local
 * `cdklocal deploy` of a frontend — on LocalStack the CDK BucketDeployment is skipped (it mishandles
 * Updates), so the deploy creates the bucket + CloudFront but uploads nothing; this populates it.
 */
export async function syncSiteOnce( service : string ) : Promise<{ ok : boolean; error? : string }>
{
    const bin : string = join( serviceDir( service ), "bin" );
    if ( !existsSync( bin ) )
        return { ok: false, error: `no build output at ${bin} — run the Build stage first` };

    const bucket : string | undefined = await siteBucket( service );
    if ( !bucket )
        return { ok: false, error: `couldn't find the site bucket for ${service}-local` };

    try
    {
        const count : number = await uploadAll( bin, bucket );
        logStore.sys( service, "deploy", `⇡ synced ${count} file(s) → s3://${bucket} (BucketDeployment skipped on local)` );
        return { ok: true };
    }
    catch ( err )
    {
        logStore.sys( service, "deploy", `✖ site sync failed: ${awsErr( err )}` );
        return { ok: false, error: awsErr( err ) };
    }
}
