import ColorUtils from '../utils/ColorUtils';

describe('ColorUtils.toHex', () => {
    it('returns #000000 for null or empty string', () => {
        expect(ColorUtils.toHex(null as any)).toBe('#000000');
        expect(ColorUtils.toHex('')).toBe('#000000');
    });

    it('returns the color if already in hex format', () => {
        expect(ColorUtils.toHex('#123456')).toBe('#123456');
        expect(ColorUtils.toHex('#abcdef')).toBe('#abcdef');
    });

    it('converts rgb to hex', () => {
        expect(ColorUtils.toHex('rgb(255, 0, 0)')).toBe('#ff0000');
        expect(ColorUtils.toHex('rgb(0, 255, 0)')).toBe('#00ff00');
        expect(ColorUtils.toHex('rgb(0, 0, 255)')).toBe('#0000ff');
    });

    it('converts rgba to hex with alpha', () => {
        expect(ColorUtils.toHex('rgba(255, 0, 0, 0.5)')).toBe('#ff000080');
        expect(ColorUtils.toHex('rgba(0, 255, 0, 1)')).toBe('#00ff00');
        expect(ColorUtils.toHex('rgba(0, 0, 255, 0.25)')).toBe('#0000ff40');
    });

    it('returns #000000 for invalid input', () => {
        expect(ColorUtils.toHex('notacolor')).toBe('#000000');
        expect(ColorUtils.toHex('rgb()')).toBe('#000000');
    });
});