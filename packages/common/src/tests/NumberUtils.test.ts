import NumberUtils from '../utils/NumberUtils';

describe('NumberUtils', () => {
    test('randomRange range of random numbers', () => {
        const r1 = expect( NumberUtils.randomRange( 0, 100 ));
        r1.toBeGreaterThanOrEqual( 0 );
        r1.toBeLessThanOrEqual( 100 );

        const r2  = expect( NumberUtils.randomRange( -10, 10 ));
        r2.toBeGreaterThanOrEqual( -10 );
        r2.toBeLessThanOrEqual( 10 );
    });

    test('isValid (moved from Validator.isNumber)', () => {
        expect( NumberUtils.isValid( 34 ) ).toBe( true );
        expect( NumberUtils.isValid( 0 ) ).toBe( true );
        expect( NumberUtils.isValid( -45.67 ) ).toBe( true );
        expect( NumberUtils.isValid( Number.NaN ) ).toBe( false );
        expect( NumberUtils.isValid( '123' ) ).toBe( false );
        expect( NumberUtils.isValid( null ) ).toBe( false );
        expect( NumberUtils.isValid( undefined ) ).toBe( false );
        expect( NumberUtils.isValid( true ) ).toBe( false );
    });

    test('get (moved from Validator.getNumber) — fallback 0', () => {
        expect( NumberUtils.get( 123 ) ).toBe( 123 );
        expect( NumberUtils.get( -45.67 ) ).toBe( -45.67 );
        expect( NumberUtils.get( 'invalid' ) ).toBe( 0 );
        expect( NumberUtils.get( null ) ).toBe( 0 );
        expect( NumberUtils.get( Number.NaN ) ).toBe( 0 );
    });

    test('percent (capped, null-safe)', () => {
        expect( NumberUtils.percent( 25, 100 ) ).toBe( 25 );
        expect( NumberUtils.percent( 150, 100 ) ).toBe( 100 );
        expect( NumberUtils.percent( null, 100 ) ).toBe( 0 );
        expect( NumberUtils.percent( 50, 0 ) ).toBe( 0 );
    });
});
