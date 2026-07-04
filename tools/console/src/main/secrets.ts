//
// Secrets Manager — the Console's Secrets tab: list a service's secrets (its own + the platform-shared AI
// keys every service reads), reveal a value, and set/update it. Physical names follow the cloud-manifest
// convention `<env>-<service>-secret-<key>` (service-owned) and `<env>-platform-secret-<key>` (platform).
// Mutating calls are blocked against a real AWS target (LocalStack only), mirroring the AppConfig editor.
//
import {
    ListSecretsCommand, GetSecretValueCommand, PutSecretValueCommand,
    type SecretListEntry,
} from "@aws-sdk/client-secrets-manager";

import { secretsClient, awsErr, isReadOnly } from "./aws";
import type { SecretList, SecretSummary, SecretValue, SecretSaveResult } from "../shared/types";

/** Split a physical secret name into `{ scope, service, key }` per the cloud-manifest naming, or null if it
 *  isn't a `<env>-<owner>-secret-<key>` name. `owner` = "platform" (shared) or the service name (owned). */
function parseName( name : string ) : { scope : "service" | "platform"; owner : string; key : string } | null
{
    const marker : string = "-secret-";
    const at : number = name.indexOf( marker );
    if( at < 0 ) return null;
    const key : string = name.slice( at + marker.length );
    const prefix : string = name.slice( 0, at );               // "<env>-<owner>"
    const dash : number = prefix.indexOf( "-" );
    if( dash < 0 ) return null;
    const owner : string = prefix.slice( dash + 1 );           // drop the env segment
    return { scope: owner === "platform" ? "platform" : "service", owner, key };
}

/** List the secrets relevant to `service`: its own (`*-<service>-secret-*`) + platform-shared (`*-platform-
 *  secret-*`). Sorted platform-first then by key. */
export async function secretsList( service : string ) : Promise<SecretList>
{
    try
    {
        const client = secretsClient();
        const entries : Array<SecretListEntry> = [];
        let token : string | undefined;
        do
        {
            const page = await client.send( new ListSecretsCommand( { NextToken: token, MaxResults: 100 } ) );
            ( page.SecretList ?? [] ).forEach( ( entry ) => entries.push( entry ) );
            token = page.NextToken;
        }
        while( token );

        const secrets : Array<SecretSummary> = [];
        for( const entry of entries )
        {
            const name : string = entry.Name ?? "";
            const parsed = parseName( name );
            if( parsed === null ) continue;
            if( parsed.scope === "service" && parsed.owner !== service ) continue;   // another service's secret
            secrets.push( {
                name,
                arn         : entry.ARN ?? name,
                key         : parsed.key,
                scope       : parsed.scope,
                description : entry.Description,
                hasValue    : entry.LastChangedDate !== undefined || entry.LastAccessedDate !== undefined,
                lastChanged : entry.LastChangedDate ? entry.LastChangedDate.toISOString() : undefined,
                isJson      : false,   // refined on reveal (we don't fetch every value up front)
            } );
        }

        secrets.sort( ( first, second ) =>
            first.scope === second.scope ? first.key.localeCompare( second.key ) : ( first.scope === "platform" ? -1 : 1 ) );
        return { secrets };
    }
    catch( err ) { return { secrets: [], error: awsErr( err ) }; }
}

/** Reveal a secret's current plaintext value (by ARN or name). */
export async function secretGet( secretId : string ) : Promise<SecretValue>
{
    try
    {
        const out = await secretsClient().send( new GetSecretValueCommand( { SecretId: secretId } ) );
        return { value: out.SecretString ?? "" };
    }
    catch( err ) { return { value: "", error: awsErr( err ) }; }
}

/** Set/update a secret's value (LocalStack only — blocked against a real AWS target). */
export async function secretSave( secretId : string, value : string ) : Promise<SecretSaveResult>
{
    if( isReadOnly() ) return { ok: false, error: "Secrets are read-only against a real AWS target — edit in the AWS console." };
    try
    {
        await secretsClient().send( new PutSecretValueCommand( { SecretId: secretId, SecretString: value } ) );
        return { ok: true };
    }
    catch( err ) { return { ok: false, error: awsErr( err ) }; }
}

/** Clear a secret's value → an EMPTY string, so a reader treats it as UNSET (e.g. a Browse provider with no
 *  key is dropped from the app). Used to wipe an auto-generated/placeholder value that was never really set.
 *  LocalStack only — blocked against a real AWS target. */
export async function secretClear( secretId : string ) : Promise<SecretSaveResult>
{
    if( isReadOnly() ) return { ok: false, error: "Secrets are read-only against a real AWS target — edit in the AWS console." };
    try
    {
        await secretsClient().send( new PutSecretValueCommand( { SecretId: secretId, SecretString: "" } ) );
        return { ok: true };
    }
    catch( err ) { return { ok: false, error: awsErr( err ) }; }
}
