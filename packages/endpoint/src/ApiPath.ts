//
// Canonical public API path: /api/{service}/v{version}/{resource}.
//
// Versioned PER ENDPOINT, so /api/auth/v1/foo and /api/auth/v2/foo can coexist (a breaking change to
// one endpoint bumps only that endpoint, not the whole service). This is the SINGLE composition point:
// an endpoint sets its `uri` from here, so the web client (marshalClient), the server (route mount),
// and the /cloud gateway generator (RestfulEndpoint.toRoutes) all derive the SAME path — they can't
// drift. The edge (CloudFront / webproxy) routes everything under /api/{service} to that service.
//
// NOT for /health or /version: those stay at the container root — the ALB health check hits the
// container directly (bypassing the edge), and the deploy console probes /version per gateway.
//
export function apiPath( service : string, version : number, resource : string ) : string
{
    const res : string = resource.startsWith( "/" ) ? resource : `/${resource}`;
    return `/api/${service}/v${version}${res}`;
}

export default apiPath;
