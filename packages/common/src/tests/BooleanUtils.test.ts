import BooleanUtils from '../utils/BooleanUtils';

describe('BooleanUtils (was Validator.isBoolean / getBoolean)', () => {
    test('isValid accepts boolean-likes', () => {
        expect( BooleanUtils.isValid( null ) ).toBe( false );
        expect( BooleanUtils.isValid( undefined ) ).toBe( false );
        expect( BooleanUtils.isValid('text') ).toBe( false );
        expect( BooleanUtils.isValid( 34 ) ).toBe( false );
        expect( BooleanUtils.isValid( 0 ) ).toBe( true );
        expect( BooleanUtils.isValid( true ) ).toBe( true );
        expect( BooleanUtils.isValid( false ) ).toBe( true );
        expect( BooleanUtils.isValid( "1" ) ).toBe( true );
        expect( BooleanUtils.isValid( "yes" ) ).toBe( true );
        expect( BooleanUtils.isValid( "Yes" ) ).toBe( true );
        expect( BooleanUtils.isValid( "True" ) ).toBe( true );
    });

    test('get coerces (case-insensitive)', () => {
        expect( BooleanUtils.get('TRUE') ).toBe( true );
        expect( BooleanUtils.get('Yes') ).toBe( true );
        expect( BooleanUtils.get('1') ).toBe( true );
        expect( BooleanUtils.get(1) ).toBe( true );
        expect( BooleanUtils.get(true) ).toBe( true );
        expect( BooleanUtils.get('false') ).toBe( false );
        expect( BooleanUtils.get('no') ).toBe( false );
        expect( BooleanUtils.get('maybe') ).toBe( false );
        expect( BooleanUtils.get(0) ).toBe( false );
    });
});
