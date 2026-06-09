import ValueUtils from '../utils/ValueUtils';

describe('ValueUtils (presence checks, was Validator)', () => {
    test('isNull / notNull', () => {
        expect( ValueUtils.isNull( null ) ).toBe( true );
        expect( ValueUtils.isNull( undefined ) ).toBe( false );
        expect( ValueUtils.isNull( 0 ) ).toBe( false );
        expect( ValueUtils.notNull( null ) ).toBe( false );
        expect( ValueUtils.notNull( 'text' ) ).toBe( true );
        expect( ValueUtils.notNull( false ) ).toBe( true );
    });

    test('isUndefined / notUndefined', () => {
        expect( ValueUtils.isUndefined( undefined ) ).toBe( true );
        expect( ValueUtils.isUndefined( null ) ).toBe( false );
        expect( ValueUtils.notUndefined( 0 ) ).toBe( true );
        expect( ValueUtils.notUndefined( undefined ) ).toBe( false );
    });
});
