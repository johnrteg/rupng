//
import { describe, test, expect } from 'vitest';

import { PublicApi } from '../docs/PublicApi';
import { RestfulEndpoint } from '@repo/endpoint';

//
// Self-documentation guard for the published developer API. Every PUBLIC endpoint in the registry MUST be
// fully documented — a summary, at least one tag, and a success-response schema — or the OpenAPI docs ship
// with holes. This asserts against the GENERATED document (the real artifact the docs + readme.io consume),
// so it also proves the generator wiring works end-to-end.
//
describe( 'PublicApi — published API is self-documented', () =>
{
    const document : RestfulEndpoint.OpenApi.Document = PublicApi.document();

    // flatten the document into one operation per (path, method) for per-operation assertions
    const operations : Array<{ id : string; op : Record<string, unknown> }> = [];
    for( const [ path, methods ] of Object.entries( document.paths ) )
        for( const [ method, op ] of Object.entries( methods ) )
            operations.push( { id: `${ method.toUpperCase() } ${ path }`, op: op as Record<string, unknown> } );

    test( 'the document is OpenAPI 3.1 with info + a bearer security scheme', () =>
    {
        expect( document.openapi ).toBe( '3.1.0' );
        expect( document.info.title ).toBeTruthy();
        expect( document.info.version ).toBeTruthy();
        expect( ( document.components?.securitySchemes as Record<string, unknown> )?.bearer ).toBeTruthy();
    } );

    test( 'at least one endpoint is published', () =>
    {
        expect( operations.length ).toBeGreaterThan( 0 );
    } );

    test.each( PublicApi.endpoints().map( ( endpoint : RestfulEndpoint ) => [ endpoint.constructor.name, endpoint ] as const ) )(
        '%s has docs (summary + tags) and a response schema',
        ( _name : string, endpoint : RestfulEndpoint ) =>
        {
            // audience must actually be PUBLIC (else it silently drops out of the generated doc)
            expect( endpoint.audience ).toBe( RestfulEndpoint.Audience.PUBLIC );
            expect( endpoint.docs?.summary, 'docs.summary is required on a PUBLIC endpoint' ).toBeTruthy();
            expect( ( endpoint.docs?.tags?.length ?? 0 ), 'docs.tags must have at least one tag' ).toBeGreaterThan( 0 );
            // the documented 200 body (from getResponseSchema) is asserted per-operation below
        },
    );

    test.each( operations.map( ( entry ) => [ entry.id, entry.op ] as const ) )(
        'operation %s documents summary, tags, and a 200 response body',
        ( _id : string, op : Record<string, unknown> ) =>
        {
            expect( op.summary ).toBeTruthy();
            expect( Array.isArray( op.tags ) && ( op.tags as Array<unknown> ).length > 0 ).toBe( true );
            const responses : Record<string, { content? : unknown }> = op.responses as Record<string, { content? : unknown }>;
            expect( responses?.[ '200' ]?.content, 'a 200 response body schema (getResponseSchema) is required' ).toBeTruthy();
        },
    );
} );
