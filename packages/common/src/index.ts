export const add = (a: number, b: number): number => a + b;
export const subtract = (a: number, b: number): number => a - b;

//
// shared types
//
export type { Type } from './Types';

//
// exported/public fucntion
//
export { default as NumberUtils } from './utils/NumberUtils';
export { default as CurrencyUtils } from './utils/CurrencyUtils';
export { default as StringUtils } from './utils/StringUtils';
export { default as ByteUtils } from './utils/ByteUtils';
export { default as ObjectUtils } from './utils/ObjectUtils';
export { default as ValueUtils } from './utils/ValueUtils';
export { default as BooleanUtils } from './utils/BooleanUtils';
export { default as PhoneUtils } from './utils/PhoneUtils';
export { default as EmailUtils } from './utils/EmailUtils';
export { default as NetworkUtils } from './utils/NetworkUtils';
export { default as UuidUtils } from './utils/UuidUtils';
export { default as ArrayUtils } from './utils/ArrayUtils';
export { default as ColorUtils } from './utils/ColorUtils';
export { default as DateUtils } from './utils/DateUtils';
export { default as TimeZoneUtils } from './utils/TimeZoneUtils';
export { default as FileUtils } from './utils/FileUtils';
export { default as ResultUtils } from './utils/ResultUtils';
export { default as UserAgent } from './utils/UserAgent';

// structured logger (shared by Node services + the browser web app) — named export preserves the
// merged Trace namespace (Trace.Level / Trace.Data).
export { Trace } from './Trace';

