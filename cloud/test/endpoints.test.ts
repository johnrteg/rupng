//
// Unit tests for the RestfulEndpoint -> ApiEndpointSpec adapter (pure mapping; no CDK).
//
import { apiEndpoints } from '../lib/endpoints';
import { ApiEndpointSpec } from '@repo/cloud-spec';
import { GetHealth, PostLogin } from '@repo/api';
import { RestfulEndpoint, Access } from '@repo/endpoint';
import { Network } from '@repo/common';

describe('apiEndpoints', () => {

    test('maps each endpoint to a spec (public, unauthenticated samples)', () => {
        const specs : Array<ApiEndpointSpec> = apiEndpoints( [ new GetHealth(), new PostLogin() ] );
        expect( specs ).toHaveLength( 2 );

        const health = specs.find( s => s.path === '/health' );
        expect( health ).toBeDefined();
        expect( health!.method ).toBe( 'GET' );
        expect( health!.public ).toBe( true );          // exposure PUBLIC
        expect( health!.authRequired ).toBe( false );    // access undefined
        expect( health!.minRole ).toBeUndefined();
    });

    test('a POST sample maps to method POST', () => {
        const specs : Array<ApiEndpointSpec> = apiEndpoints( [ new PostLogin() ] );
        expect( specs[0].method ).toBe( 'POST' );
        expect( specs[0].public ).toBe( true );
    });

    test('an internal, access-gated endpoint -> not public, authRequired, minRole set', () => {
        // toRoutes only reads method/uri/exposure/access — a minimal stand-in suffices.
        const secure = {
            method   : Network.Method.GET,
            uri      : '/secure',
            exposure : RestfulEndpoint.Exposure.INTERNAL,
            access   : Access.AccountRole.USER,
        } as unknown as RestfulEndpoint;

        const [ spec ] : Array<ApiEndpointSpec> = apiEndpoints( [ secure ] );
        expect( spec.path ).toBe( '/secure' );
        expect( spec.public ).toBe( false );             // INTERNAL -> not edge-exposed
        expect( spec.authRequired ).toBe( true );        // access defined
        expect( spec.minRole ).toBe( 'user' );           // Access.AccountRole.USER
    });
});
