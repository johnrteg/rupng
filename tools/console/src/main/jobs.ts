import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { InvokeCommand, ListFunctionsCommand, type InvokeCommandOutput, type ListFunctionsCommandOutput } from "@aws-sdk/client-lambda";

import type { InvokeResult, JobInfo, LambdaFn } from "../shared/types";
import { serviceDir } from "./paths";
import { awsErr, lambdaClient } from "./aws";

//
// Jobs / Lambdas (minimal). Jobs are discovered from a service's src/jobs/*.ts (files that export a
// `handler` — the base class doesn't, so it's excluded). Deployed Lambdas are queried from LocalStack
// via the AWS SDK and matched to the service by name. Invoke runs the function with a JSON payload.
//

const HANDLER_EXPORT = /export\s+(?:const|let|async\s+function|function)\s+handler\b/;

/** Discover the Lambda jobs declared in a service's source. */
export function listJobs( service : string ) : JobInfo[]
{
    const dir : string = join( serviceDir( service ), "src", "jobs" );
    if ( !existsSync( dir ) ) return [];

    return readdirSync( dir )
        .filter( ( f ) => f.endsWith( ".ts" ) && !f.endsWith( ".test.ts" ) )
        .map( ( f ) => ( { f, full: join( dir, f ) } ) )
        .filter( ( { full } ) =>
        {
            try { return HANDLER_EXPORT.test( readFileSync( full, "utf8" ) ); }
            catch { return false; }
        } )
        .map( ( { f } ) =>
        {
            const name : string = f.replace( /\.ts$/, "" );
            return { service, name, handler: `jobs/${name}.handler`, file: join( dir, f ) };
        } );
}

/** List Lambda functions deployed to LocalStack whose name matches the service. */
export async function lambdaList( service : string ) : Promise<{ functions : LambdaFn[]; error? : string }>
{
    try
    {
        const out : ListFunctionsCommandOutput = await lambdaClient().send( new ListFunctionsCommand( {} ) );
        const functions : LambdaFn[] = ( out.Functions ?? [] )
            .filter( ( fn ) => ( fn.FunctionName ?? "" ).toLowerCase().includes( service.toLowerCase() ) )
            .map( ( fn ) => ( { name: fn.FunctionName ?? "", runtime: fn.Runtime, lastModified: fn.LastModified } ) );
        return { functions };
    }
    catch ( err )
    {
        return { functions: [], error: awsErr( err ) };
    }
}

/** Invoke a deployed Lambda against LocalStack with a JSON payload; return status, log tail, payload. */
export async function lambdaInvoke( functionName : string, payloadJson : string ) : Promise<InvokeResult>
{
    // validate payload is JSON (empty → {})
    const payload : string = payloadJson.trim() === "" ? "{}" : payloadJson;
    try { JSON.parse( payload ); }
    catch ( err ) { return { ok: false, error: `payload is not valid JSON: ${( err as Error ).message}` }; }

    try
    {
        const out : InvokeCommandOutput = await lambdaClient().send( new InvokeCommand( {
            FunctionName : functionName,
            LogType      : "Tail",
            Payload      : new TextEncoder().encode( payload )
        } ) );

        const logTail : string | undefined = out.LogResult ? Buffer.from( out.LogResult, "base64" ).toString( "utf8" ) : undefined;

        let responsePayload : unknown;
        if ( out.Payload )
        {
            const text : string = Buffer.from( out.Payload ).toString( "utf8" );
            try { responsePayload = text ? JSON.parse( text ) : undefined; }
            catch { responsePayload = text; }
        }

        return {
            ok            : !out.FunctionError && ( out.StatusCode ?? 0 ) < 300,
            statusCode    : out.StatusCode,
            functionError : out.FunctionError,
            logTail,
            payload       : responsePayload
        };
    }
    catch ( err )
    {
        return { ok: false, error: awsErr( err ) };
    }
}
