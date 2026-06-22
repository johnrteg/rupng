//
import ArrayUtils from '../utils/ArrayUtils';

describe('ArrayUtils', () => {
    test('isSame compare 2 arrays', () => {
        expect( ArrayUtils.isSame( [1,2,3,4], [1,2,3,4] )).toBe( true );
        expect( ArrayUtils.isSame( [1,2,3,4], [0,2,3,4] )).toBe( false );

        expect( ArrayUtils.isSame( ["apple","oranges"], ["apple","oranges"] )).toBe( true );
        expect( ArrayUtils.isSame( ["apple","oranges"], ["apple","oranges","grapes"] )).toBe( false );
        expect( ArrayUtils.isSame( ["apple","oranges"], ["apple",3] )).toBe( false );

        expect( ArrayUtils.isSame( [true,true], [true,true] )).toBe( true );
        expect( ArrayUtils.isSame( [false,false], [false,false] )).toBe( true );
        expect( ArrayUtils.isSame( [true,false], [false,false] )).toBe( false );
    });

    test('remove removes item from array', () => {
        expect( ArrayUtils.remove( [1,2,3,4], 2 )).toEqual( [1,3,4] );
        expect( ArrayUtils.remove( [1,2,3,4], 5 )).toEqual( [1,2,3,4] );
        expect( ArrayUtils.remove( [5,1,2,3,4,5], 5 )).toEqual( [1,2,3,4] );

        expect( ArrayUtils.remove( ["apple","oranges","grapes"], "oranges" )).toEqual( ["apple","grapes"] );
        expect( ArrayUtils.remove( ["apple","oranges","grapes","oranges"], "oranges" )).toEqual( ["apple","grapes"] );
    });

    describe('allTrue', () => {
        it('returns true if all elements are true', () => {
            expect(ArrayUtils.allTrue([true, true, true])).toBe(true);
        });
        it('returns false if any element is false', () => {
            expect(ArrayUtils.allTrue([true, false, true])).toBe(false);
        });
        it('returns true for empty array', () => {
            expect(ArrayUtils.allTrue([])).toBe(true);
        });
    });

    describe('chunkArray', () => {
        it('chunks array into correct sizes', () => {
            expect(ArrayUtils.chunkArray([1,2,3,4,5], 2)).toEqual([[1,2],[3,4],[5]]);
        });
        it('returns empty array for empty input', () => {
            expect(ArrayUtils.chunkArray([], 3)).toEqual([]);
        });
        it('returns one chunk if size is greater than array length', () => {
            expect(ArrayUtils.chunkArray([1,2], 5)).toEqual([[1,2]]);
        });
    });

    describe('match', () => {
        it('returns item if it exists in array', () => {
            expect(ArrayUtils.match(['a','b','c'], 'b')).toBe('b');
        });
        it('returns first item if item is undefined', () => {
            expect(ArrayUtils.match(['x','y'], undefined)).toBe('x');
        });
        it('returns first item if item not in array', () => {
            expect(ArrayUtils.match(['foo','bar'], 'baz')).toBe('foo');
        });
        it('is case insensitive', () => {
            expect(ArrayUtils.match(['one','two'], 'ONE')).toBe('one');
        });
    });

    describe('humanNumberArrayToString', () => {
        it('returns empty string for empty array', () => {
            expect(ArrayUtils.humanNumberArrayToString([])).toBe('');
        });
        it('returns single number as string', () => {
            expect(ArrayUtils.humanNumberArrayToString([5])).toBe('5');
        });
        it('returns comma separated for non-consecutive numbers', () => {
            expect(ArrayUtils.humanNumberArrayToString([1,3,5])).toBe('1, 3, 5');
        });
        it('returns range for consecutive numbers', () => {
            expect(ArrayUtils.humanNumberArrayToString([1,2,3,5,6,8])).toBe('1-3, 5, 6, 8');
        });
        it('removes duplicates and sorts', () => {
            expect(ArrayUtils.humanNumberArrayToString([3,2,2,1,5,4,4])).toBe('1-5');
        });
        it('handles two consecutive numbers', () => {
            expect(ArrayUtils.humanNumberArrayToString([10,11])).toBe('10, 11');
        });
    });


});

describe("ArrayUtils.removeAllSpaces", () => {
    it("should remove all spaces from each string in the array", () => {
        expect(ArrayUtils.removeAllSpaces(["a b", "c  d", "e   f"])).toEqual(["ab", "cd", "ef"]);
    });

    it("should handle strings with no spaces", () => {
        expect(ArrayUtils.removeAllSpaces(["abc", "def"])).toEqual(["abc", "def"]);
    });

    it("should handle empty strings", () => {
        expect(ArrayUtils.removeAllSpaces(["", "a b", " "])).toEqual(["", "ab", ""]);
    });

    it("should handle array with only spaces", () => {
        expect(ArrayUtils.removeAllSpaces([" ", "   ", ""])).toEqual(["", "", ""]);
    });

    it("should handle mixed whitespace (tabs, newlines)", () => {
        expect(ArrayUtils.removeAllSpaces(["a\tb", "c\nd", "e f"])).toEqual(["ab", "cd", "ef"]);
    });

    it("should return empty array when input is empty", () => {
        expect(ArrayUtils.removeAllSpaces([])).toEqual([]);
    });
});

// eof
describe('ArrayUtils.isValid / isPrimitive (moved from Validator)', () => {
    test('isValid is true only for arrays', () => {
        expect( ArrayUtils.isValid( [] ) ).toBe( true );
        expect( ArrayUtils.isValid( [ 1, 2, 3 ] ) ).toBe( true );
        expect( ArrayUtils.isValid( { food: 'bar' } ) ).toBe( false );
        expect( ArrayUtils.isValid( 'array' ) ).toBe( false );
        expect( ArrayUtils.isValid( null ) ).toBe( false );
        expect( ArrayUtils.isValid( undefined ) ).toBe( false );
        expect( ArrayUtils.isValid( new Date() ) ).toBe( false );
    });
    test('isPrimitive is true for non-empty primitive arrays', () => {
        expect( ArrayUtils.isPrimitive( [ 1, 2, 3 ] ) ).toBe( true );
        expect( ArrayUtils.isPrimitive( [ 'a', 'b' ] ) ).toBe( true );
        expect( ArrayUtils.isPrimitive( [ true, false ] ) ).toBe( true );
        expect( ArrayUtils.isPrimitive( [ { id: 1 } ] ) ).toBe( false );
        expect( ArrayUtils.isPrimitive( [ new Date() ] ) ).toBe( false );
        expect( ArrayUtils.isPrimitive( [] ) ).toBe( false );
        expect( ArrayUtils.isPrimitive( 'not array' ) ).toBe( false );
    });
});
