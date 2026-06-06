export const add = (a: number, b: number): number => a + b;
export const subtract = (a: number, b: number): number => a - b;

//
// shared types
//
export type { Type } from './Types';

//
// exported/public fucntion
//
export { default as MathUtils } from './utils/MathUtils';
export { default as StringUtils } from './utils/StringUtils';
export { default as SysConstants } from './utils/SysConstants';
export { default as Network } from './utils/network/Network';
export { default as ObjectUtils } from './utils/ObjectUtils';
export { default as Validator } from './utils/Validator';
export { default as ArrayUtils } from './utils/ArrayUtils';
export { default as ColorUtils } from './utils/ColorUtils';
export { default as DateUtils } from './utils/DateUtils';
export { default as FileUtils } from './utils/FileUtils';

