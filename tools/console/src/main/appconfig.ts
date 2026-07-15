import {
    ListApplicationsCommand, type Application,
    ListConfigurationProfilesCommand, type ConfigurationProfileSummary,
    ListEnvironmentsCommand, type Environment,
    ListHostedConfigurationVersionsCommand, type HostedConfigurationVersionSummary,
    GetHostedConfigurationVersionCommand,
    CreateHostedConfigurationVersionCommand,
    StartDeploymentCommand
} from "@aws-sdk/client-appconfig";

import { appConfigClient, awsErr, isReadOnly } from "./aws";
import type { ConfigContent, ConfigSaveResult, ServiceConfigTree } from "../shared/types";

//
// AppConfig viewer/editor for the Config tab. A service maps to an AppConfig **application** (named
// `spec.application ?? service` in the manifest → the CDK CfnApplication name), which holds one
// configuration **profile** per sub-config ("settings" = the service config, "web", "flags", an
// "sms-provider" profile, …). Each profile has hosted JSON versions deployed to an **environment**
// (default "default"). This reads the latest hosted version to edit, and Save creates a new hosted
// version + deploys it (AllAtOnce) — the same path the service's own ensureSeeded uses.
//
// Targets LocalStack or real AWS via the shared aws.ts client (same target switch as Monitor). Real
// AWS is READ-ONLY here (mutating prod config from the console is a foot-gun) — Save is refused.
//

const STRATEGY : string = "AppConfig.AllAtOnce";   // predefined immediate deployment strategy

///////////////////////////////////////////////////////////////////////////////////////////////////
/** Find the AppConfig application whose name matches the service id (paginates list-applications). */
async function findApplication( service : string ) : Promise<Application | undefined>
{
    let token : string | undefined;
    do
    {
        const page = await appConfigClient().send( new ListApplicationsCommand( { NextToken: token, MaxResults: 50 } ) );
        const hit : Application | undefined = ( page.Items ?? [] ).find( ( application : Application ) => application.Name === service );
        if ( hit ) return hit;
        // follow the pagination cursor until AWS stops returning one
        token = page.NextToken;
    }
    while ( token );
    return undefined;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** The config tree for a service: its application id + the profiles (sub-configs) and environments. */
export async function configProfiles( service : string ) : Promise<ServiceConfigTree>
{
    try
    {
        const app : Application | undefined = await findApplication( service );
        if ( !app || !app.Id )
            return { environments: [], profiles: [], error: `No AppConfig application named "${service}" — deploy the service (its config profiles are created by the /cloud build).` };

        const client = appConfigClient();

        // collect every configuration profile (sub-config) across all pages
        const profiles : ServiceConfigTree[ "profiles" ] = [];
        let profileToken : string | undefined;
        do
        {
            const page = await client.send( new ListConfigurationProfilesCommand( { ApplicationId: app.Id, NextToken: profileToken, MaxResults: 50 } ) );
            ( page.Items ?? [] ).forEach( ( profile : ConfigurationProfileSummary ) =>
                profiles.push( { id: profile.Id ?? "", name: profile.Name ?? "(unnamed)", type: profile.Type ?? "AWS.Freeform" } ) );
            profileToken = page.NextToken;
        }
        while ( profileToken );

        // collect every environment across all pages
        const environments : ServiceConfigTree[ "environments" ] = [];
        let environmentToken : string | undefined;
        do
        {
            const page = await client.send( new ListEnvironmentsCommand( { ApplicationId: app.Id, NextToken: environmentToken, MaxResults: 50 } ) );
            ( page.Items ?? [] ).forEach( ( environment : Environment ) =>
                environments.push( { id: environment.Id ?? "", name: environment.Name ?? "(unnamed)", state: environment.State } ) );
            environmentToken = page.NextToken;
        }
        while ( environmentToken );

        profiles.sort( ( first, second ) => first.name.localeCompare( second.name ) );
        environments.sort( ( first, second ) => first.name.localeCompare( second.name ) );

        return { applicationId: app.Id, applicationName: app.Name, environments, profiles };
    }
    catch ( err )
    {
        return { environments: [], profiles: [], error: awsErr( err ) };
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** Latest hosted version content for a profile (the JSON to edit). Empty profile → empty content. */
export async function configGet( applicationId : string, profileId : string ) : Promise<ConfigContent>
{
    try
    {
        const client = appConfigClient();

        // newest version = highest VersionNumber across all pages
        let latest : HostedConfigurationVersionSummary | undefined;
        let token : string | undefined;
        do
        {
            const page = await client.send( new ListHostedConfigurationVersionsCommand( { ApplicationId: applicationId, ConfigurationProfileId: profileId, NextToken: token, MaxResults: 50 } ) );
            ( page.Items ?? [] ).forEach( ( version : HostedConfigurationVersionSummary ) =>
            {
                if ( latest === undefined || ( version.VersionNumber ?? 0 ) > ( latest.VersionNumber ?? 0 ) ) latest = version;
            } );
            token = page.NextToken;
        }
        while ( token );

        if ( !latest || latest.VersionNumber === undefined )
            return { content: "", contentType: "application/json" };   // never seeded — start blank

        const got = await client.send( new GetHostedConfigurationVersionCommand( {
            ApplicationId          : applicationId,
            ConfigurationProfileId : profileId,
            VersionNumber          : latest.VersionNumber
        } ) );

        const bytes : Uint8Array = got.Content ?? new Uint8Array();
        const content : string = Buffer.from( bytes ).toString( "utf-8" );
        return { content, version: latest.VersionNumber, contentType: got.ContentType ?? "application/json" };
    }
    catch ( err )
    {
        return { content: "", contentType: "application/json", error: awsErr( err ) };
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** Create a new hosted version from `content` and deploy it (AllAtOnce) to `environmentId`. */
export async function configSave( applicationId : string, profileId : string, environmentId : string, content : string, contentType : string ) : Promise<ConfigSaveResult>
{
    if ( isReadOnly() )
        return { ok: false, error: "Read-only on a real AWS account — switch the target to LocalStack to edit config." };

    // catch malformed JSON before writing a version
    if ( contentType.includes( "json" ) )
    {
        try { JSON.parse( content ); }
        catch ( err ) { return { ok: false, error: `Invalid JSON: ${( err as Error ).message}` }; }
    }

    try
    {
        const client = appConfigClient();

        const created = await client.send( new CreateHostedConfigurationVersionCommand( {
            ApplicationId          : applicationId,
            ConfigurationProfileId : profileId,
            Content                : Buffer.from( content, "utf-8" ),
            ContentType            : contentType || "application/json"
        } ) );
        if ( created.VersionNumber === undefined ) return { ok: false, error: "AppConfig did not return a version number" };

        const deployed = await client.send( new StartDeploymentCommand( {
            ApplicationId          : applicationId,
            EnvironmentId          : environmentId,
            ConfigurationProfileId : profileId,
            ConfigurationVersion   : String( created.VersionNumber ),
            DeploymentStrategyId   : STRATEGY,
            Description            : "edited via console"
        } ) );

        return { ok: true, version: created.VersionNumber, deployment: deployed.DeploymentNumber };
    }
    catch ( err )
    {
        return { ok: false, error: awsErr( err ) };
    }
}
