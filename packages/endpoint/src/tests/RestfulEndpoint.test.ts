//
import { NetworkUtils } from '@repo/common';
import { Schema } from 'ajv';
import { RestfulEndpoint } from '../RestfulEndpoint';
import Access from '../Access';

//
// Concrete test endpoints. The validator cache is keyed by the concrete subclass, so each
// distinct schema shape needs its own class (reusing one class with varying schemas would
// poison the cache).
//

// GET /sample/:id  — single required URI param, no body.
class GetByIdEndpoint extends RestfulEndpoint<{ id: string }, undefined>
{
  public readonly uri     : string = '/sample/:id';
  public readonly method  : NetworkUtils.Method = NetworkUtils.Method.GET;
  public readonly access  : Access.Role | undefined = Access.AccountRole.USER;
  public readonly timeout : number | undefined = undefined;

  constructor(query: { id: string }) { super(query, undefined); }

  public getMappings(): Array<RestfulEndpoint.FieldMap>
  {
    return [{ field: 'id', location: RestfulEndpoint.AttrLocation.URI }];
  }
  public getQuerySchema(): Schema | null
  {
    return { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false };
  }
  public getBodySchema(): Schema | null { return null; }
}

// POST /sample/:id  — URI param plus a required JSON body.
class PostEndpoint extends RestfulEndpoint<{ id: string }, { color: string; count: number }>
{
  public readonly uri     : string = '/sample/:id';
  public readonly method  : NetworkUtils.Method = NetworkUtils.Method.POST;
  public readonly access  : Access.Role | undefined = Access.AccountRole.USER;
  public readonly timeout : number | undefined = undefined;

  constructor(query: { id: string }, body?: { color: string; count: number }) { super(query, body); }

  public getMappings(): Array<RestfulEndpoint.FieldMap>
  {
    return [{ field: 'id', location: RestfulEndpoint.AttrLocation.URI }];
  }
  public getQuerySchema(): Schema | null
  {
    return { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false };
  }
  public getBodySchema(): Schema | null
  {
    return {
      type: 'object',
      properties: { color: { type: 'string' }, count: { type: 'number' } },
      required: ['color', 'count'],
      additionalProperties: false
    };
  }
}

// GET /n?n=...  — numeric query param, used to exercise coercion.
class NumQueryEndpoint extends RestfulEndpoint<{ n: number }, undefined>
{
  public readonly uri     : string = '/n';
  public readonly method  : NetworkUtils.Method = NetworkUtils.Method.GET;
  public readonly access  : Access.Role | undefined = Access.AccountRole.USER;
  public readonly timeout : number | undefined = undefined;

  constructor(query: any) { super(query, undefined); }

  public getMappings(): Array<RestfulEndpoint.FieldMap>
  {
    return [{ field: 'n', location: RestfulEndpoint.AttrLocation.QUERY_PARAM }];
  }
  public getQuerySchema(): Schema | null
  {
    return { type: 'object', properties: { n: { type: 'number' } }, required: ['n'], additionalProperties: false };
  }
  public getBodySchema(): Schema | null { return null; }
}

// GET /users/:id?  — optional URI param.
class OptionalEndpoint extends RestfulEndpoint<{ id?: string }, undefined>
{
  public readonly uri     : string = '/users/:id?';
  public readonly method  : NetworkUtils.Method = NetworkUtils.Method.GET;
  public readonly access  : Access.Role | undefined = Access.AccountRole.USER;
  public readonly timeout : number | undefined = undefined;

  constructor(query: { id?: string }) { super(query, undefined); }

  public getMappings(): Array<RestfulEndpoint.FieldMap>
  {
    return [{ field: 'id', location: RestfulEndpoint.AttrLocation.URI }];
  }
  public getQuerySchema(): Schema | null
  {
    return { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false };
  }
  public getBodySchema(): Schema | null { return null; }
}

// GET /u/:a/:b  — multiple required URI params.
class MultiParamEndpoint extends RestfulEndpoint<{ a: string; b: string }, undefined>
{
  public readonly uri     : string = '/u/:a/:b';
  public readonly method  : NetworkUtils.Method = NetworkUtils.Method.GET;
  public readonly access  : Access.Role | undefined = Access.AccountRole.USER;
  public readonly timeout : number | undefined = undefined;

  constructor(query: { a: string; b: string }) { super(query, undefined); }

  public getMappings(): Array<RestfulEndpoint.FieldMap>
  {
    return [
      { field: 'a', location: RestfulEndpoint.AttrLocation.URI },
      { field: 'b', location: RestfulEndpoint.AttrLocation.URI }
    ];
  }
  public getQuerySchema(): Schema | null
  {
    return {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a', 'b'],
      additionalProperties: false
    };
  }
  public getBodySchema(): Schema | null { return null; }
}

// GET /h  — value carried in a (mixed-case) header.
class HeaderEndpoint extends RestfulEndpoint<{ SessionId: string }, undefined>
{
  public readonly uri     : string = '/h';
  public readonly method  : NetworkUtils.Method = NetworkUtils.Method.GET;
  public readonly access  : Access.Role | undefined = Access.AccountRole.USER;
  public readonly timeout : number | undefined = undefined;

  constructor(query: { SessionId: string }) { super(query, undefined); }

  public getMappings(): Array<RestfulEndpoint.FieldMap>
  {
    return [{ field: 'SessionId', location: RestfulEndpoint.AttrLocation.HEADER }];
  }
  public getQuerySchema(): Schema | null
  {
    return { type: 'object', properties: { SessionId: { type: 'string' } }, required: ['SessionId'], additionalProperties: false };
  }
  public getBodySchema(): Schema | null { return null; }
}

// GET /search?q=...  — single query-string param.
class QueryParamEndpoint extends RestfulEndpoint<{ q: string }, undefined>
{
  public readonly uri     : string = '/search';
  public readonly method  : NetworkUtils.Method = NetworkUtils.Method.GET;
  public readonly access  : Access.Role | undefined = Access.AccountRole.USER;
  public readonly timeout : number | undefined = undefined;

  constructor(query: { q: string }) { super(query, undefined); }

  public getMappings(): Array<RestfulEndpoint.FieldMap>
  {
    return [{ field: 'q', location: RestfulEndpoint.AttrLocation.QUERY_PARAM }];
  }
  public getQuerySchema(): Schema | null
  {
    return { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false };
  }
  public getBodySchema(): Schema | null { return null; }
}

// GET /thing/  — no params, trailing slash that should be stripped.
class TrailingSlashEndpoint extends RestfulEndpoint<{}, undefined>
{
  public readonly uri     : string = '/thing/';
  public readonly method  : NetworkUtils.Method = NetworkUtils.Method.GET;
  public readonly access  : Access.Role | undefined = Access.AccountRole.USER;
  public readonly timeout : number | undefined = undefined;

  constructor() { super({}, undefined); }

  public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
  public getQuerySchema(): Schema | null { return { type: 'object', additionalProperties: false }; }
  public getBodySchema(): Schema | null { return null; }
}

describe('parseUriParams Utility', () => {
  
  it('should extract dynamic route parameters correctly', () =>
  {
    const pattern = '/users/:id/books/:bookId';
    const path = '/users/99/books/programming-101';
    
    const result : Record<string, string> = RestfulEndpoint.parseUriParams(pattern, path);
    //console.log( result );
    
    // Asserts that the output perfectly matches our expectations
    expect(result).toEqual({ 
      id: '99', 
      bookId: 'programming-101' 
    });
  });

  it('should strip away query strings before parsing parameters', () =>
  {
    const pattern = '/posts/:postId';
    const path = '/posts/456?utm_source=twitter&theme=dark';
    
    const result : Record<string, string> = RestfulEndpoint.parseUriParams(pattern, path);
    //console.log( result );
    
    expect(result).toEqual({ 
      postId: '456' 
    });
  });

  it('should return an empty object if the path length does not match the pattern', () =>
  {
    const pattern = '/users/:id/settings';
    const path = '/users/123'; // Missing the '/settings' segment
    
    const result : Record<string, string> = RestfulEndpoint.parseUriParams(pattern, path);
    console.log( result );
    
    expect(result).toEqual({});
  });

  // new tests
  it('returns empty object for pattern without params', () =>
  {
    const pattern = '/about';
    const path = '/about';
    const result : Record<string, string> = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({});
  });

  it('handles trailing slashes consistently', () =>
  {
    const pattern = '/users/:id/';
    const path = '/users/123/';
    const result : Record<string, string> = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({ id: '123' });
  });

  it('decodes percent-encoded parameter values', () =>
  {
    const pattern = '/search/:term';
    const path = '/search/hello%20world';
    const result : Record<string, string> = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({ term: 'hello world' });
  });

  it('strips query string and hash before parsing', () =>
  {
    const pattern = '/posts/:postId';
    const path = '/posts/456?utm=1#section';
    const result : Record<string, string> = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({ postId: '456' });
  });

  it('returns empty object when path has extra segments', () =>
  {
    const pattern = '/users/:id';
    const path = '/users/123/extra';
    const result : Record<string, string> = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({});
  });

  // optional parameter tests
  it('handles an optional parameter when present', () =>
  {
    const pattern = '/users/:id?';
    const path = '/users/123';
    const result: Record<string,string> = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({ id: '123' });
  });

  it('handles an optional parameter when missing', () =>
  {
    const pattern = '/users/:id?';
    const path = '/users';
    const result: Record<string,string> = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({});
  });

  it('handles an optional parameter in the middle of the pattern', () =>
  {
    const pattern = '/:lang?/about';
    const pathA = '/about';
    const pathB = '/en/about';
    expect(RestfulEndpoint.parseUriParams(pattern, pathA)).toEqual({});
    expect(RestfulEndpoint.parseUriParams(pattern, pathB)).toEqual({ lang: 'en' });
  });

  it('handles multiple optional parameters', () =>
  {
    const pattern = '/items/:category?/:id?';
    expect(RestfulEndpoint.parseUriParams(pattern, '/items')).toEqual({});
    expect(RestfulEndpoint.parseUriParams(pattern, '/items/books')).toEqual({ category: 'books' });
    expect(RestfulEndpoint.parseUriParams(pattern, '/items/books/123')).toEqual({ category: 'books', id: '123' });
  });

  it('captures comma-separated values as a single param string', () =>
  {
    const pattern = '/items/:ids';
    const path = '/items/1213,456';
    const result: Record<string,string> = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({ ids: '1213,456' });
  });

  it('can be split into an array by the test (comma-separated)', () =>
  {
    const pattern = '/items/:ids';
    const path = '/items/1213,456';
    const result: Record<string,string> = RestfulEndpoint.parseUriParams(pattern, path);
    const idsArray = result.ids ? result.ids.split(',') : [];
    expect(idsArray).toEqual(['1213', '456']);
  });

  // additional edge-case tests
  it('decodes percent-encoded slash inside a segment (does not split)', () =>
  {
    const pattern = '/files/:name';
    const path = '/files/a%2Fb';
    const result = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({ name: 'a/b' });
  });

  it('treats plus sign as literal in path segment', () =>
  {
    const pattern = '/q/:term';
    const path = '/q/hello+world';
    const result = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({ term: 'hello+world' });
  });

  it('ignores duplicate slashes in the path', () =>
  {
    const pattern = '/users/:id';
    const path = '//users//123//';
    const result = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({ id: '123' });
  });

  it('static segments are case-sensitive', () =>
  {
    const pattern = '/Users/:id';
    const path = '/users/123';
    const result = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({}); // mismatch due to case
  });

  it('duplicate parameter names: last occurrence wins', () =>
  {
    const pattern = '/:id/:id';
    const path = '/a/b';
    const result = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({ id: 'b' });
  });

  it('matches the root path "/"', () =>
  {
    const pattern = '/';
    const path = '/';
    const result = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({});
  });

  it('preserves unicode characters in parameters', () =>
  {
    const pattern = '/emoji/:ch';
    const path = '/emoji/😊';
    const result = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({ ch: '😊' });
  });

  it('preserves leading zeros and numeric-looking values', () =>
  {
    const pattern = '/items/:id';
    const path = '/items/00123';
    const result = RestfulEndpoint.parseUriParams(pattern, path);
    expect(result).toEqual({ id: '00123' });
  });

  it('accepts hex-like param values', () =>
  {
    const pattern = '/v/:hex';
    const path = '/v/0xdeadbeef';
    expect(RestfulEndpoint.parseUriParams(pattern, path)).toEqual({ hex: '0xdeadbeef' });
  });

  it('accepts base64-like values', () =>
  {
    const pattern = '/data/:b';
    const path = '/data/aGVsbG8=';
    expect(RestfulEndpoint.parseUriParams(pattern, path)).toEqual({ b: 'aGVsbG8=' });
  });

  it('decodes percent-encoded NUL (%00) inside a segment', () =>
  {
    const pattern = '/x/:s';
    const path = '/x/hello%00world';
    const r = RestfulEndpoint.parseUriParams(pattern, path);
    expect(r.s).toBeDefined();
    expect(r.s).toContain('hello');
    expect(r.s).toContain('world');
    // explicit check for embedded NUL
    expect(r.s).toEqual('hello\u0000world');
  });

  it('returns the decoded traversal string (watch for security implications)', () =>
  {
    const pattern = '/files/:name';
    const path = '/files/..%2Fetc%2Fpasswd';
    // parser will decode %2F -> '/', producing "../etc/passwd"
    expect(RestfulEndpoint.parseUriParams(pattern, path)).toEqual({ name: '../etc/passwd' });
  });

  it('handles very long parameter values', () =>
  {
    const long = 'a'.repeat(5000);
    const pattern = '/items/:id';
    const path = `/items/${long}`;
    expect(RestfulEndpoint.parseUriParams(pattern, path)).toEqual({ id: long });
  });

  it('preserves reserved characters in segments (unless percent-encoded)', () =>
  {
    const pattern = '/r/:p';
    const path = '/r/;:@&=+$,';
    expect(RestfulEndpoint.parseUriParams(pattern, path)).toEqual({ p: ';:@&=+$,' });
  });

});


describe('validate', () => {

  it('passes a valid query', () =>
  {
    expect(new GetByIdEndpoint({ id: 'abc' }).validate()).toEqual({ valid: true });
  });

  it('fails an invalid query and labels the error', () =>
  {
    const result = new GetByIdEndpoint({} as any).validate();
    expect(result.valid).toBe(false);
    expect(result.errors?.some(e => e.startsWith('Query:'))).toBe(true);
  });

  it('fails when a required body is missing (non-null body schema)', () =>
  {
    const result = new PostEndpoint({ id: '1' }).validate(); // body omitted -> null
    expect(result.valid).toBe(false);
    expect(result.errors?.some(e => e.startsWith('Body:'))).toBe(true);
  });

  it('passes a valid body', () =>
  {
    expect(new PostEndpoint({ id: '1' }, { color: 'red', count: 2 }).validate()).toEqual({ valid: true });
  });

  it('fails an invalid body and labels the error', () =>
  {
    const result = new PostEndpoint({ id: '1' }, { color: 'red' } as any).validate();
    expect(result.valid).toBe(false);
    expect(result.errors?.some(e => e.startsWith('Body:'))).toBe(true);
  });

  it('treats a null body schema as "no body required"', () =>
  {
    // GetByIdEndpoint.getBodySchema() returns null and the body is null -> still valid.
    expect(new GetByIdEndpoint({ id: 'x' }).validate()).toEqual({ valid: true });
  });

  it('coerces query param types and mutates this.query', () =>
  {
    const ep = new NumQueryEndpoint({ n: '5' });
    expect(ep.validate()).toEqual({ valid: true });
    expect(ep.query.n).toBe(5);
    expect(typeof ep.query.n).toBe('number');
  });

  it('does NOT coerce body types (string where number expected fails)', () =>
  {
    const ep = new PostEndpoint({ id: '1' }, { color: 'red', count: '2' as any });
    const result = ep.validate();
    expect(result.valid).toBe(false);
    expect(ep.body?.count).toBe('2'); // left untouched, not coerced
  });

  it('keeps validators isolated per endpoint class', () =>
  {
    // Exercises the per-class validator cache: different classes must not share validators.
    expect(new GetByIdEndpoint({ id: 'a' }).validate().valid).toBe(true);
    expect(new NumQueryEndpoint({ n: 'not-a-number' }).validate().valid).toBe(false);
    expect(new GetByIdEndpoint({ id: 'b' }).validate().valid).toBe(true);
  });
});


describe('marshalClient', () => {

  it('substitutes a required URI param', () =>
  {
    expect(new GetByIdEndpoint({ id: '123' }).marshalClient().url).toBe('/sample/123');
  });

  it('substitutes multiple URI params', () =>
  {
    expect(new MultiParamEndpoint({ a: '1', b: '2' }).marshalClient().url).toBe('/u/1/2');
  });

  it('fills an optional URI param when present', () =>
  {
    expect(new OptionalEndpoint({ id: '9' }).marshalClient().url).toBe('/users/9');
  });

  it('drops an optional URI param when absent', () =>
  {
    expect(new OptionalEndpoint({}).marshalClient().url).toBe('/users');
  });

  it('lower-cases header field names', () =>
  {
    const headers = new HeaderEndpoint({ SessionId: 'abc' }).marshalClient().headers;
    expect(headers.sessionid).toBe('abc');
    expect(headers.SessionId).toBeUndefined();
  });

  it('appends query-string params', () =>
  {
    expect(new QueryParamEndpoint({ q: 'hi' }).marshalClient().url).toBe('/search?q=hi');
  });

  it('strips a trailing slash', () =>
  {
    expect(new TrailingSlashEndpoint().marshalClient().url).toBe('/thing');
  });

  it('passes the body through on the transport payload', () =>
  {
    const transport = new PostEndpoint({ id: '1' }, { color: 'red', count: 2 }).marshalClient();
    expect(transport.body).toEqual({ color: 'red', count: 2 });
  });

  it('throws when validation fails', () =>
  {
    expect(() => new GetByIdEndpoint({} as any).marshalClient()).toThrow(/Client Validation Failed/);
  });
});


describe('unmarshalServer', () => {

  it('hydrates the body from the incoming request', () =>
  {
    const ep = new PostEndpoint({} as any);
    ep.unmarshalServer({ headers: {}, query: {}, fullPath: '/sample/123', body: { color: 'red', count: 2 } });
    expect(ep.body).toEqual({ color: 'red', count: 2 });
    expect(ep.query).toEqual({ id: '123' });
  });

  it('extracts a URI param into the query', () =>
  {
    const ep = new GetByIdEndpoint({} as any);
    ep.unmarshalServer({ headers: {}, query: {}, fullPath: '/sample/55', body: undefined });
    expect(ep.query).toEqual({ id: '55' });
  });

  it('extracts a header value (lower-cased lookup)', () =>
  {
    const ep = new HeaderEndpoint({} as any);
    ep.unmarshalServer({ headers: { sessionid: 'abc' }, query: {}, fullPath: '/h', body: undefined });
    expect(ep.query).toEqual({ SessionId: 'abc' });
  });

  it('extracts a query-string param', () =>
  {
    const ep = new QueryParamEndpoint({} as any);
    ep.unmarshalServer({ headers: {}, query: { q: 'hi' }, fullPath: '/search', body: undefined });
    expect(ep.query).toEqual({ q: 'hi' });
  });

  it('throws when hydrated data fails validation', () =>
  {
    const ep = new PostEndpoint({} as any);
    expect(() =>
      ep.unmarshalServer({ headers: {}, query: {}, fullPath: '/sample/1', body: { color: 'red' } })
    ).toThrow(/Server Validation Error/);
  });

  it('skips an absent optional field', () =>
  {
    const ep = new OptionalEndpoint({} as any);
    ep.unmarshalServer({ headers: {}, query: {}, fullPath: '/users', body: undefined });
    expect(ep.query).toEqual({});
  });
});