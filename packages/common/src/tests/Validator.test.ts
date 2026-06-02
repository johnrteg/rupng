import Validator from '../utils/Validator';

describe('Validator', () => {
    test('isEmailAddress checks for valid email addresses', () => {
        expect( Validator.isEmailAddress( 'bob@acme.com' )).toBe( true );
        expect( Validator.isEmailAddress('bob')).toBe( false );
        expect( Validator.isEmailAddress('bob@')).toBe( false );
        expect( Validator.isEmailAddress('bob@acme')).toBe( false );
        expect( Validator.isEmailAddress('bob@acme.')).toBe( false );
        expect( Validator.isEmailAddress('bob @acme.com')).toBe( false );
        expect( Validator.isEmailAddress('bob@ acme.com')).toBe( false );
        expect( Validator.isEmailAddress('bob.smith@acme.com')).toBe( true );
        expect( Validator.isEmailAddress('bob-smith@acme.com')).toBe( true );
        expect( Validator.isEmailAddress('bob@acme-industry.com')).toBe( true );
        expect( Validator.isEmailAddress('bob@AcmeIndustry.com')).toBe( true );
        expect( Validator.isEmailAddress('')).toBe( false );
    });

    test('isIpAddress checks for valid IP address', () => {
        expect( Validator.isIpAddress( '100.27.8.34' )).toBe( true );
        expect( Validator.isIpAddress('0.0.0.0')).toBe( true );
        expect( Validator.isIpAddress('google.com')).toBe( false );
        expect( Validator.isIpAddress('100.9999.0.0')).toBe( true );
    });

    test('isNull checks value being null', () => {
        expect( Validator.isNull( null )).toBe( true );
        //expect( Validator.isNull( undefined )).toBe( true );
        expect( Validator.isNull('text')).toBe( false );
        expect( Validator.isNull( { food: 'bar' } )).toBe( false );
        expect( Validator.isNull( 34 )).toBe( false );
        expect( Validator.isNull( true )).toBe( false );
        expect( Validator.isNull( false )).toBe( false );
        expect( Validator.isNull( new Date() )).toBe( false );
    });

    test('notNull checks value not being null', () => {
        expect( Validator.notNull( null )).toBe( false );
        //expect( Validator.notNull( undefined )).toBe( false );
        expect( Validator.notNull('text')).toBe( true );
        expect( Validator.notNull( { food: 'bar' } )).toBe( true );
        expect( Validator.notNull( 34 )).toBe( true );
        expect( Validator.notNull( true )).toBe( true );
        expect( Validator.notNull( false )).toBe( true );
        expect( Validator.notNull( new Date() )).toBe( true );
    });

    test('isString checks value is a string', () => {
        expect( Validator.isString( null )).toBe( false );
        expect( Validator.isString( undefined )).toBe( false );
        expect( Validator.isString('text')).toBe( true );
        expect( Validator.isString('')).toBe( true );
        expect( Validator.isString("")).toBe( true );
        expect( Validator.isString("text")).toBe( true );
        expect( Validator.isString( { food: 'bar' } )).toBe( false );
        expect( Validator.isString( 34 )).toBe( false );
        expect( Validator.isString( true )).toBe( false );
        expect( Validator.isString( false )).toBe( false );
        expect( Validator.isString( new Date() )).toBe( false );
    });

    test('isNumber checks value is a string', () => {
        expect( Validator.isNumber( null )).toBe( false );
        expect( Validator.isNumber( undefined )).toBe( false );
        expect( Validator.isNumber('text')).toBe( false );
        expect( Validator.isNumber('')).toBe( false );
        expect( Validator.isNumber("")).toBe( false );
        expect( Validator.isNumber("text")).toBe( false );
        expect( Validator.isNumber( { food: 'bar' } )).toBe( false );
        expect( Validator.isNumber( 34 )).toBe( true );
        expect( Validator.isNumber( -34 )).toBe( true );
        expect( Validator.isNumber( 0 )).toBe( true );
        expect( Validator.isNumber( Number.MAX_VALUE )).toBe( true );
        expect( Validator.isNumber( Number.MIN_VALUE )).toBe( true );
        expect( Validator.isNumber( true )).toBe( false );
        expect( Validator.isNumber( false )).toBe( false );
        expect( Validator.isNumber( new Date() )).toBe( false );
    });

    test('isBoolean checks value is a boolean', () => {
        expect( Validator.isBoolean( null )).toBe( false );
        expect( Validator.isBoolean( undefined )).toBe( false );
        expect( Validator.isBoolean('text')).toBe( false );
        expect( Validator.isBoolean('')).toBe( false );
        expect( Validator.isBoolean("")).toBe( false );
        expect( Validator.isBoolean("text")).toBe( false );
        expect( Validator.isBoolean( { food: 'bar' } )).toBe( false );
        expect( Validator.isBoolean( 34 )).toBe( false );
        expect( Validator.isBoolean( -34 )).toBe( false );
        expect( Validator.isBoolean( 0 )).toBe( true );
        expect( Validator.isBoolean( true )).toBe( true );
        expect( Validator.isBoolean( false )).toBe( true );
        expect( Validator.isBoolean( "1" )).toBe( true );
        expect( Validator.isBoolean( "0" )).toBe( true );
        expect( Validator.isBoolean( "yes" )).toBe( true );
        expect( Validator.isBoolean( "no" )).toBe( true );
        expect( Validator.isBoolean( "true" )).toBe( true );
        expect( Validator.isBoolean( "false" )).toBe( true );
        expect( Validator.isBoolean( "Yes" )).toBe( true );
        expect( Validator.isBoolean( "No" )).toBe( true );
        expect( Validator.isBoolean( "True" )).toBe( true );
        expect( Validator.isBoolean( "False" )).toBe( true );
        expect( Validator.isBoolean( new Date() )).toBe( false );
    });

    test('isObject checks value is an object', () => {
        expect( Validator.isObject( null ) ).toBe( false );
        expect( Validator.isObject( undefined ) ).toBe( false );
        expect( Validator.isObject('text') ).toBe( false );
        expect( Validator.isObject('') ).toBe( false );
        expect( Validator.isObject("") ).toBe( false );
        expect( Validator.isObject("text") ).toBe( false );
        expect( Validator.isObject( { food: 'bar' } ) ).toBe( true );
        expect( Validator.isObject( [ "apple", "oranges" ] ) ).toBe( true );
        expect( Validator.isObject( 34 ) ).toBe( false );
        expect( Validator.isObject( -34 ) ).toBe( false );
        expect( Validator.isObject( 0 ) ).toBe( false );
        expect( Validator.isObject( Number.MAX_VALUE ) ).toBe( false );
        expect( Validator.isObject( Number.MIN_VALUE ) ).toBe( false );
        expect( Validator.isObject( true ) ).toBe( false );
        expect( Validator.isObject( false ) ).toBe( false );
        expect( Validator.isObject( new Date() ) ).toBe( true );
    });

    test('isArray checks value is an array', () => {
        expect( Validator.isArray( null ) ).toBe( false );
        expect( Validator.isArray( undefined ) ).toBe( false );
        expect( Validator.isArray('text') ).toBe( false );
        expect( Validator.isArray('') ).toBe( false );
        expect( Validator.isArray("") ).toBe( false );
        expect( Validator.isArray("text") ).toBe( false );
        expect( Validator.isArray( { food: 'bar' } ) ).toBe( false );
        expect( Validator.isArray( [ "apple", "oranges" ] ) ).toBe( true );
        expect( Validator.isArray( [ ] ) ).toBe( true );
        expect( Validator.isArray( [ 1,2,34,6 ] ) ).toBe( true );
        expect( Validator.isArray( [ true,false ] ) ).toBe( true );
        expect( Validator.isArray( [ { animal: "cat" }, { animal: "dog" } ] ) ).toBe( true );
        expect( Validator.isArray( 34 ) ).toBe( false );
        expect( Validator.isArray( -34 ) ).toBe( false );
        expect( Validator.isArray( 0 ) ).toBe( false );
        expect( Validator.isArray( Number.MAX_VALUE ) ).toBe( false );
        expect( Validator.isArray( Number.MIN_VALUE ) ).toBe( false );
        expect( Validator.isArray( true ) ).toBe( false );
        expect( Validator.isArray( false ) ).toBe( false );
        expect( Validator.isArray( new Date() ) ).toBe( false );
    });


});

describe('Validator.isHostname', () => {
    it('returns true for a valid hostname with .com', () => {
        expect(Validator.isHostname('google.com')).toBe(true);
    });

    it('returns true for a valid hostname with .org', () => {
        expect(Validator.isHostname('wikipedia.org')).toBe(true);
    });

    it('returns true for a valid subdomain', () => {
        expect(Validator.isHostname('mail.google.com')).toBe(true);
    });

    it('returns false for a hostname without a dot', () => {
        expect(Validator.isHostname('localhost')).toBe(false);
    });

    it('returns false for a hostname with invalid characters', () => {
        expect(Validator.isHostname('google!.com')).toBe(false);
    });

    it('returns false for an empty string', () => {
        expect(Validator.isHostname('')).toBe(false);
    });

    it('returns false for a hostname with only a TLD', () => {
        expect(Validator.isHostname('.com')).toBe(false);
    });

    it('returns false for a hostname with a trailing dot', () => {
        expect(Validator.isHostname('google.com.')).toBe(false);
    });

    it('returns true for a valid hostname with numbers and hyphens', () => {
        expect(Validator.isHostname('my-site123.net')).toBe(true);
    });
});