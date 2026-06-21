import { GetApisCommand, GetRoutesCommand } from "@aws-sdk/client-apigatewayv2";

import { apigwClient, awsErr, getTarget } from "./aws";

//
// Discover the API Gateway "inside" target for each route prefix — so the Proxy board can offer
// Inside routing to deployed services. For every HTTP API we read its routes, derive the top-level
// path prefix (e.g. "/app"), and map it to that API's invoke URL. Target-aware: LocalStack builds the
// execute-api edge URL; a real AWS profile uses the reported ApiEndpoint.
//

/** "GET /app/bootstrap" → "/app"; "$default" / "/" → undefined. */
function prefixOf( routeKey : string ) : string | undefined
{
    const parts : string[] = routeKey.trim().split( /\s+/ );
    const path : string = parts.length > 1 ? parts[ 1 ] : parts[ 0 ];
    if ( !path.startsWith( "/" ) ) return undefined;
    const seg : string = path.split( "/" )[ 1 ] ?? "";
    return seg ? `/${seg}` : undefined;
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
