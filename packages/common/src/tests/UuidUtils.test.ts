import UuidUtils from '../utils/UuidUtils';

describe('UuidUtils.isValid (moved from Validator.isUuid)', () => {
    test('accepts valid UUIDs (anchored, any version, case-insensitive)', () => {
        expect( UuidUtils.isValid('550e8400-e29b-41d4-a716-446655440000') ).toBe( true );
        expect( UuidUtils.isValid('A1B2C3D4-E5F6-4789-9ABC-DEF012345678') ).toBe( true );
    });
    test('rejects empty / non-string / embedded / malformed', () => {
        expect( UuidUtils.isValid('') ).toBe( false );
        expect( UuidUtils.isValid( null as unknown as string ) ).toBe( false );
        expect( UuidUtils.isValid('xx550e8400-e29b-41d4-a716-446655440000yy') ).toBe( false );
        expect( UuidUtils.isValid('not-a-uuid') ).toBe( false );
    });
});
