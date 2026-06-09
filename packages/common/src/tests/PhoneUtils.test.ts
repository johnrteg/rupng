import PhoneUtils from '../utils/PhoneUtils';

describe('PhoneUtils.isValid (NANP)', () => {
    test('accepts valid NANP with formatting + optional +1', () => {
        expect( PhoneUtils.isValid('(212) 555-0123') ).toBe( true );
        expect( PhoneUtils.isValid('212-555-0123') ).toBe( true );
        expect( PhoneUtils.isValid('212.555.0123') ).toBe( true );
        expect( PhoneUtils.isValid('2125550123') ).toBe( true );
        expect( PhoneUtils.isValid('+1 212 555 0123') ).toBe( true );
    });
    test('rejects invalid NANP', () => {
        expect( PhoneUtils.isValid('555-123-4567') ).toBe( false );    // exchange starts with 1
        expect( PhoneUtils.isValid('911-555-0123') ).toBe( false );    // N11 area code
        expect( PhoneUtils.isValid('123-4567') ).toBe( false );        // too short
        expect( PhoneUtils.isValid('+44 20 7946 0958') ).toBe( false );// not NANP
    });
});

describe('PhoneUtils.toE164 (storage form, +1 default)', () => {
    test('normalizes bare NANP to +1 E.164', () => {
        const a = PhoneUtils.toE164('(212) 555-0123');
        expect( a.ok && a.data ).toBe( '+12125550123' );
        expect( (PhoneUtils.toE164('212-555-0123') as { ok: true; data: string } ).data ).toBe( '+12125550123' );
        const b = PhoneUtils.toE164('+1 212 555 0123');
        expect( b.ok && b.data ).toBe( '+12125550123' );
        const intl = PhoneUtils.toE164('+44 20 7946 0958');            // explicit + kept as-is
        expect( intl.ok && intl.data ).toBe( '+442079460958' );
    });
    test('rejects invalid', () => {
        expect( PhoneUtils.toE164('555-123-4567').ok ).toBe( false );  // exchange starts with 1
        expect( PhoneUtils.toE164('123-4567').ok ).toBe( false );
    });
});

describe('PhoneUtils misc', () => {
    test('isE164', () => {
        expect( PhoneUtils.isE164('+12125550123') ).toBe( true );
        expect( PhoneUtils.isE164('2125550123') ).toBe( false );
    });
    test('isShortCode', () => {
        expect( PhoneUtils.isShortCode('12345') ).toBe( true );
        expect( PhoneUtils.isShortCode('123456') ).toBe( true );
        expect( PhoneUtils.isShortCode('1234') ).toBe( false );
        expect( PhoneUtils.isShortCode('12a45') ).toBe( false );
    });
    test('isSms', () => {
        expect( PhoneUtils.isSms('sms:2125550123') ).toBe( true );
        expect( PhoneUtils.isSms('sms:12345') ).toBe( true );
        expect( PhoneUtils.isSms('https://example.com') ).toBe( false );
    });
    test('format', () => {
        expect( PhoneUtils.format('+12125550123') ).toBe( '(212) 555-0123' );
    });
});
