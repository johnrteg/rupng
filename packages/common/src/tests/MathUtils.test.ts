import MathUtils from '../utils/MathUtils';

describe('MathUtils', () => {
    test('randomRange range of random numbers', () => {
        const r1 = expect( MathUtils.randomRange( 0, 100 ));
        r1.toBeGreaterThanOrEqual( 0 );
        r1.toBeLessThanOrEqual( 100 );

        const r2  = expect( MathUtils.randomRange( -10, 10 ));
        r2.toBeGreaterThanOrEqual( -10 );
        r2.toBeLessThanOrEqual( 10 );
    });


});