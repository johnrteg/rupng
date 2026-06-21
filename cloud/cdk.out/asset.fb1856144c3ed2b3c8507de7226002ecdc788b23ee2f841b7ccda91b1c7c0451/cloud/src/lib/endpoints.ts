//
// Adapter: RestfulEndpoint route metadata -> cloud-manifest ApiEndpointSpec.
//
// This is where the two worlds meet — @repo/endpoint (the endpoint definitions shared
// by web + server) and @repo/cloud-manifest (the infra manifest the API Gateway is built
// from). Keeping it here keeps both of those packages free of each other.
//
import { RestfulEndpoint, Access } from "@repo/endpoint";
import { ApiEndpointSpec } from "@repo/cloud-manifest";

/**
 * Map endpoint definitions to ApiEndpointSpec[]. Pass the service's endpoint instances:
 *
 *   apiEndpoints( [ new GetHealth(), new PostLogin() ] )
 *
 * Exposure -> `public`, access -> `minRole`. The result feeds ApiSpec.endpoints, so the
 * gateway routes derive from the very same definitions the client and server use.
 */
export function apiEndpoints( endpoints : Array<RestfulEndpoint> ) : Array<ApiEndpointSpec>
{
    const routes : Array<RestfulEndpoint.RouteInfo> = RestfulEndpoint.toRoutes( endpoints );
    return routes.map( ( r : RestfulEndpoint.RouteInfo ) : ApiEndpointSpec => ( {
        method       : String( r.method ),
        path         : r.uri,
        public       : r.exposure === RestfulEndpoint.Exposure.PUBLIC,
        authRequired : r.access !== undefined,
        minRole      : ( r.access !== undefined ) ? String( r.access as Access.Role ) : undefined,
    } ) );
}
