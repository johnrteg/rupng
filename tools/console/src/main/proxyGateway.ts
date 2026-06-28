import { GetApisCommand, GetRoutesCommand } from "@aws-sdk/client-apigatewayv2";

import { apigwClient, awsErr, getTarget } from "./aws";

//
// Discover the API Gateway "inside" target for each route prefix — so the Proxy board can offer
// Inside routing to deployed services. For every HTTP API we read its routes, derive the top-level
// path prefix (e.g. "/app"), and map it to that API's invoke URL. Target-aware: LocalStack builds the
// execute-api edge URL; a real AWS profile uses the reported ApiEndpoint.
//

/**
 * Route key → the SERVICE-level path prefix the edge routes on (never per-endpoint):
 *   "GET /api/app/v1/bootstrap" → "/api/app"   (versioned API: /api/{service})
 *   "POST /api/auth/v1/login"   → "/api/auth"
 *   "GET /health" / "/version"  → "/health" / "/version"  (root ops endpoints, legacy single-segment)
 *   "$default" / "/"            → undefined
 * Deriving /api/{service} (not /api) keeps each service's prefix distinct, and stays at the service
 * level so the version + endpoint segments never enter the proxy — splitting a service into more
 * roles can't change the prefix.
 */
function prefixOf( routeKey : string ) : string | undefined
{
    const parts : string[] = routeKey.trim().split( /\s+/ );
    const path : string = parts.length > 1 ? parts[ 1 ] : parts[ 0 ];
    if ( !path.startsWith( "/" ) ) return undefined;
    const segs : string[] = path.split( "/" ).filter( Boolean );   // ["api","app","v1","bootstrap"]
    if ( segs.length === 0 ) return undefined;
    if ( segs[ 0 ] === "api" && segs.length >= 2 ) return `/api/${segs[ 1 ]}`;   // /api/{service}
    return `/${segs[ 0 ]}`;
}

/** prefix (e.g. "/app") → gateway invoke URL for the API that serves it. */
export async function gatewayTargets() : Promise<{ prefixes : Record<string, string>; error? : string }>
{
    const local : boolean = getTarget().kind === "localstack";
    const prefixes : Record<string, string> = {};
    try
    {
        const gw = apigwClient();
        const { Items: apis = [] } = await gw.send( new GetApisCommand( {} ) );
        for ( const a of apis )
        {
            const apiId : string = a.ApiId ?? "";
            if ( !apiId ) continue;
            const url : string = local
                ? `http://${apiId}.execute-api.localhost.localstack.cloud:4566`
                : ( a.ApiEndpoint ?? "" );
            if ( !url ) continue;

            const { Items: routes = [] } = await gw.send( new GetRoutesCommand( { ApiId: apiId } ) );
            for ( const r of routes )
            {
                const p : string | undefined = r.RouteKey ? prefixOf( r.RouteKey ) : undefined;
                if ( p ) prefixes[ p ] = url;
            }
        }
        return { prefixes };
    }
    catch ( err ) { return { prefixes, error: awsErr( err ) }; }
}
