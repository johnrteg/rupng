import EmailUtils from '../utils/EmailUtils';

describe('EmailUtils.isValid (moved from Validator.isEmailAddress)', () => {
    test('accepts valid addresses', () => {
        expect( EmailUtils.isValid('bob@acme.com') ).toBe( true );
        expect( EmailUtils.isValid('bob.smith@acme.com') ).toBe( true );
        expect( EmailUtils.isValid('bob-smith@acme.com') ).toBe( true );
        expect( EmailUtils.isValid('bob@acme-industry.com') ).toBe( true );
        expect( EmailUtils.isValid('bob@AcmeIndustry.com') ).toBe( true );
    });
    test('rejects invalid / non-string', () => {
        expect( EmailUtils.isValid('bob') ).toBe( false );
        expect( EmailUtils.isValid('bob@') ).toBe( false );
        expect( EmailUtils.isValid('bob@acme') ).toBe( false );
        expect( EmailUtils.isValid('bob@acme.') ).toBe( false );
        expect( EmailUtils.isValid('bob @acme.com') ).toBe( false );
        expect( EmailUtils.isValid('') ).toBe( false );
        expect( EmailUtils.isValid( null as unknown as string ) ).toBe( false );
    });
});
