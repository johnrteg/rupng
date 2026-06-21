import { LOG_STREAMS, type StageState } from "../shared/types";
import { processManager } from "./processManager";
import { logStore } from "./logStore";

//
// Ask-Claude integration. The console persists every stream to <repo>/tools/console/.logs/<service>/.
// Since Claude Code runs in this same repo, the fastest "help me" path is a ready-to-paste prompt
// that points Claude at the exact log files — it already has access to the output, no copy/paste.
//

/** Build a prompt referencing the on-disk logs for a service (only streams that have output). */
export function claudePrompt( service : string ) : { prompt : string; paths : string[] }
{
    const state : StageState = processManager.stageState( service );

    const paths : string[] = [];
    for ( const stream of LOG_STREAMS )
    {
        if ( logStore.get( service, stream ).length > 0 ) paths.push( logStore.path( service, stream ) );
    }

    const failed : ( "build" | "image" | "deploy" )[] = ( [ "build", "image", "deploy" ] as const ).filter( ( s ) => state[ s ] === "failed" );

    const header : string = failed.length > 0
        ? `The "${failed.join( ", " )}" stage(s) of the "${service}" service failed in the RumbleUp console.`
        : `I'm working on the "${service}" service in the RumbleUp console and want you to review its build/deploy output.`;

    const fileList : string = paths.length > 0
        ? paths.map( ( p ) => `  - ${p}` ).join( "\n" )
        : "  (no logs captured yet)";

    const prompt : string =
`${header}

Read the captured console output and diagnose what went wrong (and fix it if you can):
${fileList}

Stage status: ${( [ "build", "image", "deploy" ] as const ).map( ( s ) => `${s}=${state[ s ]}` ).join( ", " )}.`;

    return { prompt, paths };
}
