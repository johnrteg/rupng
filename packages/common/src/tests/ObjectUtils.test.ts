import ObjectUtils from "../utils/ObjectUtils";

describe('ObjectUtils.parseJSON', () => {
    it('parses a valid JSON string', () => {
        expect(ObjectUtils.parseJSON('{"a":1,"b":2}')).toEqual({ a: 1, b: 2 });
    });

    it('parses a valid JSON array', () => {
        expect(ObjectUtils.parseJSON('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('returns null for invalid JSON', () => {
        expect(ObjectUtils.parseJSON('{a:1,b:2}')).toBeNull();
        expect(ObjectUtils.parseJSON('not json')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(ObjectUtils.parseJSON('')).toBeNull();
    });

    it('returns null for non-string input', () => {
        expect(ObjectUtils.parseJSON(null as any)).toBeNull();
        expect(ObjectUtils.parseJSON(undefined as any)).toBeNull();
        expect(ObjectUtils.parseJSON(123 as any)).toBeNull();
        expect(ObjectUtils.parseJSON({} as any)).toBeNull();
    });

    it('parses JSON with nested objects', () => {
        expect(ObjectUtils.parseJSON('{"x":{"y":10}}')).toEqual({ x: { y: 10 } });
    });
});

describe('ObjectUtils.parseKeyValueString', () => {
  it('parses a simple key:value string', () => {
    expect(ObjectUtils.parseKeyValueString('foo:bar')).toEqual({ foo: 'bar' });
  });

  it('parses multiple key:value pairs', () => {
    expect(ObjectUtils.parseKeyValueString('foo:bar,baz:qux')).toEqual({ foo: 'bar', baz: 'qux' });
  });

  it('trims whitespace around keys and values', () => {
    expect(ObjectUtils.parseKeyValueString(' foo : bar , baz : qux ')).toEqual({ foo: 'bar', baz: 'qux' });
  });

  it('handles empty string', () => {
    expect(ObjectUtils.parseKeyValueString('')).toEqual({});
  });

  it('ignores pairs without a value', () => {
    expect(ObjectUtils.parseKeyValueString('foo:bar,baz')).toEqual({ foo: 'bar' });
  });

  it('handles duplicate keys (last wins)', () => {
    expect(ObjectUtils.parseKeyValueString('foo:bar,foo:baz')).toEqual({ foo: 'baz' });
  });

  it('handles numeric values as strings', () => {
    expect(ObjectUtils.parseKeyValueString('a:1,b:2')).toEqual({ a: '1', b: '2' });
  });
});