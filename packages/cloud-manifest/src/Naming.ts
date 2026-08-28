//
// Naming conventions shared by BOTH sides so they can never drift:
//   - the /cloud CDK app uses them to NAME resources and PUBLISH identifiers
//   - services use them (via CloudResolver) to RESOLVE identifiers at runtime
//

import { Environment } from "./Environment";
import { ResourceKind, ResourceKey } from "./Common";

/** Physical resource name, e.g. "prod-contact-queue-import". */
export function physicalName( env : Environment, service : string, kind : ResourceKind, key : ResourceKey ) : string
{
    return [ env, service, kind, key ].join( "-" );
}

/** SSM Parameter Store path the CDK app publishes a resource identifier to. */
export function ssmPath( env : Environment, service : string, kind : ResourceKind, key : ResourceKey ) : string
{
    return [ "", env, service, kind, key ].join( "/" );   // leading "/"
}

/**
 * Environment-variable name the CDK app injects into a service's compute and the
 * CloudResolver reads back. e.g. ("queue","import") -> "QUEUE_IMPORT".
 */
export function envVarName( kind : ResourceKind, key : ResourceKey ) : string
{
    return [ kind, key ].join( "_" ).replace( /[^A-Za-z0-9]+/g, "_" ).toUpperCase();
}

/**
 * Environment-variable name for a `uses: [{ kind: SERVICE, ... }]` reference's internal ALB URL —
 * e.g. "marketplace" -> "MARKETPLACE_INTERNAL_URL". Scoped by the FOREIGN service name (not this
 * service's own resource keys, unlike `envVarName`), since a service may `use` several siblings.
 */
export function internalUrlEnvVar( service : string ) : string
{
    return `${ service.replace( /[^A-Za-z0-9]+/g, "_" ).toUpperCase() }_INTERNAL_URL`;
}
