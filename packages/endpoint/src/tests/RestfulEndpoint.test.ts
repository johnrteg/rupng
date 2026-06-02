//
import { RestfulEndpoint } from '../RestfulEndpoint';

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