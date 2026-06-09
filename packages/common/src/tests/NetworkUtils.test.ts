import NetworkUtils from '../utils/NetworkUtils';

describe('NetworkUtils.isUrl', () => {
    test('accepts http/https URLs', () => {
        expect( NetworkUtils.isUrl('https://www.example.com') ).toBe( true );
        expect( NetworkUtils.isUrl('http://api.domain.org/path') ).toBe( true );
        expect( NetworkUtils.isUrl('https://sub.domain.co.uk/path?query=value') ).toBe( true );
    });
    test('rejects non-http / malformed', () => {
        expect( NetworkUtils.isUrl('ftp://example.com') ).toBe( false );
        expect( NetworkUtils.isUrl('https://localhost') ).toBe( false );
        expect( NetworkUtils.isUrl('not-a-url') ).toBe( false );
        expect( NetworkUtils.isUrl('') ).toBe( false );
    });
});

describe('NetworkUtils.isHostname (moved from Validator)', () => {
    test('valid hostnames', () => {
        expect( NetworkUtils.isHostname('google.com') ).toBe( true );
        expect( NetworkUtils.isHostname('mail.google.com') ).toBe( true );
        expect( NetworkUtils.isHostname('my-site123.net') ).toBe( true );
    });
    test('invalid hostnames', () => {
        expect( NetworkUtils.isHostname('localhost') ).toBe( false );
        expect( NetworkUtils.isHostname('google!.com') ).toBe( false );
        expect( NetworkUtils.isHostname('.com') ).toBe( false );
        expect( NetworkUtils.isHostname('google.com.') ).toBe( false );
        expect( NetworkUtils.isHostname('a..com') ).toBe( false );
        expect( NetworkUtils.isHostname('') ).toBe( false );
    });
});

describe('NetworkUtils.isIpAddress (moved from Validator, now range-checked)', () => {
    test('valid IPv4', () => {
        expect( NetworkUtils.isIpAddress('100.27.8.34') ).toBe( true );
        expect( NetworkUtils.isIpAddress('0.0.0.0') ).toBe( true );
        expect( NetworkUtils.isIpAddress('255.255.255.255') ).toBe( true );
    });
    test('invalid IPv4', () => {
        expect( NetworkUtils.isIpAddress('google.com') ).toBe( false );
        expect( NetworkUtils.isIpAddress('100.9999.0.0') ).toBe( false );  // out of range
        expect( NetworkUtils.isIpAddress('256.0.0.1') ).toBe( false );
        expect( NetworkUtils.isIpAddress('12ab.0.0.1') ).toBe( false );
        expect( NetworkUtils.isIpAddress('1.2.3') ).toBe( false );
    });
});
