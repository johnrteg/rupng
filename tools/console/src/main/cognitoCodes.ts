import { execFile } from "node:child_process";
import { delimiter } from "node:path";
import { promisify } from "node:util";

import type { CognitoCode, CognitoCodeListing } from "../shared/types";

//
// Cognito verification codes (dev convenience).
//
// In real AWS, Cognito emails the sign-up / reset code to the user. LocalStack doesn't deliver it — it
// just LOGS it (and it never touches the SES capture, since Cognito sends it internally, not via
// SES.SendEmail). So in dev there's no inbox to read; the code lives in the LocalStack container log:
//   "… l.p.c.s.c.provider : Confirmation code for Cognito user <id>: <code>"
// This tails that log and surfaces the codes in the Console so you don't have to grep docker by hand.
//

const exec = promisify( execFile );

/** PATH with Homebrew/local bins so `docker` resolves even when the app was launched from Finder. */
function dockerEnv() : NodeJS.ProcessEnv
{
    const path : string = [ "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? "" ].filter( Boolean ).join( delimiter );
    return { ...process.env, PATH: path };
}

// "<iso-ts> … Confirmation code for Cognito user <user>: <code>" — capture ts (line start), user, code.
const CODE_LINE : RegExp = /Confirmation code for Cognito user\s+(.+?):\s*(\d+)/;
const TS_PREFIX : RegExp = /^(\S+)/;

/** The running LocalStack container's name (first match), or undefined if none is up. */
async function localstackContainer() : Promise<string | undefined>
{
    try
    {
        const { stdout } = await exec( "docker", [ "ps", "--filter", "name=localstack", "--format", "{{.Names}}" ], { env: dockerEnv() } );
        return stdout.split( /\r?\n/ ).map( ( line ) => line.trim() ).find( Boolean );
    }
    catch { return undefined; }
}

/** Captured Cognito verification codes from the LocalStack log, newest first. LocalStack-only. */
export async function cognitoCodes() : Promise<CognitoCodeListing>
{
    const container : string | undefined = await localstackContainer();
    if ( !container ) return { ok: false, codes: [], error: "LocalStack isn't running — start it to capture Cognito codes." };

    try
    {
        // tail a generous window of log lines; grepping is done here (logs can be large, so cap the read)
        const { stdout } = await exec( "docker", [ "logs", "--tail", "5000", container ], { env: dockerEnv(), maxBuffer: 16 * 1024 * 1024 } );
        const codes : Array<CognitoCode> = [];
        for ( const line of stdout.split( /\r?\n/ ) )
        {
            const match : RegExpMatchArray | null = line.match( CODE_LINE );
            if ( !match ) continue;
            const when : string | undefined = line.match( TS_PREFIX )?.[ 1 ];
            const at   : number = when ? Date.parse( when ) : NaN;
            codes.push( { user: match[ 1 ].trim(), code: match[ 2 ], at: Number.isFinite( at ) ? at : 0 } );
        }
        // newest first; keep only the most recent per user so the list stays the "current code" per identifier
        codes.reverse();
        const latestPerUser : Array<CognitoCode> = [];
        const seen : Set<string> = new Set();
        for ( const entry of codes ) if ( !seen.has( entry.user ) ) { seen.add( entry.user ); latestPerUser.push( entry ); }
        return { ok: true, codes: latestPerUser };
    }
    catch ( err )
    {
        return { ok: false, codes: [], error: ( err as Error ).message };
    }
}
