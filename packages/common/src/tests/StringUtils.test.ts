import StringUtils from '../utils/StringUtils';

describe('StringUtils', () => {
    test('removeAllSpaces removes all spaces', () => {
        expect(StringUtils.removeAllSpaces('the cat and the hat' )).toBe('thecatandthehat');
        expect(StringUtils.removeAllSpaces('test ')).toBe('test');
        expect(StringUtils.removeAllSpaces(' test')).toBe('test');
        expect(StringUtils.removeAllSpaces('')).toBe('');
    });

    test('leadingZero rpad number with zeros', () => {
        expect(StringUtils.leadingZero( 7, 2 )).toBe('07');
        expect(StringUtils.leadingZero( 0, 1 )).toBe('0');
        expect(StringUtils.leadingZero( 10.45, 3 )).toBe('010.45');
        expect(StringUtils.leadingZero( 45, 4 )).toBe('0045');
        expect(StringUtils.leadingZero( 1000, 4 )).toBe('1000');
        expect(StringUtils.leadingZero( -2, 1 )).toBe('-2');
    });

    test('removeLeading removes all leading occurrences', () => {
        expect(StringUtils.removeLeading('aaabcd', 'a')).toBe('bcd');
        expect(StringUtils.removeLeading('foobarfoo', 'foo')).toBe('barfoo');
        expect(StringUtils.removeLeading('test', 'x')).toBe('test');
        expect(StringUtils.removeLeading('bbbboat', 'b')).toBe('oat');
    });

    test('removeTrailing removes all trailing occurrences', () => {
        expect(StringUtils.removeTrailing('foobarbarbar', 'bar')).toBe('foo');
        expect(StringUtils.removeTrailing('testxxx', 'x')).toBe('test');
        expect(StringUtils.removeTrailing('test', 'y')).toBe('test');
    });

    test('removeAll removes all occurrences of find', () => {
        expect(StringUtils.removeAll('hello world', 'l')).toBe('heo word');
        expect(StringUtils.removeAll('abcabc', 'b')).toBe('acac');
        expect(StringUtils.removeAll('test', '')).toBe('test');
    });

    test('removeAllSpecial replaces non-alphanumeric and dot/hyphen with given char', () => {
        expect(StringUtils.removeAllSpecial('abc!@#123.-', '_')).toBe('abc_123.-');
    });

    test('removeNonAlphaNumeric removes all non-alphanumeric', () => {
        expect(StringUtils.removeNonAlphaNumeric('abc123!@#')).toBe('abc123');
        expect(StringUtils.removeNonAlphaNumeric('!@#')).toBe('');
    });

    test('toPhone strips non-digits and trims to 10 digits', () => {
        expect(StringUtils.toPhoneNumber('(123) 456-7890')).toBe('1234567890');
        expect(StringUtils.toPhoneNumber('1-234-567-8901')).toBe('2345678901');
        expect(StringUtils.toPhoneNumber('')).toBe('');
    });

    test('removeLeading removes leading substring', () => {
    expect(StringUtils.removeLeading('---test', '-')).toBe('test');
    expect(StringUtils.removeLeading('abcabcabc', 'abc')).toBe('');
    expect(StringUtils.removeLeading('test', '')).toBe('test');
});

test('removeTrailing removes trailing substring', () => {
    expect(StringUtils.removeTrailing('test---', '-')).toBe('test');
    expect(StringUtils.removeTrailing('abcabcabc', 'abc')).toBe('');
    expect(StringUtils.removeTrailing('test', '')).toBe('test');
});

test('guid returns a valid UUID v4', () => {
    const uuid = StringUtils.guid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('mask replaces all chars with given char', () => {
    expect(StringUtils.mask('password', '*')).toBe('********');
    expect(StringUtils.mask('abc', 'X')).toBe('XXX');
    expect(StringUtils.mask('', '*')).toBe('');
});

test('toCents converts number to cents string', () => {
    expect(StringUtils.toCents(1)).toBe('100¢');
    expect(StringUtils.toCents(0.25)).toBe('25¢');
    expect(StringUtils.toCents(0)).toBe('0¢');
});

test('format replaces placeholders', () => {
    expect(StringUtils.format('Hello {0}', 'World')).toBe('Hello World');
    expect(StringUtils.format('A {0} B {1}', 'X', 'Y')).toBe('A X B Y');
    expect(StringUtils.format('No placeholders')).toBe('No placeholders');
});

test('countOccurances counts occurrences of values in text', () => {
    expect(StringUtils.countOccurances('hello', 'l')).toBe(2);
    expect(StringUtils.countOccurances('abcabc', 'b')).toBe(2);
    expect(StringUtils.countOccurances('test', '')).toBe(0);
});

test('countUppercase counts uppercase letters', () => {
    expect(StringUtils.countUppercase('AbC')).toBe(2);
    expect(StringUtils.countUppercase('abc')).toBe(0);
    expect(StringUtils.countUppercase('ABC')).toBe(3);
});

test('countLowercase counts lowercase letters', () => {
    expect(StringUtils.countLowercase('AbC')).toBe(1);
    expect(StringUtils.countLowercase('abc')).toBe(3);
    expect(StringUtils.countLowercase('ABC')).toBe(0);
});

test('truncate shortens string and adds ...', () => {
    expect(StringUtils.truncate('abcdefgh', 5)).toBe('ab...');
    expect(StringUtils.truncate('abc', 5)).toBe('abc');
});

// (fileSizeToString moved to ByteUtils.toString — see ByteUtils.test.ts)

test('toMixedCase capitalizes first letter of each word', () => {
    expect(StringUtils.toMixedCase('hello world')).toBe('Hello World');
    expect(StringUtils.toMixedCase('test')).toBe('Test');
});

test('getRelativeTime returns correct relative time string', () => {
    const now = new Date();
    expect(StringUtils.getRelativeTime(new Date(now.getTime() - 500))).toBe('just now');
    expect(StringUtils.getRelativeTime(new Date(now.getTime() - 5000))).toMatch(/second/);
    expect(StringUtils.getRelativeTime(new Date(now.getTime() - 60000))).toMatch(/minute/);
    expect(StringUtils.getRelativeTime(new Date(now.getTime() - 3600000))).toMatch(/hour/);
    expect(StringUtils.getRelativeTime(new Date(now.getTime() - 86400000))).toMatch(/yesterday|day/);
});

describe('StringUtils.humanLabel', () => {
    it('converts snake_case to mixed case words', () => {
        expect(StringUtils.humanLabel('item_count')).toBe('Item Count');
    });

    it('handles single word', () => {
        expect(StringUtils.humanLabel('username')).toBe('Username');
    });

    it('handles multiple underscores', () => {
        expect(StringUtils.humanLabel('user_profile_image')).toBe('User Profile Image');
    });

    it('returns empty string for empty input', () => {
        expect(StringUtils.humanLabel('')).toBe('');
    });

    it('handles already spaced string', () => {
        expect(StringUtils.humanLabel('already spaced')).toBe('Already Spaced');
    });
});

});

describe('StringUtils.countUnicodeChars', () => {
    it('returns 0 for empty string', () => {
        expect(StringUtils.countUnicodeChars('')).toBe(0);
    });

    it('returns 0 for ASCII only', () => {
        expect(StringUtils.countUnicodeChars('Hello123')).toBe(0);
    });

    it('counts accented characters', () => {
        expect(StringUtils.countUnicodeChars('café')).toBe(1); // 'é'
    });

    it('counts multiple non-ASCII characters', () => {
        expect(StringUtils.countUnicodeChars('naïve résumé')).toBe(3); // 'ï', 'é', 'é'
    });

    it('counts emoji', () => {
        expect(StringUtils.countUnicodeChars('👍')).toBe(1);
        expect(StringUtils.countUnicodeChars('A👍B')).toBe(1);
    });

    it('counts mixed ASCII and non-ASCII', () => {
        expect(StringUtils.countUnicodeChars('abcé😊')).toBe(2); // 'é', '😊'
    });

    it('counts CJK characters', () => {
        expect(StringUtils.countUnicodeChars('你好')).toBe(2);
    });

    it('counts surrogate pairs (emoji)', () => {
        expect(StringUtils.countUnicodeChars('😀😃😄')).toBe(3);
    });

    it('returns 0 for null or undefined', () => {
        expect(StringUtils.countUnicodeChars(null as any)).toBe(0);
        expect(StringUtils.countUnicodeChars(undefined as any)).toBe(0);
    });
});

describe('StringUtils.toPhoneNumber', () => {
    it('should strip +1 and non-digit characters, returning 10 digits', () => {
        expect(StringUtils.toPhoneNumber('+1 (858) 335-5006')).toBe('8583355006');
        expect(StringUtils.toPhoneNumber('1-858-335-5006')).toBe('8583355006');
        expect(StringUtils.toPhoneNumber('(858)335-5006')).toBe('8583355006');
        expect(StringUtils.toPhoneNumber('858.335.5006')).toBe('8583355006');
        expect(StringUtils.toPhoneNumber('8583355006')).toBe('8583355006');
        expect(StringUtils.toPhoneNumber('')).toBe('');
        expect(StringUtils.toPhoneNumber('abc')).toBe('');
        expect(StringUtils.toPhoneNumber('+1 (123) 456-7890')).toBe('1234567890');
        expect(StringUtils.toPhoneNumber('12345678901')).toBe('2345678901'); // strips leading 1
        expect(StringUtils.toPhoneNumber('11234567890')).toBe('1234567890'); // strips leading 1
    });

    it('should handle numbers with more than 10 digits by returning last 10 digits', () => {
        expect(StringUtils.toPhoneNumber('0018583355006')).toBe('8583355006');
        expect(StringUtils.toPhoneNumber('123456789012')).toBe('3456789012');
    });
});

describe('StringUtils.enumToString', () => {
    it('converts single word uppercase enum to mixed case', () => {
        expect(StringUtils.enumToString('ACTIVE')).toBe('Active');
        expect(StringUtils.enumToString('INACTIVE')).toBe('Inactive');
    });

    it('converts multi-word uppercase enum with underscores to mixed case', () => {
        expect(StringUtils.enumToString('PRIVATE_PROFIT')).toBe('Private Profit');
        expect(StringUtils.enumToString('NON_PROFIT')).toBe('Non Profit');
        expect(StringUtils.enumToString('VETTED_VERIFIED')).toBe('Vetted Verified');
    });

    it('handles empty string', () => {
        expect(StringUtils.enumToString('')).toBe('');
    });

    it('handles already mixed case input', () => {
        expect(StringUtils.enumToString('AlreadyMixed')).toBe('Alreadymixed');
    });

    it('handles lowercase input', () => {
        expect(StringUtils.enumToString('private_profit')).toBe('Private Profit');
    });

    it('handles single letter enum', () => {
        expect(StringUtils.enumToString('A')).toBe('A');
    });
});

describe('StringUtils.isNameValueList', () => {
  it('returns true for a single name:value pair', () => {
    expect(StringUtils.isNameValueList('foo:bar')).toBe(true);
  });

  it('returns true for multiple name:value pairs', () => {
    expect(StringUtils.isNameValueList('foo:bar,baz:qux')).toBe(true);
    expect(StringUtils.isNameValueList('foo:bar, baz:qux')).toBe(true);
    expect(StringUtils.isNameValueList('foo:bar ,baz:qux')).toBe(true);
    expect(StringUtils.isNameValueList('foo:bar,baz:qux,abc:def')).toBe(true);
  });

  it('returns true for blank string', () => {
    expect(StringUtils.isNameValueList('')).toBe(true);
    expect(StringUtils.isNameValueList('   ')).toBe(true);
  });

  it('returns false for invalid formats', () => {
    expect(StringUtils.isNameValueList('foo')).toBe(false);
    expect(StringUtils.isNameValueList('foo:')).toBe(false);
    expect(StringUtils.isNameValueList(':bar')).toBe(false);
    expect(StringUtils.isNameValueList('foo:bar,')).toBe(false);
    expect(StringUtils.isNameValueList('foo:bar,,baz:qux')).toBe(false);
    expect(StringUtils.isNameValueList('foo:bar,baz')).toBe(false);
  });
});

describe("StringUtils.wildcardMatch", () => {
    it("should match all when search is empty", () => {
        expect(StringUtils.wildcardMatch("", "anything")).toBe(true);
        expect(StringUtils.wildcardMatch("   ", "anything")).toBe(true);
    });

    it("should match start of string when search ends with *", () => {
        expect(StringUtils.wildcardMatch("bob*", "bobcat")).toBe(true);
        expect(StringUtils.wildcardMatch("bob*", "bob")).toBe(true);
        expect(StringUtils.wildcardMatch("bob*", "bobby")).toBe(true);
        expect(StringUtils.wildcardMatch("bob*", "robob")).toBe(false);
    });

    it("should match end of string when search starts with *", () => {
        expect(StringUtils.wildcardMatch("*bob", "superbob")).toBe(true);
        expect(StringUtils.wildcardMatch("*bob", "bob")).toBe(true);
        expect(StringUtils.wildcardMatch("*bob", "bobcat")).toBe(false);
    });

    it("should match substring when search starts and ends with *", () => {
        expect(StringUtils.wildcardMatch("*bob*", "superbobcat")).toBe(true);
        expect(StringUtils.wildcardMatch("*bob*", "bob")).toBe(true);
        expect(StringUtils.wildcardMatch("*bob*", "catbobdog")).toBe(true);
        expect(StringUtils.wildcardMatch("*bob*", "catdog")).toBe(false);
    });

    it("should match start of string when search has no *", () => {
        expect(StringUtils.wildcardMatch("bob", "bobcat")).toBe(true);
        expect(StringUtils.wildcardMatch("bob", "bob")).toBe(true);
        expect(StringUtils.wildcardMatch("bob", "bobby")).toBe(true);
        expect(StringUtils.wildcardMatch("bob", "robob")).toBe(false);
    });

    it("should ignore case", () => {
        expect(StringUtils.wildcardMatch("Bob*", "bobcat")).toBe(true);
        expect(StringUtils.wildcardMatch("*BOB", "superbob")).toBe(true);
        expect(StringUtils.wildcardMatch("*BoB*", "catbobdog")).toBe(true);
    });
});

describe( "StringUtils.resolvePlaceholders", () =>
{
    test( "replaces a single placeholder from one source", () =>
    {
        const result = StringUtils.resolvePlaceholders( "Hello @first_name@!", [ { first_name: "Amanda" } ] );
        expect( result ).toBe( "Hello Amanda!" );
    } );

    test( "replaces multiple placeholders from multiple sources", () =>
    {
        const result = StringUtils.resolvePlaceholders(
            "Hi @first_name@, your texter is @user_name@",
            [ { user_name: "Greg" }, { first_name: "Amanda" } ]
        );
        expect( result ).toBe( "Hi Amanda, your texter is Greg" );
    } );

    test( "returns empty string when raw is empty", () =>
    {
        expect( StringUtils.resolvePlaceholders( "", [ { first_name: "Amanda" } ] ) ).toBe( "" );
    } );

    test( "returns empty string when raw is null/undefined", () =>
    {
        expect( StringUtils.resolvePlaceholders( null as any, [ {} ] ) ).toBe( "" );
    } );

    test( "replaces placeholder with empty string when key not found in any source", () =>
    {
        const result = StringUtils.resolvePlaceholders( "Hello @missing@!", [ { first_name: "Amanda" } ] );
        expect( result ).toBe( "Hello!" );
    } );

    test( "collapses extra spaces left by missing placeholders and trims", () =>
    {
        const result = StringUtils.resolvePlaceholders( "Hello @missing@ World", [ {} ] );
        expect( result ).toBe( "Hello World" );
    } );

    test( "uses first source that provides the key", () =>
    {
        const result = StringUtils.resolvePlaceholders(
            "Hello @first_name@",
            [ { first_name: "First" }, { first_name: "Second" } ]
        );
        expect( result ).toBe( "Hello First" );
    } );

    test( "handles numeric values in source", () =>
    {
        const result = StringUtils.resolvePlaceholders( "You have @count@ messages", [ { count: 5 } ] );
        expect( result ).toBe( "You have 5 messages" );
    } );

    test( "skips null sources without throwing", () =>
    {
        const result = StringUtils.resolvePlaceholders(
            "Hello @first_name@",
            [ null as any, { first_name: "Amanda" } ]
        );
        expect( result ).toBe( "Hello Amanda" );
    } );

    test( "handles placeholders with dots, hyphens, and underscores", () =>
    {
        const result = StringUtils.resolvePlaceholders(
            "Hello @user.first-name_test@",
            [ { "user.first-name_test": "Amanda" } ]
        );
        expect( result ).toBe( "Hello Amanda" );
    } );

    test( "returns trimmed result with no leading or trailing spaces", () =>
    {
        const result = StringUtils.resolvePlaceholders( "  @missing@  ", [ {} ] );
        expect( result ).toBe( "" );
    } );

    test( "processes @placeholder@ tags correctly when an email address is present in the text", () =>
    {
        const result = StringUtils.resolvePlaceholders(
            "Hi @first_name@, reply or email us at support@example.com to visit @url@",
            [ { first_name: "Amanda", url: "https://rumbleup.io" } ]
        );
        expect( result ).toBe( "Hi Amanda, reply or email us at support@example.com to visit https://rumbleup.io" );
    } );
} );

// eof
describe('StringUtils.isValid (moved from Validator.isString)', () => {
    test('true only for strings', () => {
        expect( StringUtils.isValid('text') ).toBe( true );
        expect( StringUtils.isValid('') ).toBe( true );
        expect( StringUtils.isValid( 123 ) ).toBe( false );
        expect( StringUtils.isValid( null ) ).toBe( false );
        expect( StringUtils.isValid( undefined ) ).toBe( false );
        expect( StringUtils.isValid( { food: 'bar' } ) ).toBe( false );
        expect( StringUtils.isValid( true ) ).toBe( false );
        expect( StringUtils.isValid( new Date() ) ).toBe( false );
    });
});
