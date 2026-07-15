//
// Secrets Manager — the Console's Secrets tab: list a service's secrets (its own + the platform-shared AI
// keys every service reads), reveal a value, and set/update it. Physical names follow the cloud-manifest
// convention `<env>-<service>-secret-<key>` (service-owned) and `<env>-platform-secret-<key>` (platform).
// Mutating calls are blocked against a real AWS target (LocalStack only), mirroring the AppConfig editor.
//
import {
    ListSecretsCommand, GetSecretValueCommand, PutSecretValueCommand, DeleteSecretCommand, CreateSecretCommand, TagResourceCommand,
    type SecretListEntry, type Tag,
} from "@aws-sdk/client-secrets-manager";

// Tag key stamped when a human actually saves a value — distinguishes a real, configured key from a
// CDK-provisioned shell (CDK auto-generates a random placeholder value, so `LastChangedDate`/a present value
// can't tell "configured" from "never set"). The list reads this tag (free in ListSecrets) for the chip.
const CONFIGURED_TAG : string = "rupng:configured";

import { Providers } from "@repo/system";

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

/** Whether a live secret has been CONFIGURED by a human (carries the `rupng:configured` tag) — as opposed to
 *  a CDK-provisioned shell whose value is an auto-generated random placeholder. Drives the "set" vs "not set"
 *  chip honestly (a random placeholder must NOT read as "set"). */
function isConfigured( entry : SecretListEntry ) : boolean
{
    const tags : Array<Tag> = entry.Tags ?? [];
    return tags.some( ( tag : Tag ) : boolean => tag.Key === CONFIGURED_TAG && tag.Value === "true" );
}

/** The environment segment of a physical secret name (`<env>-<owner>-secret-<key>` → `<env>`), or undefined. */
function envOf( name : string ) : string | undefined
{
    const marker : number = name.indexOf( "-secret-" );
    if( marker <= 0 ) return undefined;
    const prefix : string = name.slice( 0, marker );          // "<env>-<owner>"
    const dash : number = prefix.indexOf( "-" );
    return dash > 0 ? prefix.slice( 0, dash ) : undefined;
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

        // index the LIVE secrets (that exist in Secrets Manager) by physical name, scoped to this service +
        // platform. `exists: true` — a value may or may not be set (hasValue).
        const byName : Map<string, SecretSummary> = new Map<string, SecretSummary>();
        let env : string = "local";   // env prefix for building declared-secret names; refined from a live name below
        for( const entry of entries )
        {
            const name : string = entry.Name ?? "";
            const parsed = parseName( name );
            if( parsed === null ) continue;
            if( parsed.scope === "service" && parsed.owner !== service ) continue;   // another service's secret
            env = envOf( name ) ?? env;
            byName.set( name, {
                name,
                arn         : entry.ARN ?? name,
                key         : parsed.key,
                scope       : parsed.scope,
                description : entry.Description,
                exists      : true,
                hasValue    : isConfigured( entry ),   // a real, human-set value — NOT a CDK placeholder
                lastChanged : entry.LastChangedDate ? entry.LastChangedDate.toISOString() : undefined,
                isJson      : false,   // refined on reveal (we don't fetch every value up front)
            } );
        }

        // overlay the DECLARED providers (platform + this service) from the registry — so a declared-but-
        // uncreated provider secret (deleted, or awaiting a key) still shows as `exists: false` with an "add
        // key" affordance, and every provider carries its registry metadata (category / hint / docs / fields).
        const declared : Array<Providers.Provider> = [ ...Providers.platform(), ...Providers.forService( service ) ];
        for( const provider of declared )
        {
            const scope : "platform" | "service" = Providers.isPlatform( provider ) ? "platform" : "service";
            const physical : string = `${ env }-${ Providers.owner( provider ) }-secret-${ provider.secretKey }`;
            const live : SecretSummary | undefined = byName.get( physical );
            const meta : Partial<SecretSummary> = { category: provider.category, label: provider.label, keyHint: provider.keyHint, docsUrl: provider.docsUrl, fields: provider.fields };
            if( live ) Object.assign( live, meta );   // annotate the live secret with its provider metadata
            else byName.set( physical, {
                name: physical, arn: physical, key: provider.secretKey, scope,
                description: provider.label, exists: false, hasValue: false, isJson: !!provider.fields, ...meta,
            } );
        }

        const secrets : Array<SecretSummary> = [ ...byName.values() ];
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

/** Set a secret's value — creating the secret first if it doesn't exist yet (a declared-but-uncreated key,
 *  e.g. one that was deleted or is awaiting its key). `secretId` is the ARN for a live secret, or the physical
 *  NAME for a not-yet-created one (the list supplies the name as the arn when `exists: false`). LocalStack
 *  only — blocked against a real AWS target. */
export async function secretSave( secretId : string, value : string ) : Promise<SecretSaveResult>
{
    if( isReadOnly() ) return { ok: false, error: "Secrets are read-only against a real AWS target — edit in the AWS console." };
    try
    {
        // write the value, then stamp the "configured" tag so the list shows it as a real key (not a shell)
        await secretsClient().send( new PutSecretValueCommand( { SecretId: secretId, SecretString: value } ) );
        await markConfigured( secretId );
        return { ok: true };
    }
    catch( err )
    {
        // the secret doesn't exist yet → CREATE it (secretId is its physical name for a not-yet-created secret)
        if( ( err as { name? : string } )?.name === "ResourceNotFoundException" )
        {
            try
            {
                await secretsClient().send( new CreateSecretCommand( { Name: secretId, SecretString: value, Tags: [ { Key: CONFIGURED_TAG, Value: "true" } ] } ) );
                return { ok: true };
            }
            catch( createErr ) { return { ok: false, error: awsErr( createErr ) }; }
        }
        return { ok: false, error: awsErr( err ) };
    }
}

/** Stamp the `configured` tag on a secret (best-effort — a tagging failure doesn't fail the save; the value
 *  is already written). Uses the ARN/name the save used. */
async function markConfigured( secretId : string ) : Promise<void>
{
    try { await secretsClient().send( new TagResourceCommand( { SecretId: secretId, Tags: [ { Key: CONFIGURED_TAG, Value: "true" } ] } ) ); }
    catch { /* tagging is advisory — the value save already succeeded */ }
}

/** Delete a secret entirely, so a reader treats it as UNSET (e.g. a provider with no key is dropped from the
 *  app). Secrets Manager REJECTS an empty SecretString ("must provide either SecretString or SecretBinary"),
 *  so "clear" = delete. Force-deletes (no recovery window) so it's immediate + the name is reusable — for a
 *  CDK-provisioned secret, re-running the deploy recreates the empty shell. LocalStack only. */
export async function secretClear( secretId : string ) : Promise<SecretSaveResult>
{
    if( isReadOnly() ) return { ok: false, error: "Secrets are read-only against a real AWS target — edit in the AWS console." };
    try
    {
        await secretsClient().send( new DeleteSecretCommand( { SecretId: secretId, ForceDeleteWithoutRecovery: true } ) );
        return { ok: true };
    }
    catch( err ) { return { ok: false, error: awsErr( err ) }; }
}
