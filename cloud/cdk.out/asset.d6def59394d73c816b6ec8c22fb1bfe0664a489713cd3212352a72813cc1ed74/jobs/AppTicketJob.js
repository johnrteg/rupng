"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/jobs/AppTicketJob.ts
var AppTicketJob_exports = {};
__export(AppTicketJob_exports, {
  AppTicketJob: () => AppTicketJob,
  default: () => AppTicketJob_default,
  handler: () => handler
});
module.exports = __toCommonJS(AppTicketJob_exports);

// ../../../packages/services/src/Trace.ts
var Trace = class _Trace {
  name;
  id;
  // correlation id — currently process-scoped; see TODO below
  minLevel;
  // TODO(monitor): `id` will become the per-request TRANSACTION ID, not a single app id.
  // Add a child-logger factory (e.g. `forRequest( transactionId )`) that returns a Trace with
  // the same name/level but a request-scoped id, so concurrent requests stay distinguishable in
  // the logs the monitor service ingests. Wired from Application — see Application.ts constructor.
  ///////////////////////////////////////////////////////////////////////
  constructor(name, id, minLevel = _Trace.Level.INFO) {
    this.name = name;
    this.id = id;
    this.minLevel = minLevel;
  }
  /////////////////////////////////////////////////////////////////////////////////////
  static label(level) {
    switch (level) {
      case _Trace.Level.INFO:
        return "INFO";
      case _Trace.Level.WARNING:
        return "WARN";
      case _Trace.Level.ERROR:
        return "ERROR";
      default:
        return "UNKNOWN";
    }
  }
  /////////////////////////////////////////////////////////////////////////////////////
  // Error fields are non-enumerable, so they vanish under JSON.stringify - pull out the
  // useful parts explicitly so they survive in the structured record.
  static serializeArg(arg) {
    if (arg instanceof Error)
      return { name: arg.name, message: arg.message, stack: arg.stack };
    return arg;
  }
  /////////////////////////////////////////////////////////////////////////////////////
  // Emits one parseable JSON record per event. INFO -> stdout; WARN/ERROR -> stderr so
  // operators can split and alert on the two streams.
  write(level, message, args) {
    if (level < this.minLevel) return;
    const record = {
      level: _Trace.label(level),
      time: (/* @__PURE__ */ new Date()).toISOString(),
      name: this.name,
      id: this.id,
      message
    };
    if (args.length > 0)
      record.args = args.map(_Trace.serializeArg);
    const line = JSON.stringify(record);
    if (level >= _Trace.Level.WARNING)
      console.error(line);
    else
      console.log(line);
  }
  /////////////////////////////////////////////////////////////////////////////////////
  info(message, ...args) {
    this.write(_Trace.Level.INFO, message, args);
  }
  /////////////////////////////////////////////////////////////////////////////////////
  warn(message, ...args) {
    this.write(_Trace.Level.WARNING, message, args);
  }
  /////////////////////////////////////////////////////////////////////////////////////
  error(message, ...args) {
    this.write(_Trace.Level.ERROR, message, args);
  }
};
((Trace2) => {
  let Level;
  ((Level2) => {
    Level2[Level2["INFO"] = 1] = "INFO";
    Level2[Level2["WARNING"] = 2] = "WARNING";
    Level2[Level2["ERROR"] = 3] = "ERROR";
  })(Level = Trace2.Level || (Trace2.Level = {}));
})(Trace || (Trace = {}));

// ../../../packages/services/src/Application.ts
var os = __toESM(require("os"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_crypto = require("crypto");

// ../../../packages/cloud-spec/src/Naming.ts
function envVarName(kind, key) {
  return [kind, key].join("_").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

// ../../../packages/cloud-spec/src/Resolver.ts
var CloudResolver = class {
  env;
  service;
  source;
  /**
   * @param env     current deployment environment
   * @param service the owning service name
   * @param source  identifier source to read from (defaults to `process.env`)
   */
  constructor(env, service, source = process.env) {
    this.env = env;
    this.service = service;
    this.source = source;
  }
  // ── Typed accessors by resource kind (each resolves a logical key -> physical id) ──
  /** Resolve an SQS queue URL by logical key. */
  queueUrl(key) {
    return this.require("queue" /* QUEUE */, key);
  }
  /** Resolve an S3 bucket name by logical key. */
  bucketName(key) {
    return this.require("bucket" /* BUCKET */, key);
  }
  /** Resolve a DynamoDB table name by logical key. */
  tableName(key) {
    return this.require("table" /* TABLE */, key);
  }
  /** Resolve an RDS/Aurora endpoint by logical key. */
  databaseUrl(key) {
    return this.require("database" /* DATABASE */, key);
  }
  /** Resolve a Secrets Manager secret ARN by logical key. */
  secretArn(key) {
    return this.require("secret" /* SECRET */, key);
  }
  /** Resolve an EventBridge bus name by logical key. */
  eventBusName(key) {
    return this.require("eventbus" /* EVENT_BUS */, key);
  }
  /** Resolve a Kafka topic name by logical key. */
  topicName(key) {
    return this.require("topic" /* TOPIC */, key);
  }
  /** Resolve a Lambda function ARN by logical key. */
  functionArn(key) {
    return this.require("function" /* FUNCTION */, key);
  }
  /** Resolve an SNS topic ARN by logical key. */
  snsTopicArn(key) {
    return this.require("snstopic" /* SNS_TOPIC */, key);
  }
  /** Resolve an API Gateway URL by logical key. */
  apiUrl(key) {
    return this.require("api" /* API */, key);
  }
  /** Resolve a KMS key ARN by logical key. */
  kmsKeyArn(key) {
    return this.require("kms" /* KMS_KEY */, key);
  }
  /** Resolve an AppConfig application id by logical key. */
  appConfigId(key) {
    return this.require("appconfig" /* APP_CONFIG */, key);
  }
  /** Resolve an ElastiCache endpoint by logical key. */
  cacheEndpoint(key) {
    return this.require("cache" /* CACHE */, key);
  }
  /** Resolve an OpenSearch endpoint by logical key. */
  searchEndpoint(key) {
    return this.require("search" /* SEARCH */, key);
  }
  /** Resolve a CloudFront distribution domain by logical key. */
  cdnDomain(key) {
    return this.require("cdn" /* CDN */, key);
  }
  /** Resolve a Cognito user pool id by logical key. */
  userPoolId(key) {
    return this.require("userpool" /* USER_POOL */, key);
  }
  /** Resolve a MediaConvert queue ref by logical key. */
  mediaConvertQueue(key) {
    return this.require("mediaconvert" /* MEDIACONVERT */, key);
  }
  /** Resolve a CloudWatch RUM app-monitor id by logical key. */
  rumAppMonitor(key) {
    return this.require("rum" /* RUM */, key);
  }
  /** Resolve an Amplify app id by logical key. */
  amplifyAppId(key) {
    return this.require("amplify" /* AMPLIFY */, key);
  }
  /** Resolve a WebSocket API URL by logical key. */
  webSocketUrl(key) {
    return this.require("websocket" /* WEBSOCKET */, key);
  }
  // ── Generic access ──
  /**
   * Resolve a logical key to its physical id, or `undefined` if it isn't present.
   * @param kind the resource kind
   * @param key  the logical resource key
   */
  lookup(kind, key) {
    return this.source[envVarName(kind, key)];
  }
  /**
   * Resolve a logical key to its physical id, throwing (fail-fast at boot) if it isn't present.
   * @param kind the resource kind
   * @param key  the logical resource key
   * @throws if the identifier env var is missing or empty
   */
  require(kind, key) {
    const name = envVarName(kind, key);
    const value = this.source[name];
    if (value === void 0 || value === "") {
      throw new Error(`CloudResolver[${this.env}/${this.service}]: missing resource identifier '${name}' (${kind}:${key})`);
    }
    return value;
  }
};

// ../../../packages/services/src/aws/AppConfig.ts
var import_client_appconfigdata = require("@aws-sdk/client-appconfigdata");
var import_client_appconfig = require("@aws-sdk/client-appconfig");

// ../../../packages/common/src/utils/NumberUtils.ts
var NumberUtils = class _NumberUtils {
  /////////////////////////////////////////////////////////////////////////////////
  /** True if `value` is a real number (typeof number, not NaN). Moved from `Validator.isNumber`. */
  static isValid(value) {
    return typeof value === "number" && !Number.isNaN(value);
  }
  /////////////////////////////////////////////////////////////////////////////////
  /** The value if it's a valid number, else `0` (safe fallback). Moved from `Validator.getNumber`. */
  static get(value) {
    return _NumberUtils.isValid(value) ? value : 0;
  }
  //////////////////////////////////////////////////////////////////////////////////////
  /**
   * Generate a random integer within a specified range (inclusive).
   *
   * @param min_value - The minimum value (inclusive) of the random range.
   * @param max_value - The maximum value (inclusive) of the random range.
   * @returns A random integer between min_value and max_value, inclusive.
   *
   * @example
   * NumberUtils.randomRange(1, 6); // Random integer from 1 to 6 (like a dice roll)
   */
  static randomRange(min_value, max_value) {
    return Math.floor(Math.random() * (max_value - min_value + 1)) + min_value;
  }
  //////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Calculate the percentage of a value relative to a total (capped at 100%). Returns 0 for null
   * inputs or a zero total (avoids division by zero).
   *
   * @example
   * NumberUtils.percent(25, 100); // 25
   * NumberUtils.percent(150, 100); // 100 (capped)
   */
  static percent(value, total) {
    if (value === null || total === null || total === 0)
      return 0;
    else
      return Math.min(value / total * 100, 100);
  }
  //////////////////////////////////////////////////////////////////////////////////////////////////
  /** Comparator helper: `(a - b) * dir` (dir 1 = ascending, -1 = descending). */
  static compare(a, b, dir) {
    return (a - b) * dir;
  }
};

// ../../../packages/common/src/utils/StringUtils.ts
var StringUtils = class _StringUtils {
  /** True if `value` is a string (the type check; moved from `Validator.isString`). `""` counts. */
  static isValid(value) {
    return typeof value === "string";
  }
  static ELLIPSE = "\u2026";
  static COLON = ":";
  static SPACE = " ";
  static NUMBERS = "0123456789";
  static SPECIAL = ".,<>?':;{}`[]~!@#$%^&*()_-+=";
  static ALPHA_LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
  static BULLET = "\u2022";
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  static size(str) {
    return str !== void 0 && str !== null ? str.length : 0;
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  static notBlank(str) {
    return str !== void 0 && str !== null && str !== "";
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////
  /**
  * Resolves placeholders in the format @key@ using the provided sources in order. The first non-empty value for a key will be used.
  * 
  * Ex. "Hi @first_name@, your texter is @user_name@" with sources [ { user_name: "Greg" }, { first_name: "Amanda" } ]
  * resolves to "Hi Amanda, your texter is Greg"
  */
  static resolvePlaceholders(raw, sources) {
    if (!raw) return "";
    const result = raw.replace(/( ?)@([a-zA-Z0-9._-]+)@/g, (skip, space, key) => {
      for (const source of sources.filter((source2) => source2 !== null)) {
        const value = source[key];
        if (value !== null && value !== void 0 && value !== "") {
          return space + String(value);
        }
      }
      return "";
    });
    return result.replace(/ {2,}/g, " ").trim();
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
  * Compare a free-form user search query against a candidate string.
  *
  * Supported query forms:
  * - `foo`      : Case-insensitive substring match.
  * - `foo*`     : Wildcard match where `*` means "any characters" (anchored to the whole string).
  * - `*foo`     : Wildcard match (ends-with).
  * - `*foo*`    : Wildcard match (contains).
  * - `f*o`      : General wildcard match (e.g. `f*o*bar`).
  * - `"foo"`    : Quoted exact match (case-insensitive, trims surrounding whitespace).
  *
  * Notes:
  * - Blank/whitespace-only `search` returns `true` (no filtering).
  * - For wildcard searches, the pattern is matched against the entire candidate string.
  *
  * @param search User-entered search string (may be null/undefined).
  * @param candidate String being tested (may be null/undefined).
  * @returns `true` if the candidate matches the search query; otherwise `false`.
  *
  * @example
  * StringUtils.matchesSearch('', 'Anything'); // true
  * StringUtils.matchesSearch('foo', 'my-foo-project'); // true
  * StringUtils.matchesSearch('foo*', 'foobar'); // true
  * StringUtils.matchesSearch('*foo', 'barfoo'); // true
  * StringUtils.matchesSearch('f*o', 'fast-hello'); // true
  * StringUtils.matchesSearch('"Foo"', ' foo '); // true
  */
  static matchesSearch(search, candidate) {
    const s = (search ?? "").trim();
    const c = candidate ?? "";
    if (s === "") return true;
    const isQuoted = s.length >= 2 && s.startsWith('"') && s.endsWith('"');
    if (isQuoted) {
      const needle = s.slice(1, -1).trim().toLowerCase();
      if (needle === "") return true;
      return c.trim().toLowerCase() === needle;
    }
    if (s.includes("*")) {
      const needle = s.toLowerCase();
      const escaped = needle.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const pattern = "^" + escaped.replace(/\*/g, ".*") + "$";
      const re = new RegExp(pattern, "i");
      return re.test(c);
    }
    return c.toLowerCase().includes(s.toLowerCase());
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Remove all whitespace characters from a string.
   *
   * Uses a regular expression to remove all whitespace characters including spaces,
   * tabs, newlines, and other Unicode whitespace characters. Returns an empty string
   * if the input is null, undefined, or falsy.
   *
   * @param value - The string to remove whitespace from.
   * @returns A new string with all whitespace characters removed, or empty string if input is falsy.
   *
   * @example
   * StringUtils.removeAllSpaces('hello world'); // 'helloworld'
   * StringUtils.removeAllSpaces('  a  b  c  '); // 'abc'
   * StringUtils.removeAllSpaces('hello\t\nworld'); // 'helloworld'
   * StringUtils.removeAllSpaces(null); // ''
   */
  static removeAllSpaces(value) {
    return value ? value.replace(/\s+/g, "") : "";
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Capitalize the first character of a string while preserving the rest unchanged.
   *
   * Takes a string and converts only the first character to uppercase, leaving all other
   * characters in their original case. This is useful for proper name formatting, sentence
   * capitalization, or title formatting where only the initial character should be capitalized.
   * Returns an empty string for null, undefined, or empty input values.
   *
   * @param value - The string to capitalize. Can be null or undefined for safe handling.
   * @returns A new string with the first character capitalized and remaining characters unchanged,
   *          or empty string if input is null, undefined, or empty.
   *
   * @example
   * ```typescript
   * // Basic capitalization
   * StringUtils.capitalize('hello'); // 'Hello'
   * StringUtils.capitalize('world'); // 'World'
   * StringUtils.capitalize('javascript'); // 'Javascript'
   */
  static capitalize(value) {
    if (value === void 0 || value === null || value === "") return "";
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Check if a target string matches any string in an array (case-insensitive).
   *
   * Performs a case-insensitive comparison between the target string and each
   * string in the provided array. Returns true if any match is found.
   *
   * @param target - The string to search for in the array.
   * @param arr - Array of strings to search through.
   * @returns True if the target string matches any item in the array (case-insensitive), false otherwise.
   *
   * @example
   * StringUtils.matchesAny('Hello', ['hello', 'world']); // true
   * StringUtils.matchesAny('WORLD', ['hello', 'world']); // true
   * StringUtils.matchesAny('foo', ['hello', 'world']); // false
   * StringUtils.matchesAny('Test', []); // false
   */
  static matchesAny(target, arr) {
    const lowerTarget = target.toLowerCase();
    return arr.some((item) => item.toLowerCase() === lowerTarget);
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Validate if a string follows the name:value,name:value format.
   *
   * Checks if the input string is a valid comma-separated list of name:value pairs.
   * Names must be word characters (\w+) and values can be any characters except commas.
   * Whitespace around names, values, and commas is allowed. Empty strings are considered valid.
   *
   * @param str - The string to validate against the name:value format.
   * @returns True if the string is empty or matches the name:value,name:value pattern, false otherwise.
   *
   * @example
   * StringUtils.isNameValueList('name:John,age:30'); // true
   * StringUtils.isNameValueList('key: value , other: data'); // true (whitespace allowed)
   * StringUtils.isNameValueList('single:value'); // true (single pair allowed)
   * StringUtils.isNameValueList(''); // true (empty string allowed)
   * StringUtils.isNameValueList('invalid format'); // false
   * StringUtils.isNameValueList('name:val,ue'); // false (comma in value not allowed)
   */
  static isNameValueList(str) {
    const trimmed = str.trim();
    if (trimmed === "") return true;
    return /^(\s*\w+\s*:\s*[^,]+)(\s*,\s*\w+\s*:\s*[^,]+)*\s*$/.test(trimmed);
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Replace all occurrences of a substring in a string with a replacement string.
   *
   * Safely escapes special regex characters in the search string and performs a global
   * replacement. Handles dollar sign escaping in the replacement string to prevent
   * regex replacement conflicts. Returns an empty string if the input is falsy.
   *
   * @param str - The source string to perform replacements on.
   * @param find - The substring to find and replace. Special regex characters are automatically escaped.
   * @param with_str - The replacement string. Dollar signs are automatically escaped to prevent regex conflicts.
   * @param ignore - Optional flag for case-insensitive matching. Defaults to false (case-sensitive).
   * @returns A new string with all occurrences replaced, or empty string if input is falsy.
   *
   * @example
   * StringUtils.replaceAll('hello world hello', 'hello', 'hi'); // 'hi world hi'
   * StringUtils.replaceAll('Hello World Hello', 'hello', 'hi', true); // 'hi World hi' (case-insensitive)
   * StringUtils.replaceAll('a.b.c', '.', '_'); // 'a_b_c' (special chars escaped)
   * StringUtils.replaceAll('test $1 test', 'test', '$2'); // '$2 $1 $2' (dollar signs handled)
   */
  static replaceAll(str, find, with_str, ignore = false) {
    return str ? str.replace(new RegExp(find.replace(/([\/\,\!\\\^\$\{\}\[\]\(\)\.\*\+\?\|\<\>\-\&])/g, "\\$&"), ignore ? "gi" : "g"), typeof with_str == "string" ? with_str.replace(/\$/g, "$$$$") : with_str) : "";
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Pad a number with leading zeros to a specified number of places.
   *
   * Adds leading zeros to the integer part of a number while preserving any
   * decimal part. If the number already has more digits than the specified
   * places, it returns the number unchanged.
   *
   * @param value - The number to pad with leading zeros.
   * @param places - The minimum number of digits for the integer part. Defaults to 2.
   * @returns A string representation of the number with leading zeros added to meet the specified places.
   *
   * @example
   * StringUtils.leadingZero(5); // '05'
   * StringUtils.leadingZero(5, 3); // '005'
   * StringUtils.leadingZero(123, 2); // '123' (no padding needed)
   * StringUtils.leadingZero(5.75, 3); // '005.75'
   * StringUtils.leadingZero(12.5); // '12.5'
   */
  static leadingZero(value, places = 2) {
    const [intPart, fracPart] = String(value).split(".");
    const paddedInt = intPart.padStart(places >= 0 ? places : 0, "0");
    return fracPart !== void 0 ? `${paddedInt}.${fracPart}` : paddedInt;
  }
  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  static wildcardMatch(search, text) {
    if (!search || search.trim() === "") return true;
    const s = search.trim().toLowerCase();
    const t = text.toLowerCase();
    if (s.startsWith("*") && s.endsWith("*")) {
      return t.includes(s.slice(1, -1));
    } else if (s.startsWith("*")) {
      return t.endsWith(s.slice(1));
    } else {
      return t.startsWith(s.slice(0, -1));
    }
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Generate a random string of alphabetic characters.
   *
   * Creates a random string containing only uppercase and lowercase letters (a-z, A-Z).
   * Each character is randomly selected from the alphabet using NumberUtils.randomRange().
   *
   * @param places - The length of the random string to generate. Must be a positive number.
   * @returns A random string containing only alphabetic characters of the specified length.
   *
   * @example
   * StringUtils.randomString(5); // 'aBcDe' (example output)
   * StringUtils.randomString(10); // 'XyZaBcDeFg' (example output)
   * StringUtils.randomString(1); // 'M' (example output)
   * StringUtils.randomString(0); // '' (empty string)
   */
  static randomString(places) {
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const nbr = alphabet.length - 1;
    let str = "";
    let i;
    for (i = 0; i < places; i++) {
      str += alphabet[NumberUtils.randomRange(0, nbr)];
    }
    return str;
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Convert an enum-style string to a human-readable title case string.
   *
   * Transforms strings with underscores (commonly used in enums) into space-separated
   * title case strings. Each word is capitalized and underscores are replaced with spaces.
   *
   * @param value - The enum-style string to convert (e.g., "FIRST_NAME", "user_status").
   * @returns A human-readable string in title case with spaces instead of underscores.
   *
   * @example
   * StringUtils.enumToString('FIRST_NAME'); // 'First Name'
   * StringUtils.enumToString('user_status'); // 'User Status'
   * StringUtils.enumToString('ORDER_PENDING'); // 'Order Pending'
   * StringUtils.enumToString('single'); // 'Single'
   */
  static enumToString(value) {
    return value.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Extract and clean a phone number from a string, returning only digits.
   *
   * Removes all non-digit characters and handles both regular phone numbers and short codes:
   * - Short codes (5-6 digits): Returns all digits as-is
   * - Regular phone numbers (7+ digits): Returns the last 10 digits, handling country codes like +1
   * Returns an empty string if the input is empty or null.
   *
   * @param value - The input string containing a phone number with potential formatting or country code.
   * @returns A string containing digits - all digits for short codes, last 10 for regular numbers, or empty string if input is empty/null.
   *
   * @example
   * // Regular phone numbers (7+ digits) - returns last 10 digits
   * StringUtils.toPhoneNumber('(555) 123-4567'); // '5551234567'
   * StringUtils.toPhoneNumber('+1-555-123-4567'); // '5551234567'
   * StringUtils.toPhoneNumber('1 555 123 4567'); // '5551234567'
   * StringUtils.toPhoneNumber('555.123.4567'); // '5551234567'
   * 
   * // Short codes (5-6 digits) - returns all digits
   * StringUtils.toPhoneNumber('12345'); // '12345'
   * StringUtils.toPhoneNumber('567890'); // '567890'
   * StringUtils.toPhoneNumber('88888'); // '88888'
   * 
   * // Edge cases
   * StringUtils.toPhoneNumber(''); // ''
   * StringUtils.toPhoneNumber('abc'); // ''
   */
  static toPhoneNumber(value) {
    if (!value) return "";
    let digits = value.replace(/\D/g, "");
    if (digits.length >= 5 && digits.length <= 6) {
      return digits;
    }
    if (digits.length >= 7) {
      return digits.slice(-10);
    }
    return digits;
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Format a phone number string into a rich format, handling both short codes and regular phone numbers.
   *
   * Takes a phone number string and formats it appropriately based on the number of digits:
   * - Short codes (5-6 digits): Returns digits as-is without formatting
   * - Regular phone numbers (7+ digits): Formats as (###) ###-#### for display purposes
   * Uses the toPhoneNumber method internally to extract clean digits first, then applies
   * progressive formatting based on the number of digits available.
   *
   * @param value - The input string containing a phone number to format.
   * @returns A formatted phone number string with appropriate formatting, or empty string if no digits.
   *
   * @example
   * // Short codes (5-6 digits) - no formatting applied
   * StringUtils.toRichPhoneNumber('12345'); // '12345'
   * StringUtils.toRichPhoneNumber('567890'); // '567890'
   * 
   * // Regular phone numbers (7+ digits) - formatted with parentheses and dashes
   * StringUtils.toRichPhoneNumber('5551234567'); // '(555) 123-4567'
   * StringUtils.toRichPhoneNumber('+1-555-123-4567'); // '(555) 123-4567'
   * StringUtils.toRichPhoneNumber('555123'); // '(555) 123'
   * StringUtils.toRichPhoneNumber('555'); // '(555'
   * StringUtils.toRichPhoneNumber('12'); // '(12'
   * StringUtils.toRichPhoneNumber(''); // ''
   */
  static toRichPhoneNumber(value) {
    const digits = _StringUtils.toPhoneNumber(value);
    if (digits.length === 5 || digits.length === 6) {
      return digits;
    }
    if (digits.length === 0) return "";
    if (digits.length < 4) return `(${digits}`;
    if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Generate a random string of numeric digits.
   *
   * Creates a random string containing only digits (0-9) of the specified length.
   * Each digit is randomly selected using NumberUtils.randomRange() to ensure uniform
   * distribution across all possible digit values.
   *
   * @param places - The length of the random digit string to generate. Must be a positive number.
   * @returns A random string containing only numeric digits (0-9) of the specified length.
   *
   * @example
   * StringUtils.randomDigits(5); // '73492' (example output)
   * StringUtils.randomDigits(10); // '8204567319' (example output)
   * StringUtils.randomDigits(3); // '042' (example output, can include leading zeros)
   * StringUtils.randomDigits(1); // '7' (example output)
   * StringUtils.randomDigits(0); // '' (empty string)
   */
  static randomDigits(places) {
    let str = "";
    let i;
    for (i = 0; i < places; i++) {
      str += NumberUtils.randomRange(0, 9).toString();
    }
    return str;
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Convert an underscore-separated string to a human-readable title case label.
   *
   * Takes a string with underscores (typically used for variable names, database fields,
   * or API properties) and transforms it into a user-friendly label by replacing underscores
   * with spaces and converting to title case where each word starts with a capital letter.
   *
   * @param text - The underscore-separated string to convert to a human-readable label.
   * @returns A human-readable string in title case with spaces instead of underscores.
   *
   * @example
   * StringUtils.humanLabel('item_count'); // 'Item Count'
   * StringUtils.humanLabel('first_name'); // 'First Name'
   * StringUtils.humanLabel('user_profile_data'); // 'User Profile Data'
   * StringUtils.humanLabel('api_key'); // 'Api Key'
   * StringUtils.humanLabel('single'); // 'Single' (no underscores)
   */
  static humanLabel(text) {
    let label = _StringUtils.replaceAll(text, "_", " ");
    return _StringUtils.toMixedCase(label);
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Generate a random email address for testing purposes.
   *
   * Creates a realistic-looking but fake email address with random alphabetic characters
   * for both the local part (before @) and domain name. The local part is 4-10 characters,
   * the domain is 10-20 characters, and the top-level domain is randomly selected from
   * common suffixes (com, net, gov, edu, co). The entire email is converted to lowercase.
   *
   * @returns A randomly generated email address string in lowercase format.
   *
   * @example
   * StringUtils.randomEmail(); // 'abcdef@ghijklmnopqrstuvwxyz.com' (example output)
   * StringUtils.randomEmail(); // 'testuser@randomdomain.net' (example output)
   * StringUtils.randomEmail(); // 'sample@exampledomain.edu' (example output)
   *
   * @note This method is intended for testing and development purposes only.
   * Do not use these emails for actual communication or production data.
   */
  static randomEmail() {
    const suffix = ["com", "net", "gov", "edu", "co"];
    const nbr_suffix = suffix.length - 1;
    let str = _StringUtils.randomString(NumberUtils.randomRange(4, 10));
    str += "@";
    str += _StringUtils.randomString(NumberUtils.randomRange(10, 20));
    str += ".";
    str += suffix[NumberUtils.randomRange(0, nbr_suffix)];
    return str.toLowerCase();
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Generate a random valid US phone number for testing purposes.
   *
   * Creates a realistic 10-digit US phone number following North American Numbering Plan (NANP) rules.
   * The area code (first 3 digits) uses valid ranges: first digit 2-7, second digit 0-9, third digit 1-9.
   * The exchange code (next 3 digits) follows valid patterns: first digit 1-9, second digit 0-9, third digit 1-9.
   * The last 4 digits can be any combination of 0-9. Returns the phone number as a string of digits only.
   *
   * @returns A randomly generated 10-digit US phone number string containing only digits.
   *
   * @example
   * StringUtils.randomPhone(); // '5551234567' (example output)
   * StringUtils.randomPhone(); // '2125556789' (example output)
   * StringUtils.randomPhone(); // '7025551234' (example output)
   *
   * @note This method generates valid US phone number patterns for testing and development purposes only.
   * Do not use these numbers for actual communication or production data. The generated numbers
   * follow NANP rules but may still correspond to real phone numbers.
   */
  static randomPhone() {
    let str = NumberUtils.randomRange(2, 7).toString();
    str += NumberUtils.randomRange(0, 9).toString();
    str += NumberUtils.randomRange(1, 9).toString();
    str += NumberUtils.randomRange(1, 9).toString();
    str += NumberUtils.randomRange(0, 9).toString();
    str += NumberUtils.randomRange(1, 9).toString();
    str += NumberUtils.randomRange(0, 9).toString();
    str += NumberUtils.randomRange(0, 9).toString();
    str += NumberUtils.randomRange(0, 9).toString();
    str += NumberUtils.randomRange(0, 9).toString();
    return str;
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Generate a secure random password with specified character type requirements.
   *
   * Creates a password of the specified length containing the required number of each character type
   * (uppercase letters, lowercase letters, numbers, and special characters). The method ensures the
   * minimum requirements are met by adding the specified number of each character type first, then
   * fills any remaining length with random characters from all available sets. Finally, it shuffles
   * all characters to randomize their positions and avoid predictable patterns.
   *
   * @param length - The total length of the password to generate.
   * @param nbrUpper - The minimum number of uppercase letters (A-Z) to include.
   * @param nbrLower - The minimum number of lowercase letters (a-z) to include.
   * @param nbrNumbers - The minimum number of numeric digits (0-9) to include.
   * @param nbrSpecial - The minimum number of special characters to include.
   * @returns A randomly generated password string meeting the specified requirements.
   *
   * @example
   * StringUtils.generatePassword(12, 2, 2, 2, 2); // 'A7b$K9mP2x&L' (example output)
   * StringUtils.generatePassword(8, 1, 1, 1, 1); // 'P4k@mBtR' (example output)
   * StringUtils.generatePassword(16, 3, 3, 3, 3); // 'X9z&M2c$N8vR@K4y' (example output)
   *
   * @note The special characters used are: .,?:;{}[]<>/~!@#$%^&*()_-+=
   * If the sum of required character counts exceeds the total length, the password
   * will only contain the required characters up to the specified length.
   */
  static generatePassword(length, nbrUpper, nbrLower, nbrNumbers, nbrSpecial) {
    const upperChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowerChars = "abcdefghijklmnopqrstuvwxyz";
    const numberChars = "0123456789";
    const specialChars = ".,?:;{}[]<>/~!@#$%^&*()_-+=";
    let chars = [];
    let i;
    for (i = 0; i < nbrUpper; i++) {
      chars.push(upperChars[NumberUtils.randomRange(0, upperChars.length - 1)]);
    }
    for (i = 0; i < nbrLower; i++) {
      chars.push(lowerChars[NumberUtils.randomRange(0, lowerChars.length - 1)]);
    }
    for (i = 0; i < nbrNumbers; i++) {
      chars.push(numberChars[NumberUtils.randomRange(0, numberChars.length - 1)]);
    }
    for (i = 0; i < nbrSpecial; i++) {
      chars.push(specialChars[NumberUtils.randomRange(0, specialChars.length - 1)]);
    }
    const allChars = upperChars + lowerChars + numberChars + specialChars;
    while (chars.length < length) {
      chars.push(allChars[NumberUtils.randomRange(0, allChars.length - 1)]);
    }
    for (let i2 = chars.length - 1; i2 > 0; i2--) {
      const j = NumberUtils.randomRange(0, i2);
      [chars[i2], chars[j]] = [chars[j], chars[i2]];
    }
    return chars.join("");
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Remove all occurrences of a specified substring from a string.
   *
   * Safely removes all instances of the search string by properly escaping special regex
   * characters in the search pattern. This prevents regex injection issues and ensures
   * literal string matching. Returns the original string unchanged if either the value
   * or find parameter is null, undefined, or empty.
   *
   * @param value - The source string to remove substrings from.
   * @param find - The substring to find and remove. Special regex characters are automatically escaped.
   * @returns A new string with all occurrences of the find string removed, or the original string if inputs are invalid.
   *
   * @example
   * StringUtils.removeAll('hello world hello', 'hello'); // ' world '
   * StringUtils.removeAll('test.file.txt', '.'); // 'testfiletxt'
   * StringUtils.removeAll('a+b+c', '+'); // 'abc' (special chars escaped)
   * StringUtils.removeAll('remove***all***stars', '***'); // 'removeallstars'
   * StringUtils.removeAll('', 'anything'); // ''
   * StringUtils.removeAll('text', ''); // 'text' (no change when find is empty)
   */
  static removeAll(value, find) {
    if (!value || !find) return value;
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return value.replace(new RegExp(escaped, "g"), "");
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Remove all special characters from a string and replace them with a specified character.
   *
   * Removes all characters that are not alphanumeric (a-z, A-Z, 0-9), periods (.), or hyphens (-),
   * and replaces consecutive sequences of such characters with the specified replacement character.
   * This is useful for sanitizing strings for filenames, URLs, or other contexts where only
   * basic alphanumeric characters and common punctuation are allowed.
   *
   * @param value - The source string to clean of special characters.
   * @param withchar - The character to replace special character sequences with.
   * @returns A new string with all special characters replaced by the specified character.
   *
   * @example
   * StringUtils.removeAllSpecial('hello@world#test', '_'); // 'hello_world_test'
   * StringUtils.removeAllSpecial('file name!@#$%^&*().txt', '-'); // 'file-name-.txt'
   * StringUtils.removeAllSpecial('user@domain.com', ''); // 'userdomain.com'
   * StringUtils.removeAllSpecial('test123-file.doc', '_'); // 'test123-file.doc' (no change)
   * StringUtils.removeAllSpecial('héllo wörld', '-'); // 'h-llo-w-rld' (accented chars removed)
   *
   * @note The regex pattern preserves: letters (a-z, A-Z), numbers (0-9), periods (.), and hyphens (-).
   * All other characters including spaces, punctuation, and Unicode characters are considered special.
   * Consecutive special characters are replaced with a single instance of the replacement character.
   */
  static removeAllSpecial(value, withchar) {
    return value.replace(/[^a-zA-Z0-9.-]+/g, withchar);
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Remove all non-alphanumeric characters from a string.
   *
   * Strips out all characters that are not letters (a-z, A-Z) or numbers (0-9), leaving
   * only basic alphanumeric characters. This is the most restrictive text cleaning method,
   * removing spaces, punctuation, special characters, and Unicode characters. Useful for
   * creating clean identifiers, usernames, or sanitized text that contains only letters and numbers.
   *
   * @param value - The source string to clean of non-alphanumeric characters.
   * @returns A new string containing only letters and numbers, with all other characters removed.
   *
   * @example
   * StringUtils.removeNonAlphaNumeric('hello world!'); // 'helloworld'
   * StringUtils.removeNonAlphaNumeric('user@domain.com'); // 'userdomain'
   * StringUtils.removeNonAlphaNumeric('test-123_file.txt'); // 'test123filetxt'
   * StringUtils.removeNonAlphaNumeric('ABC 123 !@# xyz'); // 'ABC123xyz'
   * StringUtils.removeNonAlphaNumeric('héllo wörld'); // 'hllowrld' (accented chars removed)
   * StringUtils.removeNonAlphaNumeric('OnlyLettersAndNumbers123'); // 'OnlyLettersAndNumbers123' (no change)
   *
   * @note This method preserves only: letters (a-z, A-Z) and numbers (0-9).
   * All other characters including spaces, hyphens, periods, and Unicode characters are removed.
   * This is more restrictive than removeAllSpecial() which preserves periods and hyphens.
   */
  static removeNonAlphaNumeric(value) {
    return value.replace(/[^a-zA-Z0-9]/g, "");
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Remove all leading occurrences of a specified substring from the beginning of a string.
   *
   * Repeatedly removes the specified leading substring from the start of the string until
   * it no longer begins with that substring. This is useful for cleaning up strings with
   * repeated prefixes, such as removing multiple leading slashes from paths or cleaning
   * up formatted text with repeated delimiters.
   *
   * @param value - The source string to remove leading substrings from.
   * @param leading - The substring to remove from the beginning of the string.
   * @returns A new string with all leading occurrences of the specified substring removed, or the original string if inputs are invalid.
   *
   * @example
   * StringUtils.removeLeading('///path/to/file', '/'); // 'path/to/file'
   * StringUtils.removeLeading('<<<message>>>', '<<'); // '<message>>>'
   * StringUtils.removeLeading('prefixprefixtext', 'prefix'); // 'text'
   * StringUtils.removeLeading('   hello world', ' '); // 'hello world'
   * StringUtils.removeLeading('test', 'xyz'); // 'test' (no change when leading not found)
   * StringUtils.removeLeading('', 'anything'); // '' (empty string handling)
   * StringUtils.removeLeading('text', ''); // 'text' (no change when leading is empty)
   *
   * @note This method removes ALL consecutive occurrences of the leading substring, not just the first one.
   * It continues removing until the string no longer starts with the specified substring.
   */
  static removeLeading(value, leading) {
    if (!value || !leading) return value;
    while (value.startsWith(leading)) {
      value = value.slice(leading.length);
    }
    return value;
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Removes all trailing occurrences of a specified substring from the end of a string.
   * This method repeatedly removes the trailing substring until it no longer appears at the end.
   * 
   * @param value - The input string from which to remove trailing substrings
   * @param trailing - The substring to remove from the end of the input string
   * @returns The modified string with all trailing occurrences of the specified substring removed,
   *          or the original string if either parameter is null/undefined/empty
   * 
   * @example
   * ```typescript
   * // Remove trailing slashes
   * StringUtils.removeTrailing("path/to/folder///", "/");
   * // Returns: "path/to/folder"
   * 
   * // Remove trailing whitespace
   * StringUtils.removeTrailing("Hello World   ", " ");
   * // Returns: "Hello World"
   * 
   * // Remove trailing file extensions (multiple dots)
   * StringUtils.removeTrailing("document.txt.txt.txt", ".txt");
   * // Returns: "document"
   * 
   * // No change when trailing substring not found
   * StringUtils.removeTrailing("Hello World", "xyz");
   * // Returns: "Hello World"
   * 
   * // Handle null/undefined inputs
   * StringUtils.removeTrailing(null, "/");
   * // Returns: null
   * ```
   */
  static removeTrailing(value, trailing) {
    if (!value || !trailing) return value;
    while (value.endsWith(trailing)) {
      value = value.slice(0, -trailing.length);
    }
    return value;
  }
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Generate a RFC4122 version 4 compliant UUID (Globally Unique Identifier).
   *
   * Creates a universally unique identifier following the UUID version 4 specification,
   * which uses random or pseudo-random numbers. The generated UUID has the standard format
   * of 8-4-4-4-12 hexadecimal digits separated by hyphens. This method is suitable for
   * creating unique identifiers for database records, API keys, session tokens, or any
   * scenario requiring globally unique values.
   *
   * @returns A RFC4122 version 4 compliant UUID string in the format xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
   *          where x represents a random hexadecimal digit (0-9, a-f), 4 indicates version 4,
   *          and y represents a variant digit (8, 9, a, or b)
   *
   * @example
   * ```typescript
   * // Generate unique identifiers
   * StringUtils.guid(); // '550e8400-e29b-41d4-a716-446655440000' (example output)
   * StringUtils.guid(); // 'f47ac10b-58cc-4372-a567-0e02b2c3d479' (example output)
   * StringUtils.guid(); // '6ba7b810-9dad-11d1-80b4-00c04fd430c8' (example output)
   *
   * // Use for database primary keys
   * const userId = StringUtils.guid(); // '123e4567-e89b-12d3-a456-426614174000'
   *
   * // Use for session tokens
   * const sessionToken = StringUtils.guid(); // 'a1b2c3d4-e5f6-4789-9abc-def012345678'
   * ```
   *
   * @note This implementation uses Math.random() for number generation, which is suitable for
   * most applications but may not be cryptographically secure for sensitive use cases.
   * For cryptographic applications, consider using crypto.randomUUID() or a crypto-secure
   * random number generator. Each call generates a statistically unique identifier with
   * extremely low probability of collision (1 in 5.3 x 10^36 for version 4 UUIDs).
   */
  static guid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === "x" ? r : r & 3 | 8;
      return v.toString(16);
    });
  }
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Mask all characters in a string with a specified masking character.
   *
   * Replaces every character in the input string with the specified masking character,
   * preserving the original string length. This is commonly used for hiding sensitive
   * information like passwords, credit card numbers, or personal data while maintaining
   * the visual structure of the original text. Only the first character of the masking
   * string is used if multiple characters are provided.
   *
   * @param value - The string to mask. Returns unchanged if null, undefined, or empty.
   * @param char - The character(s) to use for masking. Only the first character is used for masking.
   * @returns A new string where every character is replaced with the masking character,
   *          or the original string if either parameter is null/undefined/empty.
   *
   * @example
   * ```typescript
   * // Hide password
   * StringUtils.mask('password123', '*'); // '************'
   * 
   * // Hide credit card number
   * StringUtils.mask('4532-1234-5678-9012', '•'); // '•••••••••••••••••••'
   * 
   * // Hide email address
   * StringUtils.mask('user@domain.com', 'X'); // 'XXXXXXXXXXXXXXX'
   * 
   * // Preserve structure with spaces
   * StringUtils.mask('John Doe Smith', '#'); // '###############'
   * 
   * // Multiple masking chars - only first is used
   * StringUtils.mask('secret', '***'); // '******' (uses only '*')
   * 
   * // Handle empty/null inputs
   * StringUtils.mask('', '*'); // ''
   * StringUtils.mask('test', ''); // 'test' (no change)
   * StringUtils.mask(null, '*'); // null
   * ```
   *
   * @note This method masks ALL characters including spaces, numbers, and special characters.
   * If you need to preserve certain characters (like spaces or formatting), consider using
   * a custom masking approach. The method is useful for completely hiding sensitive data
   * while showing the general length and structure of the original information.
   */
  static mask(value, char) {
    if (!value || !char) return value;
    const maskChar = char[0];
    return value.split("").map(() => maskChar).join("");
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Convert a dollar amount to cents representation with a customizable symbol.
   *
   * Takes a dollar value (decimal number) and converts it to cents by multiplying by 100,
   * then formats it as a string with the specified symbol. The method truncates (does not round)
   * to one decimal place for precision. If the result is a whole number, no decimal places
   * are shown. This is useful for displaying monetary values in cents format or for
   * financial calculations where precision matters.
   *
   * @param value - The dollar amount to convert to cents (e.g., 1.23 becomes 123¢).
   * @param symbol - The symbol to append to the cents value. Defaults to '¢' (cents symbol).
   * @returns A formatted string representing the value in cents with the specified symbol.
   *
   * @example
   * ```typescript
   * // Basic dollar to cents conversion
   * StringUtils.toCents(1.23); // '123¢'
   * StringUtils.toCents(0.50); // '50¢'
   * StringUtils.toCents(2.00); // '200¢'
   * 
   * // Custom symbols
   * StringUtils.toCents(1.50, ' cents'); // '150 cents'
   * StringUtils.toCents(0.99, 'c'); // '99c'
   * StringUtils.toCents(5.25, ' ¢'); // '525 ¢'
   * 
   * // Truncation behavior (not rounding)
   * StringUtils.toCents(1.234); // '123.4¢' (truncated, not rounded)
   * StringUtils.toCents(1.239); // '123.9¢' (truncated, not rounded)
   * StringUtils.toCents(1.999); // '199.9¢' (truncated, not rounded to 200)
   * 
   * // Whole number results
   * StringUtils.toCents(1.00); // '100¢' (no decimal places)
   * StringUtils.toCents(0.10); // '10¢' (no decimal places)
   * 
   * // Edge cases
   * StringUtils.toCents(0); // '0¢'
   * StringUtils.toCents(0.01); // '1¢'
   * ```
   *
   * @note This method uses truncation (Math.trunc) rather than rounding to ensure
   * precise financial calculations. The method preserves up to one decimal place
   * in the cents representation when necessary, but omits decimal places for
   * whole cent values. This is particularly useful for financial applications
   * where exact cent values are critical.
   */
  static toCents(value, symbol = "\xA2") {
    const cents = value * 100;
    const truncated = Math.trunc(cents * 10) / 10;
    const decimal_str = truncated % 1 === 0 ? truncated.toFixed(0) : truncated.toFixed(1);
    return decimal_str + symbol;
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Format a string template with indexed placeholders using variable arguments.
   *
   * Takes a template string containing numbered placeholders (e.g., {0}, {1}, {2}) and replaces
   * them with corresponding values from the provided arguments. The first argument is the template
   * string, and subsequent arguments are the values to substitute. Placeholders are matched
   * case-insensitively and can appear multiple times in the template. This method provides
   * a simple string formatting mechanism similar to string interpolation or printf-style formatting.
   *
   * @param values - Variable arguments where the first is the template string with {n} placeholders,
   *                 and subsequent arguments are the values to substitute for {0}, {1}, {2}, etc.
   * @returns The formatted string with all placeholders replaced by their corresponding values,
   *          or empty string if no arguments are provided.
   *
   * @example
   * ```typescript
   * // Basic string formatting
   * StringUtils.format('Hello {0}!', 'World'); // 'Hello World!'
   * StringUtils.format('User {0} has {1} points', 'John', 100); // 'User John has 100 points'
   * 
   * // Multiple placeholders and repetition
   * StringUtils.format('{0} + {1} = {2}', 5, 3, 8); // '5 + 3 = 8'
   * StringUtils.format('Welcome {0}, welcome {0}!', 'Alice'); // 'Welcome Alice, welcome Alice!'
   * 
   * // Mixed string and number values
   * StringUtils.format('Order #{0}: ${1} for {2} items', 12345, 99.99, 5);
   * // 'Order #12345: $99.99 for 5 items'
   * 
   * // Case insensitive matching
   * StringUtils.format('Hello {0} and {0}!', 'there'); // 'Hello there and there!'
   * 
   * // Complex templates
   * StringUtils.format(
   *   'Name: {0}, Age: {1}, City: {2}, Score: {3}',
   *   'Bob', 25, 'New York', 95.5
   * ); // 'Name: Bob, Age: 25, City: New York, Score: 95.5'
   * 
   * // Empty or missing arguments
   * StringUtils.format(); // ''
   * StringUtils.format('No placeholders here'); // 'No placeholders here'
   * StringUtils.format('Missing value: {0}'); // 'Missing value: {0}' (unchanged)
   * ```
   *
   * @note Placeholders are zero-indexed ({0}, {1}, {2}, etc.) and correspond to the argument
   * positions after the template string. Placeholders without corresponding arguments remain
   * unchanged in the output. The method uses case-insensitive matching for placeholders.
   * Both string and numeric values are supported and automatically converted to strings.
   * This method is useful for internationalization, dynamic message generation, and
   * template-based string construction.
   */
  static format(...values) {
    let text = "";
    if (values.length > 0) {
      text = values[0];
      let i;
      let n = values.length;
      for (i = 1; i < n; i++) {
        text = text.replace(new RegExp("\\{" + (i - 1) + "\\}", "gi"), values[i]);
      }
    }
    return text;
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Format a string template with named placeholders using a JSON object for replacement values.
   *
   * Takes a template string containing named placeholders (e.g., {name}, {age}, {city}) and replaces
   * them with corresponding values from the provided object. Property names in the object must match
   * the placeholder names exactly. Placeholders are matched case-sensitively and can appear multiple
   * times in the template. This method provides object-based string formatting, making templates
   * more readable and maintainable than numeric index-based formatting.
   *
   * @param template - The template string containing {propertyName} placeholders to be replaced.
   * @param values - An object containing key-value pairs where keys match placeholder names.
   * @returns The formatted string with all matching placeholders replaced by their corresponding values,
   *          or the original template if template is empty or values object is null/undefined.
   *
   * @example
   * ```typescript
   * // Basic named placeholder formatting
   * StringUtils.formatTemplate('Hello {name}!', { name: 'World' }); 
   * // 'Hello World!'
   * 
   * StringUtils.formatTemplate('User {name} has {points} points', { name: 'John', points: 100 }); 
   * // 'User John has 100 points'
   * 
   * // Multiple placeholders and repetition
   * StringUtils.formatTemplate('Welcome {user}, welcome {user}!', { user: 'Alice' }); 
   * // 'Welcome Alice, welcome Alice!'
   * 
   * // Mixed data types (automatically converted to strings)
   * StringUtils.formatTemplate('Order #{id}: ${price} for {quantity} items', 
   *   { id: 12345, price: 99.99, quantity: 5 });
   * // 'Order #12345: $99.99 for 5 items'
   * 
   * // Complex object with various data types
   * StringUtils.formatTemplate(
   *   'Name: {name}, Age: {age}, City: {city}, Score: {score}',
   *   { name: 'Bob', age: 25, city: 'New York', score: 95.5 }
   * ); 
   * // 'Name: Bob, Age: 25, City: New York, Score: 95.5'
   * 
   * // Time-based example as requested
   * StringUtils.formatTemplate('Hello {name}. What is the {time}', 
   *   { name: 'bob', time: 34 });
   * // 'Hello bob. What is the 34'
   * 
   * // Unmatched placeholders remain unchanged
   * StringUtils.formatTemplate('Hello {name}, your {status} is {unknown}', 
   *   { name: 'Alice', status: 'active' });
   * // 'Hello Alice, your active is {unknown}'
   * 
   * // Empty or null inputs
   * StringUtils.formatTemplate('', { name: 'test' }); // ''
   * StringUtils.formatTemplate('Hello {name}', null); // 'Hello {name}'
   * StringUtils.formatTemplate('No placeholders', { name: 'test' }); // 'No placeholders'
   * ```
   *
   * @note Placeholder names are case-sensitive and must exactly match the property names in the
   * values object. Placeholders without corresponding properties remain unchanged in the output.
   * All values are automatically converted to strings. This method is particularly useful for
   * internationalization, template engines, dynamic content generation, and configuration-based
   * string formatting where readable placeholder names improve maintainability.
   */
  static formatTemplate(template, values) {
    if (!template || !values) return template || "";
    let result = template;
    for (const key in values) {
      if (values.hasOwnProperty(key)) {
        const placeholder = new RegExp(`\\{${key}\\}`, "g");
        result = result.replace(placeholder, String(values[key]));
      }
    }
    return result;
  }
  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  static formatAtTemplate(template, values) {
    if (!template || !values) return template || "";
    let result = template;
    for (const key in values) {
      if (values.hasOwnProperty(key)) {
        const placeholder = new RegExp(`\\@${key}\\@`, "g");
        result = result.replace(placeholder, String(values[key]));
      }
    }
    return result;
  }
  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  static formatColonTemplate(template, values) {
    if (!template || !values) return template || "";
    let result = template;
    for (const key in values) {
      if (values.hasOwnProperty(key)) {
        const placeholder = new RegExp(`:${key}(?!\\w)`, "g");
        result = result.replace(placeholder, String(values[key]));
      }
    }
    return result;
  }
  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  // direction 1 : ascend, -1 descend
  static compare(a, b, direction) {
    return a.localeCompare(b, void 0, { sensitivity: "base" }) * direction;
  }
  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Count the number of occurrences of specified characters in a text string.
   *
   * Iterates through each character in the input text and counts how many times any character
   * from the values string appears. This method is useful for counting specific character types
   * (like digits, vowels, consonants) or validating character composition in strings. Each
   * character in the text is checked against all characters in the values string for matches.
   *
   * @param text - The input string to analyze for character occurrences.
   * @param values - A string containing all the characters to count occurrences of.
   * @returns The total number of times any character from the values string appears in the text,
   *          or 0 if either parameter is null or undefined.
   *
   * @example
   * ```typescript
   * // Count digits in a string
   * StringUtils.countOccurances('abc123def456', '0123456789'); // 6
   * 
   * // Count vowels in text
   * StringUtils.countOccurances('Hello World', 'aeiouAEIOU'); // 3 (e, o, o)
   * 
   * // Count specific characters
   * StringUtils.countOccurances('javascript', 'aeiou'); // 3 (a, a, i)
   * StringUtils.countOccurances('Hello World!', 'lo'); // 4 (l, l, o, o)
   * 
   * // Count punctuation marks
   * StringUtils.countOccurances('Hello, World! How are you?', ',.!?'); // 3
   * 
   * // Count spaces and tabs
   * StringUtils.countOccurances('Hello\tWorld  Test', ' \t'); // 4
   * 
   * // Using predefined character sets
   * StringUtils.countOccurances('Test123!@#', StringUtils.NUMBERS); // 3
   * StringUtils.countOccurances('Test123!@#', StringUtils.SPECIAL); // 3
   * 
   * // No matches found
   * StringUtils.countOccurances('Hello World', 'xyz'); // 0
   * 
   * // Edge cases
   * StringUtils.countOccurances('', 'abc'); // 0
   * StringUtils.countOccurances('test', ''); // 0
   * StringUtils.countOccurances(null, 'abc'); // 0
   * StringUtils.countOccurances('test', null); // 0
   * ```
   *
   * @note This method performs a case-sensitive character match. If you need case-insensitive
   * counting, convert both the text and values parameters to the same case before calling.
   * The method counts individual character occurrences, not substring occurrences. Each
   * character in the text is evaluated independently against the values string. This method
   * is particularly useful for text analysis, validation rules, and character frequency analysis.
   */
  static countOccurances(text, values) {
    if (text == null || values == null) return 0;
    let count = 0;
    let len = text.length;
    let i;
    for (i = 0; i < len; i++) {
      if (values.indexOf(text.charAt(i)) >= 0) {
        count++;
      }
    }
    return count;
  }
  ///////////////////////////////////////////////////////////////////////////////////
  /**
   * Count the number of uppercase letters in a text string.
   *
   * Iterates through each character in the input text and counts how many are uppercase
   * letters (A-Z). Uses a regular expression to test each character against the uppercase
   * letter pattern. This method is useful for password validation, text analysis, and
   * enforcing formatting rules that require specific uppercase letter counts.
   *
   * @param text - The input string to analyze for uppercase letter occurrences.
   * @returns The total number of uppercase letters (A-Z) found in the text,
   *          or 0 if the parameter is null or undefined.
   *
   * @example
   * ```typescript
   * // Count uppercase letters in mixed case text
   * StringUtils.countUppercase('Hello World'); // 2 (H, W)
   * StringUtils.countUppercase('HELLO world'); // 5 (H, E, L, L, O)
   * StringUtils.countUppercase('JavaScript'); // 2 (J, S)
   * 
   * // Password validation example
   * StringUtils.countUppercase('MyPassword123!'); // 2 (M, P)
   * StringUtils.countUppercase('mypassword123!'); // 0
   * StringUtils.countUppercase('MYPASSWORD123!'); // 10
   * 
   * // Text analysis examples
   * StringUtils.countUppercase('This Is Title Case'); // 4 (T, I, T, C)
   * StringUtils.countUppercase('THIS IS ALL CAPS'); // 11
   * StringUtils.countUppercase('this is lowercase'); // 0
   * 
   * // Mixed content with numbers and symbols
   * StringUtils.countUppercase('ABC123def!@#GHI'); // 6 (A, B, C, G, H, I)
   * StringUtils.countUppercase('Test@Email.COM'); // 4 (T, E, C, O, M)
   * 
   * // Edge cases
   * StringUtils.countUppercase(''); // 0
   * StringUtils.countUppercase('123!@#'); // 0 (no letters)
   * StringUtils.countUppercase(null); // 0
   * 
   * // Unicode and special characters
   * StringUtils.countUppercase('Café MÜNCHEN'); // 6 (C, M, Ü, N, C, H, E, N)
   * StringUtils.countUppercase('Hello\nWorld\tTest'); // 3 (H, W, T)
   * ```
   *
   * @note This method only counts standard ASCII uppercase letters (A-Z). It does not
   * count accented uppercase letters or Unicode uppercase characters from other languages.
   * For more comprehensive Unicode uppercase detection, consider using locale-specific
   * methods. The method performs exact character-by-character analysis and is case-sensitive
   * by design. This method is commonly used in password strength validation, text formatting
   * analysis, and content validation rules.
   */
  static countUppercase(text) {
    if (text == null) return 0;
    let count = 0;
    let len = text.length;
    let i;
    for (i = 0; i < len; i++) {
      if (/^[A-Z]*$/.test(text.charAt(i))) {
        count++;
      }
    }
    return count;
  }
  ///////////////////////////////////////////////////////////////////////////////////
  /**
   * Count the number of lowercase letters in a text string.
   *
   * Iterates through each character in the input text and counts how many are lowercase
   * letters (a-z). Uses a regular expression to test each character against the lowercase
   * letter pattern. This method is useful for password validation, text analysis, and
   * enforcing formatting rules that require specific lowercase letter counts.
   *
   * @param text - The input string to analyze for lowercase letter occurrences.
   * @returns The total number of lowercase letters (a-z) found in the text,
   *          or 0 if the parameter is null or undefined.
   *
   * @example
   * ```typescript
   * // Count lowercase letters in mixed case text
   * StringUtils.countLowercase('Hello World'); // 8 (e, l, l, o, o, r, l, d)
   * StringUtils.countLowercase('HELLO world'); // 5 (w, o, r, l, d)
   * StringUtils.countLowercase('JavaScript'); // 8 (a, v, a, c, r, i, p, t)
   * 
   * // Password validation example
   * StringUtils.countLowercase('MyPassword123!'); // 8 (y, a, s, s, w, o, r, d)
   * StringUtils.countLowercase('MYPASSWORD123!'); // 0
   * StringUtils.countLowercase('mypassword123!'); // 10
   * 
   * // Text analysis examples
   * StringUtils.countLowercase('This Is Title Case'); // 9 (h, i, s, s, i, t, l, e, a, s, e)
   * StringUtils.countLowercase('THIS IS ALL CAPS'); // 0
   * StringUtils.countLowercase('this is lowercase'); // 13
   * 
   * // Mixed content with numbers and symbols
   * StringUtils.countLowercase('ABC123def!@#ghi'); // 6 (d, e, f, g, h, i)
   * StringUtils.countLowercase('Test@email.com'); // 8 (e, s, t, e, m, a, i, l, c, o, m)
   * 
   * // Edge cases
   * StringUtils.countLowercase(''); // 0
   * StringUtils.countLowercase('123!@#'); // 0 (no letters)
   * StringUtils.countLowercase(null); // 0
   * 
   * // Unicode and special characters
   * StringUtils.countLowercase('café münchen'); // 11 (c, a, f, é, m, ü, n, c, h, e, n)
   * StringUtils.countLowercase('hello\nworld\ttest'); // 15 (all lowercase letters)
   * ```
   *
   * @note This method only counts standard ASCII lowercase letters (a-z). It does not
   * count accented lowercase letters or Unicode lowercase characters from other languages.
   * For more comprehensive Unicode lowercase detection, consider using locale-specific
   * methods. The method performs exact character-by-character analysis and is case-sensitive
   * by design. This method is commonly used in password strength validation, text formatting
   * analysis, and content validation rules.
   */
  static countLowercase(text) {
    if (text == null) return 0;
    let count = 0;
    let len = text.length;
    let i;
    for (i = 0; i < len; i++) {
      if (/^[a-z]*$/.test(text.charAt(i))) {
        count++;
      }
    }
    return count;
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Count the number of Unicode (non-ASCII) characters in a string.
   *
   * Identifies and counts characters that fall outside the standard ASCII range (0x00-0x7F).
   * This includes accented letters, emoji, symbols from other languages, mathematical symbols,
   * and other Unicode characters. The method properly handles surrogate pairs used for
   * characters beyond the Basic Multilingual Plane, ensuring accurate counting of complex
   * Unicode sequences like emoji and special symbols.
   *
   * @param str - The input string to analyze for Unicode character occurrences.
   * @returns The total number of Unicode (non-ASCII) characters found in the string,
   *          or 0 if the parameter is null, undefined, or empty.
   *
   * @example
   * ```typescript
   * // Count accented characters
   * StringUtils.countUnicodeChars('café résumé'); // 3 (é, é, é)
   * StringUtils.countUnicodeChars('naïve coöperate'); // 3 (ï, ö, ë)
   * 
   * // Count emoji and symbols
   * StringUtils.countUnicodeChars('Hello 👋 World! 🌍'); // 2 (👋, 🌍)
   * StringUtils.countUnicodeChars('Price: $100 → €85'); // 1 (→)
   * 
   * // Count characters from other languages
   * StringUtils.countUnicodeChars('Здравствуй мир'); // 13 (all Cyrillic characters)
   * StringUtils.countUnicodeChars('こんにちは世界'); // 7 (all Japanese characters)
   * StringUtils.countUnicodeChars('مرحبا بالعالم'); // 11 (all Arabic characters)
   * 
   * // Mixed ASCII and Unicode
   * StringUtils.countUnicodeChars('café in München'); // 4 (a, é, ü, e)
   * StringUtils.countUnicodeChars('Temperature: 25°C'); // 1 (°)
   * StringUtils.countUnicodeChars('Math: α + β = γ'); // 3 (α, β, γ)
   * 
   * // ASCII only (no Unicode characters)
   * StringUtils.countUnicodeChars('Hello World 123!'); // 0
   * StringUtils.countUnicodeChars('test@email.com'); // 0
   * StringUtils.countUnicodeChars('ABC123xyz'); // 0
   * 
   * // Edge cases
   * StringUtils.countUnicodeChars(''); // 0
   * StringUtils.countUnicodeChars(null); // 0
   * StringUtils.countUnicodeChars(undefined); // 0
   * 
   * // Complex Unicode sequences (surrogate pairs)
   * StringUtils.countUnicodeChars('🏳️‍🌈🏳️‍⚧️'); // 2 (rainbow flag, trans flag)
   * StringUtils.countUnicodeChars('👨‍👩‍👧‍👦'); // 1 (family emoji as single unit)
   * ```
   *
   * @note This method uses a regular expression with the Unicode flag (`/[^\x00-\x7F]/gu`) to
   * properly detect and count Unicode characters, including those represented by surrogate pairs.
   * ASCII characters (codes 0x00 to 0x7F) include standard English letters, digits, punctuation,
   * and control characters. All other characters are considered Unicode and will be counted.
   * This method is useful for text analysis, internationalization validation, content filtering,
   * and determining the complexity of multilingual text content.
   */
  static countUnicodeChars(str) {
    if (!str) return 0;
    const matches = str.match(/[^\x00-\x7F]/gu);
    return matches ? matches.length : 0;
  }
  ///////////////////////////////////////////////////////////////////////////////////
  /**
   * Truncate a string to a specified maximum length and append ellipsis if needed.
   *
   * Shortens a string to fit within the specified length limit by removing characters from the end
   * and appending "..." (ellipsis) to indicate truncation. The ellipsis counts toward the total
   * length, so the actual content will be 3 characters shorter than the specified length when
   * truncation occurs. If the string is already within the length limit, it is returned unchanged.
   * Strings shorter than 4 characters are never truncated to avoid creating meaningless results.
   *
   * @param value - The input string to potentially truncate. Returns unchanged if null, undefined, or empty.
   * @param len - The maximum allowed length for the output string, including the ellipsis when truncation occurs.
   * @returns The truncated string with "..." appended if truncation occurred, or the original string if no truncation was needed.
   *
   * @example
   * ```typescript
   * // Basic truncation examples
   * StringUtils.truncate('Hello World', 8); // 'Hello...'
   * StringUtils.truncate('Short', 10); // 'Short' (no truncation needed)
   * StringUtils.truncate('This is a very long sentence', 15); // 'This is a ve...'
   * 
   * // Edge cases with short strings
   * StringUtils.truncate('Hi', 1); // 'Hi' (too short to truncate)
   * StringUtils.truncate('ABC', 3); // 'ABC' (exactly at minimum length)
   * StringUtils.truncate('Test', 3); // 'Test' (won't truncate strings <= 3 chars)
   * 
   * // User interface examples
   * StringUtils.truncate('user@verylongdomainname.com', 20); // 'user@verylongdom...'
   * StringUtils.truncate('Very Long Product Name Here', 25); // 'Very Long Product Nam...'
   * StringUtils.truncate('Article Title That Goes On Forever', 30); // 'Article Title That Goes On...'
   * 
   * // Table cell content truncation
   * StringUtils.truncate('Customer Name With Many Middle Names', 15); // 'Customer Nam...'
   * StringUtils.truncate('$1,234.56', 15); // '$1,234.56' (no truncation)
   * 
   * // Handle null/undefined/empty inputs
   * StringUtils.truncate('', 10); // ''
   * StringUtils.truncate(null, 10); // null
   * StringUtils.truncate(undefined, 10); // undefined
   * 
   * // Exact length boundary testing
   * StringUtils.truncate('Exactly Ten', 11); // 'Exactly Ten' (exact fit)
   * StringUtils.truncate('Exactly Eleven!', 11); // 'Exactly ...' (truncated)
   * ```
   *
   * @note This method is designed to preserve readability by ensuring truncated strings always
   * end with "..." to clearly indicate that content has been omitted. The 3-character minimum
   * prevents creating confusing results like "..." for very short strings. This method is
   * commonly used in user interfaces for displaying long text in constrained spaces such as
   * table cells, tooltips, breadcrumbs, and list items. For precise control over truncation
   * without ellipsis, consider using string.substring() directly.
   */
  static truncate(value, len) {
    if (value && value.length > len && value.length > 3)
      return value.substring(0, len - 3) + "...";
    else
      return value;
  }
  /////////////////////////////////////////////////////////////////////////////////
  /**
   * Convert a string to title case (also known as mixed case or proper case).
   *
   * Transforms text by capitalizing the first letter of each word while leaving the rest
   * of each word unchanged. Uses a regular expression to match the beginning of the string
   * and any character that follows whitespace, then converts those characters to uppercase.
   * This preserves the original casing of characters within words while ensuring consistent
   * capitalization at word boundaries. Particularly useful for creating human-readable labels
   * from various text formats.
   *
   * @param str - The input string to convert to title case.
   * @returns A new string with the first letter of each word capitalized, preserving other character casing.
   *
   * @example
   * ```typescript
   * // Basic title case conversion
   * StringUtils.toMixedCase('hello world'); // 'Hello World'
   * StringUtils.toMixedCase('the quick brown fox'); // 'The Quick Brown Fox'
   * StringUtils.toMixedCase('javascript programming'); // 'Javascript Programming'
   * 
   * // Preserves existing uppercase within words
   * StringUtils.toMixedCase('iPhone and iPad'); // 'IPhone And IPad'
   * StringUtils.toMixedCase('HTML and CSS'); // 'HTML And CSS'
   * StringUtils.toMixedCase('XMLHttpRequest'); // 'XMLHttpRequest'
   * 
   * // Handles various whitespace scenarios
   * StringUtils.toMixedCase('  leading spaces'); // '  Leading Spaces'
   * StringUtils.toMixedCase('multiple   spaces'); // 'Multiple   Spaces'
   * StringUtils.toMixedCase('tab\tseparated'); // 'Tab\tSeparated'
   * StringUtils.toMixedCase('line\nbreak'); // 'Line\nBreak'
   * 
   * ```
   */
  static toMixedCase(str) {
    return str.replace(/\S+/g, (word) => {
      if (word.length === 0) return word;
      const first = word.charAt(0).toUpperCase();
      const rest = word.slice(1).toLowerCase();
      return first + rest;
    });
  }
  /////////////////////////////////////////////////////////////////////////////////
  /**
   * Convert a past date into a human-readable relative time string.
   *
   * Calculates the time difference between a past date and a reference date (default: current time)
   * and returns a user-friendly description of how long ago the past date occurred. The method
   * provides increasingly less precise descriptions for older dates, making it ideal for social
   * media feeds, activity logs, and user interfaces where approximate timing is more important
   * than exact precision. Uses natural language patterns that are familiar to users.
   *
   * @param past - The past date to compare against the reference time.
   * @param now - The reference date to compare against. Defaults to the current date/time if not provided.
   * @returns A human-readable string describing how long ago the past date occurred relative to the reference date.
   *
   * @example
   * ```typescript
   * const now = new Date('2023-06-15T12:00:00Z');
   * 
   * // Very recent times (less than 1 second)
   * const justNow : Date = new Date('2023-06-15T12:00:00Z');
   * StringUtils.getRelativeTime(justNow, now); // 'just now'
   * 
   * // Seconds ago (1-59 seconds)
   * const seconds30 : Date = new Date('2023-06-15T11:59:30Z');
   * StringUtils.getRelativeTime(seconds30, now); // '30 seconds ago'
   * const second1 : Date = new Date('2023-06-15T11:59:59Z');
   * StringUtils.getRelativeTime(second1, now); // '1 second ago' (singular)
   * 
   * ```
   */
  static getRelativeTime(past, now = /* @__PURE__ */ new Date()) {
    const seconds = Math.floor((now.getTime() - past.getTime()) / 1e3);
    if (seconds < 1) return "just now";
    if (seconds < 60) return `${seconds} second${seconds !== 1 ? "s" : ""} ago`;
    const minutes = seconds / 60;
    if (minutes < 60) return `${Math.floor(minutes)} minute${Math.floor(minutes) !== 1 ? "s" : ""} ago`;
    const hours = minutes / 60;
    if (hours < 24) return `${parseFloat(hours.toFixed(1))} hour${hours < 2 ? "" : "s"} ago`;
    const days = hours / 24;
    if (days < 2) return "yesterday";
    if (days < 7) return `${Math.floor(days)} days ago`;
    if (days < 30) return "over a week ago";
    if (days < 60) return "over a month ago";
    return "some time ago";
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Convert a time period in milliseconds to a compact human-readable string.
   *
   * Takes a time duration in milliseconds and converts it to a compact format using
   * abbreviated time units (w, d, h, m) for weeks, days, hours, and minutes.
   * Only displays non-zero time units and omits seconds for simplicity.
   *
   * @param time - The time period in milliseconds to convert.
   * @returns A compact string representation (e.g., "1d 1h 5m") or "0" if time is zero.
   *
   * @example
   * StringUtils.periodToString(0); // "0"
   * StringUtils.periodToString(90300000); // "1d 1h 5m"
   * StringUtils.periodToString(3600000); // "1h"
   * StringUtils.periodToString(60000); // "1m"
   */
  static periodToString(time) {
    if (time === 0) return "0";
    const totalMinutes = Math.floor(time / (1e3 * 60));
    if (totalMinutes === 0) return "0";
    const weeks = Math.floor(totalMinutes / (7 * 24 * 60));
    const days = Math.floor(totalMinutes % (7 * 24 * 60) / (24 * 60));
    const hours = Math.floor(totalMinutes % (24 * 60) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (weeks > 0) parts.push(`${weeks}w`);
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    return parts.join(" ");
  }
  /*
      /////////////////////////////////////////////////////////////////////////////////////////////////////////////
      public static base64ToUint8Array( base64String: string ) : Uint8Array
      {
          const padding : string = "=".repeat((4 - base64String.length % 4) % 4);
          const base64  : string = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
          const rawData : string = window.atob(base64);
          const outputArray : Uint8Array = new Uint8Array(rawData.length);
          let i : number;
          for ( i = 0; i < rawData.length; i++ )
          {
              outputArray[i] = rawData.charCodeAt(i);
          }
          return outputArray;
      }
  */
  /////////////////////////////////////////////////////////////////////////////////////////////////////////////
  static textSimilarity(s1, s2, type = "jw") {
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;
    function sorensenDice(a, b) {
      const getBigrams = (str) => {
        const bigrams = [];
        for (let i = 0; i < str.length - 1; i++) bigrams.push(str.substring(i, i + 2));
        return bigrams;
      };
      const l1 = a.length - 1;
      const l2 = b.length - 1;
      if (l1 < 1 || l2 < 1) return 0;
      const b1 = getBigrams(a);
      const b2 = getBigrams(b);
      let intersection = 0;
      for (let i = 0; i < l1; i++) {
        for (let j = 0; j < l2; j++) {
          if (b1[i] === b2[j]) {
            intersection++;
            b2[j] = null;
            break;
          }
        }
      }
      return 2 * intersection / (l1 + l2);
    }
    function cosineSimilarity(a, b) {
      const vecMagnitude = (vec) => Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      const freq = (str) => str.split(" ").reduce((acc, w) => {
        acc[w] = (acc[w] ?? 0) + 1;
        return acc;
      }, {});
      const f1 = freq(a);
      const f2 = freq(b);
      const dict = {};
      for (const k in f1) dict[k] = true;
      for (const k in f2) dict[k] = true;
      const v1 = [];
      const v2 = [];
      for (const term in dict) {
        v1.push(f1[term] ?? 0);
        v2.push(f2[term] ?? 0);
      }
      const product = v1.reduce((sum, v, i) => sum + v * v2[i], 0);
      return product / (vecMagnitude(v1) * vecMagnitude(v2));
    }
    function jaroWinkler(a, b) {
      const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
      const m1 = new Array(a.length).fill(false);
      const m2 = new Array(b.length).fill(false);
      let matches = 0;
      for (let i = 0; i < a.length; i++) {
        const lo = Math.max(0, i - range);
        const hi = Math.min(i + range, b.length - 1);
        for (let j = lo; j <= hi; j++) {
          if (!m1[i] && !m2[j] && a[i] === b[j]) {
            m1[i] = m2[j] = true;
            matches++;
            break;
          }
        }
      }
      if (!matches) return 0;
      let transpositions = 0;
      let k = 0;
      for (let i = 0; i < a.length; i++) {
        if (m1[i]) {
          while (!m2[k]) k++;
          if (a[i] !== b[k]) transpositions++;
          k++;
        }
      }
      let weight = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
      let prefix = 0;
      while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
      weight += prefix * 0.1 * (1 - weight);
      return weight;
    }
    switch (type) {
      case "sd":
        return sorensenDice(s1, s2);
      case "cs":
        return cosineSimilarity(s1, s2);
      default:
        return jaroWinkler(s1, s2);
    }
  }
};

// ../../../packages/common/src/utils/ByteUtils.ts
var ByteUtils = class _ByteUtils {
  /** Binary (1024-based) size units, in bytes. */
  static KB = 1024;
  static MB = _ByteUtils.KB * 1024;
  static GB = _ByteUtils.MB * 1024;
  static TB = _ByteUtils.GB * 1024;
  //////////////////////////////////////////////////////////////////////////////////
  /**
   * Convert a file size in bytes to a human-readable string with appropriate units.
   *
   * Converts a numeric byte value into a formatted string using binary units (1024-based)
   * with appropriate suffixes (B, KB, MB, GB, TB). The method automatically selects the
   * most appropriate unit to display a readable number (typically between 1-1023) and
   * formats the result with a specified number of decimal places. Uses standard binary
   * prefixes where 1 KB = 1024 bytes, following common file system conventions.
   *
   * @param size - The file size in bytes to convert. Must be a non-negative number.
   * @param digits - The number of decimal places to display in the formatted output. Defaults to 1.
   * @returns A formatted string representing the file size with appropriate units (B, KB, MB, GB, TB).
   *
   * @example
   * ```typescript
   * // Basic file size conversions
   * ByteUtils.toString(0); // '0 B'
   * ByteUtils.toString(512); // '512.0 B'
   * ByteUtils.toString(1024); // '1.0 KB'
   * ByteUtils.toString(1536); // '1.5 KB'
   * 
   * // Various file sizes with default 1 decimal place
   * ByteUtils.toString(2048); // '2.0 KB'
   * ByteUtils.toString(1048576); // '1.0 MB' (1024² bytes)
   * ByteUtils.toString(1073741824); // '1.0 GB' (1024³ bytes)
   * ByteUtils.toString(1099511627776); // '1.0 TB' (1024⁴ bytes)
   * 
   * // Custom decimal precision
   * ByteUtils.toString(1536, 0); // '2 KB' (no decimals, rounded)
   * ByteUtils.toString(1536, 2); // '1.50 KB' (2 decimal places)
   * ByteUtils.toString(1536, 3); // '1.500 KB' (3 decimal places)
   * 
   * ```
   *
   * @note This method uses binary (base-1024) units following the traditional computing convention
   * where 1 KB = 1024 bytes, 1 MB = 1024² bytes, etc. This differs from decimal (base-1000) units
   * sometimes used in marketing where 1 KB = 1000 bytes. The method handles sizes up to terabytes
   * (TB) and will display very large files in TB units. For files larger than the TB range, the
   * result may not be as meaningful. The decimal formatting uses toFixed() which rounds the result
   * to the specified number of decimal places. This method is commonly used in file managers,
   * upload progress indicators, and storage analytics displays.
   */
  static toString(size, digits = 1) {
    if (size == 0) return "0 B";
    let i = Math.floor(Math.log(size) / Math.log(1024));
    let fsize = size / Math.pow(_ByteUtils.KB, i);
    return fsize.toFixed(digits) + " " + ["B", "KB", "MB", "GB", "TB"][i];
  }
};

// ../../../packages/common/src/utils/ResultUtils.ts
var ResultUtils;
((ResultUtils2) => {
  function ok(data) {
    return { ok: true, data };
  }
  ResultUtils2.ok = ok;
  function err(error, cause) {
    return { ok: false, error, cause };
  }
  ResultUtils2.err = err;
  function message(cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
  ResultUtils2.message = message;
  async function from(fn) {
    try {
      return { ok: true, data: await fn() };
    } catch (cause) {
      return { ok: false, error: message(cause), cause };
    }
  }
  ResultUtils2.from = from;
  function attempt(fn) {
    try {
      return { ok: true, data: fn() };
    } catch (cause) {
      return { ok: false, error: message(cause), cause };
    }
  }
  ResultUtils2.attempt = attempt;
})(ResultUtils || (ResultUtils = {}));
var ResultUtils_default = ResultUtils;

// ../../../packages/common/src/utils/NetworkUtils.ts
var NetworkUtils;
((NetworkUtils2) => {
  let Status;
  ((Status2) => {
    Status2[Status2["OK"] = 200] = "OK";
    Status2[Status2["CREATED"] = 201] = "CREATED";
    Status2[Status2["ACCEPTED"] = 202] = "ACCEPTED";
    Status2[Status2["NON_AUTHORITATIVE_INFO"] = 203] = "NON_AUTHORITATIVE_INFO";
    Status2[Status2["NO_CONTENT"] = 204] = "NO_CONTENT";
    Status2[Status2["PARTIAL_CONTENT"] = 206] = "PARTIAL_CONTENT";
    Status2[Status2["MULTI_STATUS"] = 207] = "MULTI_STATUS";
    Status2[Status2["ALREADY_REPORTED"] = 208] = "ALREADY_REPORTED";
    Status2[Status2["IM_USED"] = 226] = "IM_USED";
    Status2[Status2["MULTIPLE_CHOICES"] = 300] = "MULTIPLE_CHOICES";
    Status2[Status2["MOVED_PERMANENTLY"] = 301] = "MOVED_PERMANENTLY";
    Status2[Status2["FOUND"] = 302] = "FOUND";
    Status2[Status2["SEE_OTHER"] = 303] = "SEE_OTHER";
    Status2[Status2["NOT_MODIFIED"] = 304] = "NOT_MODIFIED";
    Status2[Status2["USE_PROXY"] = 305] = "USE_PROXY";
    Status2[Status2["TEMP_REDIRECT"] = 307] = "TEMP_REDIRECT";
    Status2[Status2["PERMANENT_REDIRECT"] = 308] = "PERMANENT_REDIRECT";
    Status2[Status2["BAD_REQUEST"] = 400] = "BAD_REQUEST";
    Status2[Status2["UNAUTHORIZED"] = 401] = "UNAUTHORIZED";
    Status2[Status2["PAYMENT_REQD"] = 402] = "PAYMENT_REQD";
    Status2[Status2["FORBIDDEN"] = 403] = "FORBIDDEN";
    Status2[Status2["NOT_FOUND"] = 404] = "NOT_FOUND";
    Status2[Status2["NOT_ALLOWED"] = 405] = "NOT_ALLOWED";
    Status2[Status2["NOT_ACCEPTED"] = 406] = "NOT_ACCEPTED";
    Status2[Status2["PROXY_AUTH_REQD"] = 407] = "PROXY_AUTH_REQD";
    Status2[Status2["REQUEST_TIMEOUT"] = 408] = "REQUEST_TIMEOUT";
    Status2[Status2["CONFLICT"] = 409] = "CONFLICT";
    Status2[Status2["GONE"] = 410] = "GONE";
    Status2[Status2["LENGTH_REQD"] = 411] = "LENGTH_REQD";
    Status2[Status2["PRE_CONDITION_FAILED"] = 412] = "PRE_CONDITION_FAILED";
    Status2[Status2["REQUEST_ENTITY_TOO_LONG"] = 413] = "REQUEST_ENTITY_TOO_LONG";
    Status2[Status2["REQUEST_URI_TOO_LONG"] = 414] = "REQUEST_URI_TOO_LONG";
    Status2[Status2["UNSUPPORTED_MEDIA_TYPE"] = 415] = "UNSUPPORTED_MEDIA_TYPE";
    Status2[Status2["REQUESTED_RANGE_NOT_SATISFIABLE"] = 416] = "REQUESTED_RANGE_NOT_SATISFIABLE";
    Status2[Status2["EXPECTATION_FAILED"] = 417] = "EXPECTATION_FAILED";
    Status2[Status2["MISDIRECTED_REQUEST"] = 421] = "MISDIRECTED_REQUEST";
    Status2[Status2["UNPROCESSABLE_ENTITY"] = 422] = "UNPROCESSABLE_ENTITY";
    Status2[Status2["LOCKED"] = 423] = "LOCKED";
    Status2[Status2["FAILED_DEPENDENCY"] = 424] = "FAILED_DEPENDENCY";
    Status2[Status2["TOO_EARLY"] = 425] = "TOO_EARLY";
    Status2[Status2["UPGRADE_REQUIRED"] = 426] = "UPGRADE_REQUIRED";
    Status2[Status2["PRECONDITION_REQUIRED"] = 428] = "PRECONDITION_REQUIRED";
    Status2[Status2["TOO_MANY_REQUESTS"] = 429] = "TOO_MANY_REQUESTS";
    Status2[Status2["REQUEST_HEADER_TOO_LARGE"] = 431] = "REQUEST_HEADER_TOO_LARGE";
    Status2[Status2["UNAVAILABLE_FOR_LEGAL_REASONS"] = 451] = "UNAVAILABLE_FOR_LEGAL_REASONS";
    Status2[Status2["INTERNAL_SERVER_ERROR"] = 500] = "INTERNAL_SERVER_ERROR";
    Status2[Status2["NOT_IMPLEMENTED"] = 501] = "NOT_IMPLEMENTED";
    Status2[Status2["BAD_GATEWAY"] = 502] = "BAD_GATEWAY";
    Status2[Status2["SERVICE_UNAVAIL"] = 503] = "SERVICE_UNAVAIL";
    Status2[Status2["GATEWAY_TIMEOUT"] = 504] = "GATEWAY_TIMEOUT";
    Status2[Status2["HTTP_VERSION_NOT_SUPPORTED"] = 505] = "HTTP_VERSION_NOT_SUPPORTED";
    Status2[Status2["VARIANT_ALSO_NEGOTIATES"] = 506] = "VARIANT_ALSO_NEGOTIATES";
    Status2[Status2["INSUFFICIENT_STORAGE"] = 507] = "INSUFFICIENT_STORAGE";
    Status2[Status2["LOOP_DETECTED"] = 508] = "LOOP_DETECTED";
    Status2[Status2["NOT_EXTENDED"] = 510] = "NOT_EXTENDED";
    Status2[Status2["NETWORK_AUTH_REQUIRED"] = 511] = "NETWORK_AUTH_REQUIRED";
  })(Status = NetworkUtils2.Status || (NetworkUtils2.Status = {}));
  let Protocol;
  ((Protocol2) => {
    Protocol2["FILE"] = "file";
    Protocol2["HTTP"] = "http";
    Protocol2["HTTPS"] = "https";
    Protocol2["SFTP"] = "sftp";
    Protocol2["WS"] = "ws";
    Protocol2["WSS"] = "wss";
  })(Protocol = NetworkUtils2.Protocol || (NetworkUtils2.Protocol = {}));
  NetworkUtils2.PROTOCOL_SEPARATOR = "://";
  let HeaderType;
  ((HeaderType2) => {
    HeaderType2["CONTENT"] = "Content-Type";
  })(HeaderType = NetworkUtils2.HeaderType || (NetworkUtils2.HeaderType = {}));
  let Method;
  ((Method2) => {
    Method2["GET"] = "GET";
    Method2["PUT"] = "PUT";
    Method2["POST"] = "POST";
    Method2["DELETE"] = "DELETE";
    Method2["HEAD"] = "HEAD";
    Method2["PATCH"] = "PATCH";
    Method2["OPTIONS"] = "OPTIONS";
  })(Method = NetworkUtils2.Method || (NetworkUtils2.Method = {}));
  let MimeType;
  ((MimeType2) => {
    MimeType2["JSON"] = "application/json";
    MimeType2["XML"] = "application/xml";
    MimeType2["BIN"] = "application/octet-stream";
    MimeType2["GZIP"] = "application/gzip";
    MimeType2["TAR"] = "application/x-tar";
    MimeType2["ZIP"] = "application/zip";
    MimeType2["PDF"] = "application/pdf";
    MimeType2["TEXT"] = "text/plain";
    MimeType2["HTML"] = "text/html";
    MimeType2["CSS"] = "text/css";
    MimeType2["CSV"] = "text/csv";
    MimeType2["ICS"] = "text/ics";
    MimeType2["JS"] = "text/javascript";
    MimeType2["MP3"] = "audio/mpeg";
    MimeType2["WAVE"] = "audio/wav";
    MimeType2["MP4"] = "video/mp4";
    MimeType2["MPEG"] = "video/mpeg";
    MimeType2["JPEG"] = "image/jpeg";
    MimeType2["PNG"] = "image/png";
    MimeType2["GIF"] = "image/gif";
    MimeType2["BMP"] = "image/bmp";
  })(MimeType = NetworkUtils2.MimeType || (NetworkUtils2.MimeType = {}));
  function toUrl(path2) {
    return url(path2.protocol, path2.domain, path2.port, path2.path, path2.parameters);
  }
  NetworkUtils2.toUrl = toUrl;
  function url(protocol, host, port, uri, parameters) {
    let built = protocol;
    built += "://";
    built += host;
    if (port !== null && port > 0) {
      built += ":";
      built += port;
    }
    if (uri) {
      if (uri.charAt(0) != "/") built += "/";
      built += uri;
    }
    if (parameters) {
      const keys = Object.keys(parameters);
      keys.forEach((key, index) => {
        built += index === 0 ? "?" : "&";
        built += StringUtils.format("{0}={1}", key, parameters[key]);
      });
    }
    return built;
  }
  NetworkUtils2.url = url;
  function uriParts(request_uri) {
    let str = request_uri.toLowerCase();
    let reqs = str.split("/");
    reqs = reqs.filter((n) => n);
    return reqs;
  }
  NetworkUtils2.uriParts = uriParts;
  function parseUrl(full_url) {
    let parsed = null;
    try {
      parsed = new URL(full_url);
    } catch {
      parsed = null;
    }
    let parameters = {};
    let protocol = parsed ? StringUtils.removeTrailing(parsed.protocol, ":") : "https" /* HTTPS */;
    let hash = "";
    let params = parsed ? parsed.search : "";
    if (params && params != "") {
      params = params.substring(1);
      let params_parts = [];
      if (params.indexOf("#") > 0) {
        params_parts = params.split("#");
        params = params_parts[0];
        hash = params_parts[1];
      }
      params_parts = params.split("&");
      params_parts.forEach((parts, index) => {
        let nv = parts.split("=");
        parameters[nv[0]] = nv[1];
      });
    }
    const std_ports = { http: 80, https: 443, ftp: 21, file: 80, smtp: 25, ssh: 22 };
    return {
      protocol,
      domain: parsed ? parsed.hostname : "",
      port: parsed && parsed.port ? parseInt(parsed.port) : std_ports[protocol],
      // odd use case:
      // ignore trailing "/" in pathname so full domains can be parsed ( e.g. https://google.com )
      // unless the user set the trailing "/"
      path: parsed ? correctPath(full_url, parsed.pathname) : "",
      parameters,
      hash
    };
  }
  NetworkUtils2.parseUrl = parseUrl;
  function correctPath(original_url, path2) {
    const orig_trailing_slash = original_url.endsWith("/");
    let newPath = path2;
    if (newPath.length >= 1 && newPath.endsWith("/")) {
      newPath = newPath.slice(0, -1);
    }
    if (orig_trailing_slash && !newPath.endsWith("/")) {
      newPath += "/";
    }
    return newPath;
  }
  function sameUri(request_uri, endpt_uri) {
    return sameUriArray(uriParts(request_uri), uriParts(endpt_uri));
  }
  NetworkUtils2.sameUri = sameUri;
  function sameUriArray(request_uri, endpt_uri) {
    request_uri = [...request_uri];
    endpt_uri = [...endpt_uri];
    if (request_uri[request_uri.length - 1].indexOf("?") > 0) {
      request_uri[request_uri.length - 1] = request_uri[request_uri.length - 1].substring(0, request_uri[request_uri.length - 1].lastIndexOf("?"));
    }
    if (endpt_uri[endpt_uri.length - 1] == "*") {
      endpt_uri.pop();
      while (request_uri.length > endpt_uri.length) {
        request_uri.pop();
      }
    }
    let i;
    let len = endpt_uri.length;
    for (i = 0; i < len; i++) {
      if (endpt_uri[i].charAt(0) == ":") {
        if (request_uri[i] != void 0) {
          request_uri[i] = endpt_uri[i];
        } else if (i == len - 1 && endpt_uri[i].charAt(endpt_uri[i].length - 1) == "?") {
          endpt_uri.splice(i, 1);
          break;
        } else {
          return false;
        }
      }
    }
    if (request_uri.length !== endpt_uri.length) return false;
    return request_uri.join("/") === endpt_uri.join("/");
  }
  NetworkUtils2.sameUriArray = sameUriArray;
  const HOSTNAME = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  const OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
  function isUrl(value) {
    try {
      const parts = new URL(value);
      const protocolValid = parts.protocol === "http:" || parts.protocol === "https:";
      return protocolValid && HOSTNAME.test(parts.hostname);
    } catch {
      return false;
    }
  }
  NetworkUtils2.isUrl = isUrl;
  function isHostname(hostname) {
    return StringUtils.isValid(hostname) && HOSTNAME.test(hostname);
  }
  NetworkUtils2.isHostname = isHostname;
  function isIpAddress(value) {
    if (!StringUtils.isValid(value)) return false;
    const parts = value.split(".");
    return parts.length === 4 && parts.every((octet) => OCTET.test(octet));
  }
  NetworkUtils2.isIpAddress = isIpAddress;
})(NetworkUtils || (NetworkUtils = {}));

// ../../../packages/common/src/utils/DateUtils.ts
var DateUtils = class _DateUtils {
  /////////////////////////////////////////////////////////////////////////////////
  /** True if `value` is a `Date` instance (moved from `Validator.isDate`). Note: doesn't check
   *  validity of the date's time value — use `!Number.isNaN(value.getTime())` for that. */
  static isValid(value) {
    return value instanceof Date;
  }
  /////////////////////////////////////////////////////////////////////////////////
  /**
   * Parse a value into a Date object.
   *
   * Accepts numbers (timestamps in seconds, milliseconds, or microseconds), strings (ISO 8601 or 
   * simple date formats), or null/undefined values. Automatically detects timestamp precision
   * based on the number of digits: 10 digits = seconds, 13 digits = milliseconds, 
   * other lengths = microseconds.
   *
   * @param value - The value to parse. Can be a timestamp number, date string, or null/undefined.
   * @returns A Date object if parsing succeeds, null if the input is null/undefined or invalid.
   *
   * @example
   * DateUtils.parse(1753059107); // Date from seconds timestamp
   * DateUtils.parse(1753059107136); // Date from milliseconds timestamp
   * DateUtils.parse('2025-01-15'); // Date from ISO string
   * DateUtils.parse('2025/12/3'); // Date from simple format
   * DateUtils.parse(null); // null
   */
  static parse(value) {
    if (value === void 0 || value === null) {
      return null;
    } else if (NumberUtils.isValid(value) || StringUtils.isValid(value) && /^\d+$/.test(value)) {
      const num_value = parseInt(value.toString());
      const value_str = value.toString();
      if (value_str.length === 10)
        return new Date(num_value * 1e3);
      else if (value_str.length === 13)
        return new Date(num_value);
      else
        return new Date(num_value / 1e3);
    } else if (StringUtils.isValid(value) && value.trim() !== "") {
      const value_trimmed = value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(value_trimmed)) {
        return /* @__PURE__ */ new Date(value_trimmed + "T00:00:00");
      } else
        return new Date(value_trimmed);
    } else {
      return null;
    }
  }
  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  static compare(a, b, dir) {
    const at = a ? a.getTime() : 0;
    const bt = b ? b.getTime() : 0;
    return (at - bt) * dir;
  }
  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Checks if a date falls between two boundary dates (inclusive).
   *
   * Returns true if the date is within the specified range, or if any of the parameters are null.
   * The comparison is inclusive, meaning the date can equal the start or end dates.
   * If the date parameter is null, the function returns true (no date to validate).
   *
   * @param start_date - The start boundary date (inclusive). If null, no lower bound is applied.
   * @param end_date - The end boundary date (inclusive). If null, no upper bound is applied.
   * @param date - The date to check. If null, returns true.
   * @returns True if the date is between start_date and end_date (inclusive), or if date is null.
   *
   * @example
   * const start : Date = new Date('2025-01-01');
   * const end : Date = new Date('2025-12-31');
   * const testDate : Date = new Date('2025-06-15');
   * DateUtils.between(start, end, testDate); // true
   * 
   * DateUtils.between(null, end, testDate); // true (no start boundary)
   * DateUtils.between(start, null, testDate); // true (no end boundary)
   * DateUtils.between(start, end, null); // true (no date to validate)
   */
  static between(start_date, end_date, date) {
    if (!date) return true;
    const time = date.getTime();
    if (start_date && time < start_date.getTime()) return false;
    if (end_date && time > end_date.getTime()) return false;
    return true;
  }
  //////////////////////////////////////////////////////////////////////////////////////////////////////
  // NOTE: date <-> IANA-timezone conversion lives in **TimeZoneUtils** — "current wall-clock in a zone"
  // is `TimeZoneUtils.nowIn(tz)` (returns a Type.ZonedDateTime, not a Date that misrepresents the
  // instant). DateUtils keeps machine-local + general date helpers; zoned conversion is not here.
  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Returns a new Date object representing the start of the day (midnight) for the given date in local time.
   *
   * Note: this intentionally uses local time (setHours), not UTC (setUTCHours).
   */
  static startOfDay(date) {
    const newdate = new Date(date);
    newdate.setHours(0, 0, 0, 0);
    return newdate;
  }
  ////////////////////////////////////////////////////////////////////////////
  /**
   * Returns a new Date object representing the end of the day (just before midnight) for the given date in local time.
   *
   * Note: this intentionally uses local time (setHours), not UTC (setUTCHours).
   */
  static endOfDay(date) {
    const newdate = new Date(date);
    newdate.setHours(23, 59, 59, 999);
    return newdate;
  }
  ////////////////////////////////////////////////////////////////////////////
  /**
       * Converts a Date object to an ISO 8601-like string using the date's local time components.
       *
  
       * @param date - The date to convert to a local string representation.
       * @returns A string in ISO 8601 format using local time components, ending with "Z".
       *
       * @example
       * const date = new Date('2025-01-15T14:30:45.123');
       * DateUtils.toLocalString(date);
       * // Returns: "2025-01-15T14:30:45.123Z" (using local time components)
       * 
       * // Compare with native toISOString() which uses UTC
       * date.toISOString();
       * // Returns: "2025-01-15T19:30:45.123Z" (if local timezone is UTC-5)
       */
  static toLocalString(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0") + "T" + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0") + ":" + String(date.getSeconds()).padStart(2, "0") + "." + String(date.getMilliseconds()).padStart(3, "0") + "Z";
  }
  ////////////////////////////////////////////////////////////////////////////
  /**
   * Converts a Date object to an ISO 8601 date string (YYYY-MM-DD format) or returns empty string for null.
   *
   * @param date - The date to convert to ISO date string, or null.
   * @returns A string in "YYYY-MM-DD" format, or empty string if date is null.
   *
   * @example
   * const date = new Date('2025-01-15T14:30:45.123Z');
   * DateUtils.toIsoDate(date); // "2025-01-15"
   */
  static toIsoDate(date) {
    return date ? date.toISOString().slice(0, 10) : "";
  }
  ////////////////////////////////////////////////////////////////////////////////////
  /**
   * Converts a Date object to an ISO 8601 datetime string (YYYY-MM-DDTHH:mm format) or returns empty string for null.
   *
   * @param date - The date to convert to ISO datetime string, or null.
   * @returns A string in "YYYY-MM-DDTHH:mm" format, or empty string if date is null.
   *
   * @example
   * const date = new Date('2025-01-15T14:30:45.123Z');
   * DateUtils.toIsoTime(date); // "2025-01-15T14:30"
   *
   */
  static toIsoTime(date) {
    return date ? date.toISOString().slice(0, 16) : "";
  }
  ////////////////////////////////////////////////////////////////////////////////////
  /**
   * Converts a Date object to an ISO 8601 to just the time portion. (e.g. "14:21")
   *
   * @param date - The date to convert to ISO datetime string, or null.
   * @returns A string in "YYYY-MM-DDTHH:mm" format, or empty string if date is null.
   *
   * @example
   * const date = new Date('2025-01-15T14:30:45.123Z');
   * DateUtils.toIsoTime(date); // "14:30"
   *
   */
  static toLocalTime(date) {
    return date ? StringUtils.format("{0}:{1}", StringUtils.leadingZero(date.getHours(), 2), StringUtils.leadingZero(date.getMinutes(), 2)) : "";
  }
  ////////////////////////////////////////////////////////////////////////////////////
  /**
   * Converts a Date object to a full ISO 8601 string (YYYY-MM-DDTHH:mm:ss.sssZ format) or returns empty string for null.
   *
   * @param date - The date to convert to full ISO string, or null.
   * @returns A string in "YYYY-MM-DDTHH:mm:ss.sssZ" format, or empty string if date is null.
   *
   * @example
   * const date = new Date('2025-01-15T14:30:45.123Z');
   * DateUtils.toIsoFull(date); // "2025-01-15T14:30:45.123Z"
   * };
   */
  static toIsoFull(date) {
    return date !== null ? date.toISOString() : "";
  }
  ////////////////////////////////////////////////////////////////////////////
  /**
   * Gets the local timezone offset from GMT/UTC in GMT±HHMM format.
   *
   * Calculates the current local timezone's offset from GMT/UTC and returns it as a
   * formatted string. The offset accounts for daylight saving time if applicable.
   *
   * @returns A string in "GMT±HHMM" format representing the local timezone offset.
   *
   * @example
   * // If running in Eastern Standard Time (UTC-5)
   * DateUtils.getLocalGMTOffset(); // "GMT-0500"
   * 
   */
  static getLocalGMTOffset() {
    const offset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
    const sign = offset > 0 ? "-" : "+";
    const absOffset = Math.abs(offset);
    const hours = Math.floor(absOffset / 60).toString().padStart(2, "0");
    const minutes = (absOffset % 60).toString().padStart(2, "0");
    return `GMT${sign}${hours}${minutes}`;
  }
  ////////////////////////////////////////////////////////////////////////////
  /**
   * Converts a Date object to an ISO 8601-like string using local time components (without timezone indicator).
   *
   * @param date - The date to convert to a local ISO string representation.
   * @returns A string in "YYYY-MM-DDTHH:mm:ss.sss" format using local time components (no timezone suffix).
   *
   * @example
   * const date = new Date('2025-01-15T14:30:45.123');
   * DateUtils.toLocalISOString(date);
   * // Returns: "2025-01-15T14:30:45.123" (using local time components, no Z suffix)
   */
  static toLocalISOString(date) {
    const pad = (n) => n.toString().padStart(2, "0");
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds()) + "." + date.getMilliseconds().toString().padStart(3, "0");
  }
  ////////////////////////////////////////////////////////////////////////////
  /**
   * Adds the specified number of minutes to a given date and returns a new Date object.
   * The original date object remains unchanged. Supports both positive and negative minute values
   * for adding or subtracting time respectively.
   * 
   * @param date - The base date to add minutes to. Must be a valid Date object.
   * @param minutes - The number of minutes to add. Can be positive (future) or negative (past).
   *                 Accepts decimal values for fractional minutes (e.g., 1.5 = 90 seconds).
   * @returns A new Date object representing the original date plus the specified minutes.
   *          Returns Invalid Date if the input date is invalid.
   * 
   * @example
   * ```typescript
   * // Add 30 minutes to current time
   * const now : Date = new Date();
   * const futureTime : Date = DateUtils.addMinutes(now, 30);
   * console.log(`30 minutes from now: ${futureTime.toISOString()}`);
   * ```
   */
  static addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * _DateUtils.Time.MINUTES_TO_MS);
  }
  ////////////////////////////////////////////////////////////////////////////
  /**
   * Adds the specified number of days to a given date and returns a new Date object.
   * The original date object remains unchanged. Supports both positive and negative day values
   * for adding or subtracting days respectively. The time component remains unchanged.
   * 
   * @param date - The base date to add days to. Must be a valid Date object.
   * @param days - The number of days to add. Can be positive (future) or negative (past).
   *               Accepts decimal values for fractional days (e.g., 0.5 = 12 hours).
   * @returns A new Date object representing the original date plus the specified days.
   *          Returns Invalid Date if the input date is invalid.
   * 
   * @example
   * ```typescript
   * // Add 7 days (one week) to current date
   * const today : Date = new Date();
   * const nextWeek : Date = DateUtils.addDays(today, 7);
   * console.log(`Next week: ${nextWeek.toISOString()}`);
   * ```
   */
  static addDays(date, days) {
    return new Date(date.getTime() + days * _DateUtils.Time.DAYS_TO_MS);
  }
  ////////////////////////////////////////////////////////////////////////////
  /**
   * Adds the specified number of hours to a given date and returns a new Date object.
   * The original date object remains unchanged. Supports both positive and negative hour values
   * for adding or subtracting time respectively. Returns null if the input date is null.
   * 
   * @param date - The base date to add hours to. Can be a valid Date object or null.
   *               If null, the function returns null without performing any operations.
   * @param hours - The number of hours to add. Can be positive (future) or negative (past).
   *                Accepts decimal values for fractional hours (e.g., 0.5 = 30 minutes).
   * @returns A new Date object representing the original date plus the specified hours,
   *          or null if the input date is null. Returns Invalid Date if the input date is invalid.
   * 
   * @example
   * ```typescript
   * // Add 3 hours to current time
   * const now : Date = new Date();
   * const threeHoursLater : Date = DateUtils.addHours(now, 3);
   * console.log(`3 hours from now: ${threeHoursLater?.toISOString()}`);
   * ```
   */
  static addHours(date, hours) {
    if (date === null) return null;
    return new Date(date.getTime() + hours * _DateUtils.Time.HOURS_TO_MS);
  }
  ////////////////////////////////////////////////////////////////////////////
  /**
   * Converts a 24-hour time string to 12-hour AM/PM format with zero-padded hours.
   * 
   * Parses time strings in "H:MM" or "HH:MM" format and converts them to 12-hour clock format
   * with AM/PM suffix. Hours greater than 23 are wrapped using modulo 24. If the input string
   * doesn't match the expected format, it returns the original string unchanged.
   * 
   * @param time - The time string to convert. Must be in "H:MM" or "HH:MM" format.
   *               Leading/trailing whitespace is automatically trimmed.
   * @returns A string in "HH:MM AM/PM" format, or the original string if parsing fails.
   * 
   * @example
   * ```typescript
   * // Standard 24-hour to 12-hour conversions
   * DateUtils.parseTimeTo12HourClock("14:30"); // "02:30 PM"
   * DateUtils.parseTimeTo12HourClock("09:15"); // "09:15 AM"
   * DateUtils.parseTimeTo12HourClock("00:00"); // "12:00 AM" (midnight)
   * DateUtils.parseTimeTo12HourClock("12:00"); // "12:00 PM" (noon)
   * DateUtils.parseTimeTo12HourClock("23:59"); // "11:59 PM"
   * ```
   */
  static parseTimeTo12HourClock(time) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!match) return time;
    let hour = parseInt(match[1], 10);
    const minute = match[2];
    hour = hour % 24;
    const ampm = hour < 12 ? "AM" : "PM";
    let hour12 = hour % 12;
    if (hour12 === 0) hour12 = 12;
    const hourStr = hour12.toString().padStart(2, "0");
    return `${hourStr}:${minute} ${ampm}`;
  }
  ////////////////////////////////////////////////////////////////////////////
  static hoursTo24String(time) {
    const hours = Math.floor(time);
    const minutes = Math.round((time - hours) * 60);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  ////////////////////////////////////////////////////////////////////////////
  static parseHoursToNumber(time) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!match) return 0;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    return hours + minutes / 60;
  }
  ////////////////////////////////////////////////////////////////////////////
  /**
   * Parses a date string and converts it to ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ).
   * 
   * Handles various date string formats and normalizes them to standard ISO format.
   * Special handling for datetime strings with AM/PM notation that contain 'T' separators.
   * Returns empty string for invalid dates or empty input.
   * 
   * @param dt - The date string to parse and convert. Can be in various formats including
   *             ISO dates, simple date formats, or datetime with AM/PM notation.
   *             Empty or falsy strings return empty string.
   * @returns A string in ISO 8601 format "YYYY-MM-DDTHH:mm:ss.sssZ", or empty string if parsing fails.
   * 
   * @example
   * ```typescript
   * // Standard ISO date parsing
   * DateUtils.parseDateToIso("2025-01-15"); // "2025-01-15T00:00:00.000Z"
   * DateUtils.parseDateToIso("2025-01-15T14:30:45"); // "2025-01-15T14:30:45.000Z"
   * ```
   */
  static parseDateToIso(dt) {
    if (!dt) return "";
    let normalized = dt;
    if (/T.*(AM|PM)/i.test(dt)) {
      normalized = dt.replace("T", " ");
    }
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return "";
    return date.toISOString();
  }
  ///////////////////////////////////////////////////////////////////
  /**
   * Converts a "HH:mm" time string to a Date object with today's date.
   * Returns null if input is falsy or invalid.
   *
   * @param time - Time string in "HH:mm" format.
   * @returns Date object with today's date and given time, or null.
   */
  static timeStringToDate(time) {
    if (!time) return null;
    const [h, m] = time.split(":");
    if (h === void 0 || m === void 0) return null;
    const d = /* @__PURE__ */ new Date();
    d.setHours(Number(h), Number(m), 0, 0);
    return d;
  }
  ///////////////////////////////////////////////////////////////////
  /**
   * Converts a Date object to a "HH:mm" time string.
   * Returns empty string if input is null.
   *
   * @param date - Date object.
   * @returns Time string in "HH:mm" format, or "".
   */
  static dateToTimeString(date) {
    if (!date) return "";
    return StringUtils.format(
      "{0}:{1}",
      StringUtils.leadingZero(date.getHours(), 2),
      StringUtils.leadingZero(date.getMinutes(), 2)
    );
  }
};
((DateUtils2) => {
  let Time;
  ((Time2) => {
    Time2.SECONDS_TO_MS = 1e3;
    Time2.MINUTES_TO_MS = 6e4;
    Time2.HOURS_TO_MS = 36e5;
    Time2.DAYS_TO_MS = 864e5;
  })(Time = DateUtils2.Time || (DateUtils2.Time = {}));
})(DateUtils || (DateUtils = {}));

// ../../../packages/common/src/utils/FileUtils.ts
var FileUtils = class _FileUtils {
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  static isImageMime(mime) {
    return /^image\//i.test(mime);
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  static isVideoMime(mime) {
    return /^video\//i.test(mime);
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  static isVCardMime(mime) {
    return mime === "text/vcard";
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  static parseMime(path2) {
    const ext = path2.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
    switch (ext) {
      // image
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "gif":
        return "image/gif";
      case "bmp":
        return "image/bmp";
      case "webp":
        return "image/webp";
      case "svg":
        return "image/svg+xml";
      case "tif":
      case "tiff":
        return "image/tiff";
      // video
      case "mp4":
        return _FileUtils.Mime.VIDEO_MP4;
      case "mov":
        return _FileUtils.Mime.VIDEO_MOV;
      case "avi":
        return _FileUtils.Mime.VIDEO_AVI;
      case "wmv":
        return _FileUtils.Mime.VIDEO_WMV;
      case "flv":
        return _FileUtils.Mime.VIDEO_FLV;
      case "webm":
        return _FileUtils.Mime.VIDEO_WEBM;
      case "mkv":
        return "video/x-matroska";
      case "m4v":
        return "video/x-m4v";
      case "3gp":
        return "video/3gpp";
      case "mpeg":
      case "mpg":
        return _FileUtils.Mime.VIDEO_MPEG;
      // audio
      case "mp3":
        return "audio/mpeg";
      case "wav":
        return "audio/wav";
      case "ogg":
        return "audio/ogg";
      case "aac":
        return "audio/aac";
      // document
      case "pdf":
        return "application/pdf";
      case "vcf":
        return "text/vcard";
      default:
        return "";
    }
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Validate if a URL points to an image file based on its file extension.
   *
   * Checks if the URL ends with a common image file extension, performing a case-insensitive
   * match against supported image formats. Strips query parameters before checking the extension
   * to handle URLs with query strings. Supports JPEG, PNG, GIF, BMP, WebP, SVG, and TIFF formats.
   *
   * @param url - The URL string to check for image file extension.
   * @returns True if the URL ends with a recognized image file extension, false otherwise.
   *
   * @example
   * ```typescript
   * // Valid image URLs
   * Validator.isImageUrl('https://example.com/photo.jpg'); // true
   * Validator.isImageUrl('image.PNG'); // true (case insensitive)
   * Validator.isImageUrl('avatar.gif'); // true
   * Validator.isImageUrl('logo.svg'); // true
   * Validator.isImageUrl('photo.jpeg?v=123'); // true (ignores query params)
   * 
   * ```
   */
  static isImageUrl(url) {
    return /\.(jpe?g|png|gif|bmp|webp|svg|tiff?)$/i.test(url.split("?")[0]);
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Validate if a URL points to a video file based on its file extension.
   *
   * Checks if the URL ends with a common video file extension, performing a case-insensitive
   * match against supported video formats. Strips query parameters before checking the extension
   * to handle URLs with query strings. Supports MP4, MOV, AVI, WMV, FLV, WebM, MKV, M4V, 3GP,
   * MPEG, and MPG formats.
   *
   * @param url - The URL string to check for video file extension.
   * @returns True if the URL ends with a recognized video file extension, false otherwise.
   *
   * @example
   * ```typescript
   * // Valid video URLs
   * Validator.isVideoUrl('https://example.com/video.mp4'); // true
   * Validator.isVideoUrl('movie.MOV'); // true (case insensitive)
   * Validator.isVideoUrl('clip.avi'); // true
   * Validator.isVideoUrl('stream.webm?quality=hd'); // true (ignores query params)
   * 
   * // Invalid video URLs
   * Validator.isVideoUrl('document.pdf'); // false
   * Validator.isVideoUrl('image.jpg'); // false
   * Validator.isVideoUrl('https://example.com/'); // false (no extension)
   * ```
   */
  static isVideoUrl(url) {
    return /\.(mp4|mov|avi|wmv|flv|webm|mkv|m4v|3gp|mpeg|mpg)$/i.test(url.split("?")[0]);
  }
};
((FileUtils2) => {
  FileUtils2.UNKNONW_FILE_SIZE = 9999;
  let Mime;
  ((Mime2) => {
    Mime2["VIDEO_MP4"] = "video/mp4";
    Mime2["VIDEO_MOV"] = "video/quicktime";
    Mime2["VIDEO_AVI"] = "video/x-msvideo";
    Mime2["VIDEO_WMV"] = "video/x-ms-wmv";
    Mime2["VIDEO_FLV"] = "video/x-flv";
    Mime2["VIDEO_WEBM"] = "video/webm";
    Mime2["VIDEO_MPEG"] = "video/mpeg";
  })(Mime = FileUtils2.Mime || (FileUtils2.Mime = {}));
})(FileUtils || (FileUtils = {}));

// ../../../packages/common/src/utils/UserAgent.ts
var SEARCH_ENGINES = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|slurp|ia_archiver/i;
var DEV_TOOLS = /curl|wget|axios|postman|insomnia|go-http-client|python-requests|node-fetch/i;
var SCRAPERS = /headlesschrome|selenium|playwright|puppeteer|semrushbot|dotbot|ahrefsbot/i;
var TABLET_RE = /tablet|ipad|playbook|silk/i;
var MOBILE_RE = /mobile|iphone|ipod|android|blackberry|iemobile/i;
var IOS_DEVICE_RE = /iPhone|iPad|iPod/i;
var MAC_RE = /Macintosh/i;
var WINDOWS_RE = /Windows/i;
var ANDROID_RE = /Android/i;
var LINUX_RE = /Linux/i;
var MAC_VERSION_RE = /Mac OS X (\d+[._]\d+[._]\d+)/i;
var WINDOWS_VERSION_RE = /Windows NT (\d+\.\d+)/i;
var IOS_VERSION_RE = /OS (\d+[._]\d+(?:[._]\d+)?)/i;
var ANDROID_VERSION_RE = /Android (\d+(\.\d+)?)/i;
var EDGE_RE = /Edg\/(\d+\.\d+\.\d+\.\d+)/i;
var CHROME_RE = /Chrome\/(\d+\.\d+\.\d+\.\d+)/i;
var SAFARI_RE = /Safari/i;
var SAFARI_VERSION_RE = /Version\/(\d+\.\d+(\.\d+)?)/i;
var FIREFOX_RE = /Firefox\/(\d+\.\d+)/i;
var UserAgent;
((UserAgent2) => {
  let OS;
  ((OS2) => {
    OS2["MACOS"] = "macos";
    OS2["WINDOWS"] = "windows";
    OS2["LINUX"] = "linux";
    OS2["IOS"] = "ios";
    OS2["ANDROID"] = "android";
    OS2["UNKNOWN"] = "unknown";
  })(OS = UserAgent2.OS || (UserAgent2.OS = {}));
  let Browser;
  ((Browser2) => {
    Browser2["CHROME"] = "chrome";
    Browser2["SAFARI"] = "safari";
    Browser2["FIREFOX"] = "firefox";
    Browser2["EDGE"] = "edge";
    Browser2["UNKNOWN"] = "unknown";
  })(Browser = UserAgent2.Browser || (UserAgent2.Browser = {}));
  let Device;
  ((Device2) => {
    Device2["DESKTOP"] = "desktop";
    Device2["MOBILE"] = "mobile";
    Device2["TABLET"] = "tablet";
    Device2["UNKNOWN"] = "unknown";
  })(Device = UserAgent2.Device || (UserAgent2.Device = {}));
  let BotType;
  ((BotType2) => {
    BotType2["SEARCH_ENGINE"] = "search";
    BotType2["DEVELOPER_TOOL"] = "devtool";
    BotType2["SCRAPER"] = "scraper";
    BotType2["NOT_A_BOT"] = "none";
  })(BotType = UserAgent2.BotType || (UserAgent2.BotType = {}));
  function parse(uaString) {
    const fallback = {
      os: "unknown" /* UNKNOWN */,
      browser: "unknown" /* UNKNOWN */,
      device: "unknown" /* UNKNOWN */,
      osVersion: "0.0.0",
      browserVersion: "0.0.0"
    };
    if (!uaString || uaString.trim() === "") return fallback;
    let bot = void 0;
    const searchMatch = uaString.match(SEARCH_ENGINES);
    const devMatch = uaString.match(DEV_TOOLS);
    const scraperMatch = uaString.match(SCRAPERS);
    if (searchMatch) {
      bot = { type: "search" /* SEARCH_ENGINE */, name: searchMatch[0] };
    } else if (devMatch) {
      bot = { type: "devtool" /* DEVELOPER_TOOL */, name: devMatch[0] };
    } else if (scraperMatch) {
      bot = { type: "scraper" /* SCRAPER */, name: scraperMatch[0] };
    }
    let device = "desktop" /* DESKTOP */;
    if (TABLET_RE.test(uaString)) {
      device = "tablet" /* TABLET */;
    } else if (MOBILE_RE.test(uaString)) {
      device = "mobile" /* MOBILE */;
    }
    let os2 = "unknown" /* UNKNOWN */;
    let osVersion = "0.0.0";
    if (IOS_DEVICE_RE.test(uaString)) {
      os2 = "ios" /* IOS */;
      const match = uaString.match(IOS_VERSION_RE);
      osVersion = match ? match[1].replace(/_/g, ".") : "0.0.0";
    } else if (MAC_RE.test(uaString)) {
      os2 = "macos" /* MACOS */;
      const match = uaString.match(MAC_VERSION_RE);
      osVersion = match ? match[1].replace(/_/g, ".") : "10.0.0";
    } else if (WINDOWS_RE.test(uaString)) {
      os2 = "windows" /* WINDOWS */;
      const match = uaString.match(WINDOWS_VERSION_RE);
      osVersion = match ? match[1] : "10.0";
    } else if (ANDROID_RE.test(uaString)) {
      os2 = "android" /* ANDROID */;
      const match = uaString.match(ANDROID_VERSION_RE);
      osVersion = match ? match[1] : "0.0.0";
    } else if (LINUX_RE.test(uaString)) {
      os2 = "linux" /* LINUX */;
    }
    let browser = "unknown" /* UNKNOWN */;
    let browserVersion = "0.0.0";
    const edgeMatch = uaString.match(EDGE_RE);
    const chromeMatch = uaString.match(CHROME_RE);
    const firefoxMatch = uaString.match(FIREFOX_RE);
    if (edgeMatch) {
      browser = "edge" /* EDGE */;
      browserVersion = edgeMatch[1];
    } else if (chromeMatch) {
      browser = "chrome" /* CHROME */;
      browserVersion = chromeMatch[1];
    } else if (SAFARI_RE.test(uaString) && !CHROME_RE.test(uaString)) {
      browser = "safari" /* SAFARI */;
      browserVersion = uaString.match(SAFARI_VERSION_RE)?.[1] || "0.0.0";
    } else if (firefoxMatch) {
      browser = "firefox" /* FIREFOX */;
      browserVersion = firefoxMatch[1];
    }
    return { os: os2, browser, device, osVersion, browserVersion, bot };
  }
  UserAgent2.parse = parse;
})(UserAgent || (UserAgent = {}));

// ../../../packages/services/src/aws/sdkConfig.ts
function sdkConfig() {
  const region = process.env.AWS_REGION ?? "us-east-1";
  const endpoint = process.env.AWS_ENDPOINT_URL;
  if (endpoint === void 0 || endpoint === "") {
    return { region };
  }
  return {
    region,
    endpoint,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    forcePathStyle: true
  };
}

// ../../../packages/services/src/aws/ClientUtils.ts
var ClientUtils;
((ClientUtils2) => {
  function createClient(Ctor, extra = {}) {
    return new Ctor({ ...sdkConfig(), maxAttempts: 5, ...extra });
  }
  ClientUtils2.createClient = createClient;
})(ClientUtils || (ClientUtils = {}));

// ../../../packages/services/src/aws/AppConfig.ts
var AppConfig = class {
  // cacheKey -> next poll token
  ////////////////////////////////////////////////////////////////////////////////
  /** @param cloud the owning service's resolver — maps logical appConfig keys to application ids. */
  constructor(cloud) {
    this.cloud = cloud;
  }
  cloud;
  _client;
  _admin;
  // control-plane client (versions/deployments), lazy
  tokens = /* @__PURE__ */ new Map();
  ////////////////////////////////////////////////////////////////////////////////
  /** The raw `AppConfigDataClient` — escape hatch. Created lazily and cached. */
  get client() {
    return this._client ??= ClientUtils.createClient(import_client_appconfigdata.AppConfigDataClient);
  }
  ////////////////////////////////////////////////////////////////////////////////
  /**
   * The raw **control-plane** `AppConfigClient` — escape hatch for version/deployment management
   * (a different API from the data-plane {@link client}). Created lazily and cached.
   */
  get adminClient() {
    return this._admin ??= ClientUtils.createClient(import_client_appconfig.AppConfigClient);
  }
  ////////////////////////////////////////////////////////////////////////////////
  /**
   * Latest **raw** configuration string for a profile. Starts a session on first call, then
   * reuses the rolling poll token.
   *
   * **Important:** the Data API returns an **empty string when nothing changed** since your
   * last poll — so cache the last non-empty value and treat `""` as "unchanged", not "no
   * config". Use {@link json} for JSON / feature-flag profiles.
   *
   * @param appConfigKey logical appConfig key (-> application id).
   * @param profile      configuration profile name (e.g. `"settings"`, `"flags"`).
   * @param environment  AppConfig environment = the in-account **deploy target** (ring/region/cell),
   *                     NOT dev/staging/prod (that's the AWS account boundary). Defaults to
   *                     `APPCONFIG_ENV` ?? `"default"`. See SPECS.md → AppConfig configuration layout.
   */
  async latest(appConfigKey, profile, environment = process.env.APPCONFIG_ENV ?? "default") {
    const cacheKey = `${appConfigKey}/${environment}/${profile}`;
    let token = this.tokens.get(cacheKey);
    if (token === void 0) {
      const session = await ResultUtils_default.from(() => this.client.send(new import_client_appconfigdata.StartConfigurationSessionCommand({
        ApplicationIdentifier: this.cloud.appConfigId(appConfigKey),
        EnvironmentIdentifier: environment,
        ConfigurationProfileIdentifier: profile
      })));
      if (!session.ok) return session;
      token = session.data.InitialConfigurationToken;
      if (token === void 0) return ResultUtils_default.err(`AppConfig: no session token for ${cacheKey}`);
    }
    const polled = await ResultUtils_default.from(() => this.client.send(new import_client_appconfigdata.GetLatestConfigurationCommand({ ConfigurationToken: token })));
    if (!polled.ok) return polled;
    if (polled.data.NextPollConfigurationToken) this.tokens.set(cacheKey, polled.data.NextPollConfigurationToken);
    return ResultUtils_default.ok(polled.data.Configuration ? new TextDecoder().decode(polled.data.Configuration) : "");
  }
  ////////////////////////////////////////////////////////////////////////////////
  /**
   * Latest configuration parsed as JSON (e.g. a freeform settings document or a feature-flag
   * set). Returns `undefined` when unchanged/empty — keep your last value and replace only on
   * a defined result.
   * @typeParam T the expected shape of the configuration document.
   */
  async json(appConfigKey, profile, environment) {
    const result = await this.latest(appConfigKey, profile, environment);
    if (!result.ok) return result;
    return ResultUtils_default.attempt(() => result.data ? JSON.parse(result.data) : void 0);
  }
  //
  // ── Control plane: versions + deployments (the AppConfigClient API) ─────────────────────────
  //
  // NOTE: unlike the data-plane methods above (which accept profile / environment NAMES), the
  // control-plane calls below take AppConfig **IDs** — `profileId` (configuration profile id) and
  // `environmentId` — as AWS requires. `appConfigKey` is still a cloud-spec logical key (-> app id).
  //
  ////////////////////////////////////////////////////////////////////////////////
  /**
   * List the **hosted configuration versions** of a profile, **newest-first** (paginates internally,
   * returning every version). Each is identified by its `versionNumber`, which you pass to
   * {@link deploy} / {@link rollback}. Hosted-store profiles only.
   *
   * @param appConfigKey logical appConfig key (-> application id).
   * @param profileId    the **configuration profile id** (not its name).
   */
  async listVersions(appConfigKey, profileId) {
    return ResultUtils_default.from(async () => {
      const applicationId = this.cloud.appConfigId(appConfigKey);
      const versions = [];
      let nextToken = void 0;
      do {
        const page = await this.adminClient.send(new import_client_appconfig.ListHostedConfigurationVersionsCommand({
          ApplicationId: applicationId,
          ConfigurationProfileId: profileId,
          NextToken: nextToken
        }));
        for (const item of page.Items ?? [])
          if (item.VersionNumber !== void 0)
            versions.push({ versionNumber: item.VersionNumber, description: item.Description, contentType: item.ContentType });
        nextToken = page.NextToken;
      } while (nextToken !== void 0);
      return versions;
    });
  }
  ////////////////////////////////////////////////////////////////////////////////
  /**
   * Create a new **hosted configuration version** (the content that a later {@link deploy} rolls
   * out). Returns the new `versionNumber`. Hosted-store profiles only.
   *
   * @param appConfigKey logical appConfig key (-> application id).
   * @param profileId    the configuration profile id.
   * @param content      the configuration body (e.g. `JSON.stringify(doc)`).
   * @param contentType  MIME type (default `"application/json"`).
   */
  async createVersion(appConfigKey, profileId, content, contentType = "application/json") {
    const created = await ResultUtils_default.from(() => this.adminClient.send(new import_client_appconfig.CreateHostedConfigurationVersionCommand({
      ApplicationId: this.cloud.appConfigId(appConfigKey),
      ConfigurationProfileId: profileId,
      Content: new TextEncoder().encode(content),
      ContentType: contentType
    })));
    if (!created.ok) return created;
    if (created.data.VersionNumber === void 0) return ResultUtils_default.err(`AppConfig: createVersion returned no VersionNumber for ${String(appConfigKey)}/${profileId}`);
    return ResultUtils_default.ok(created.data.VersionNumber);
  }
  ////////////////////////////////////////////////////////////////////////////////
  /**
   * **Deploy** a specific configuration `versionNumber` to an environment (`StartDeployment`).
   * Returns the `deploymentNumber` — poll {@link getDeploymentStatus} for progress. Defaults to the
   * predefined **`AppConfig.AllAtOnce`** strategy (immediate, no bake) which is ideal for a manual
   * rollout/rollback; pass `opts.strategyId` for a gradual strategy.
   *
   * @param appConfigKey  logical appConfig key (-> application id).
   * @param profileId     the configuration profile id.
   * @param environmentId the environment id to deploy to.
   * @param versionNumber the configuration version to roll out (see {@link listVersions}).
   * @param opts          optional `strategyId` + `description`.
   */
  async deploy(appConfigKey, profileId, environmentId, versionNumber, opts = {}) {
    const started = await ResultUtils_default.from(() => this.adminClient.send(new import_client_appconfig.StartDeploymentCommand({
      ApplicationId: this.cloud.appConfigId(appConfigKey),
      EnvironmentId: environmentId,
      ConfigurationProfileId: profileId,
      ConfigurationVersion: String(versionNumber),
      DeploymentStrategyId: opts.strategyId ?? "AppConfig.AllAtOnce",
      Description: opts.description
    })));
    if (!started.ok) return started;
    if (started.data.DeploymentNumber === void 0) return ResultUtils_default.err(`AppConfig: startDeployment returned no DeploymentNumber for ${String(appConfigKey)}/${profileId}`);
    return ResultUtils_default.ok(started.data.DeploymentNumber);
  }
  ////////////////////////////////////////////////////////////////////////////////
  /**
   * **Roll back** to an earlier configuration `versionNumber` — there is no distinct AppConfig
   * "rollback to a completed deployment" call, so this simply {@link deploy}s the older version
   * (immediately, via `AppConfig.AllAtOnce`). Pick the target from {@link listVersions}.
   *
   * @param appConfigKey  logical appConfig key (-> application id).
   * @param profileId     the configuration profile id.
   * @param environmentId the environment id to roll back.
   * @param versionNumber the earlier version to restore.
   * @param opts          optional `strategyId` + `description`.
   */
  async rollback(appConfigKey, profileId, environmentId, versionNumber, opts = {}) {
    return this.deploy(appConfigKey, profileId, environmentId, versionNumber, {
      strategyId: opts.strategyId ?? "AppConfig.AllAtOnce",
      description: opts.description ?? `rollback to version ${versionNumber}`
    });
  }
  ////////////////////////////////////////////////////////////////////////////////
  /**
   * Fetch a deployment's status (`GetDeployment`) — `state` (e.g. `DEPLOYING` / `COMPLETE` /
   * `ROLLING_BACK` / `ROLLED_BACK` / `REVERTED`), `percentageComplete`, and the targeted `version`.
   * Poll after {@link deploy} / {@link rollback} to confirm completion.
   *
   * @param appConfigKey     logical appConfig key (-> application id).
   * @param environmentId    the environment id.
   * @param deploymentNumber the number returned by {@link deploy} / {@link rollback}.
   */
  async getDeploymentStatus(appConfigKey, environmentId, deploymentNumber) {
    return ResultUtils_default.from(async () => {
      const deployment = await this.adminClient.send(new import_client_appconfig.GetDeploymentCommand({
        ApplicationId: this.cloud.appConfigId(appConfigKey),
        EnvironmentId: environmentId,
        DeploymentNumber: deploymentNumber
      }));
      return {
        deploymentNumber: deployment.DeploymentNumber ?? deploymentNumber,
        state: deployment.State ?? "UNKNOWN",
        percentageComplete: deployment.PercentageComplete ?? 0,
        version: deployment.ConfigurationVersion
      };
    });
  }
};

// ../../../packages/services/src/aws/Kms.ts
var import_client_kms = require("@aws-sdk/client-kms");
var Kms = class _Kms {
  /////////////////////////////////////////////////////////////////////////////////////////////
  /** @param cloud the owning service's resolver — maps logical key keys to KMS key ARNs. */
  constructor(cloud) {
    this.cloud = cloud;
  }
  cloud;
  _client;
  /////////////////////////////////////////////////////////////////////////////////////////////
  /** The raw `KMSClient` — escape hatch (re-encrypt, sign/verify, grants, …). Lazy + cached. */
  get client() {
    return this._client ??= ClientUtils.createClient(import_client_kms.KMSClient);
  }
  /////////////////////////////////////////////////////////////////////////////////////////////
  /** Resolve a cloud-spec logical key key (e.g. `"data"`) to its physical KMS key ARN. */
  keyArn(key) {
    return this.cloud.kmsKeyArn(key);
  }
  /////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Encrypt a **small** blob (≤ 4 KB) directly under the named CMK — good for a secret/token.
   * For larger payloads use {@link dataKey}; this is a per-call round-trip and KMS rejects
   * plaintext over 4 KB.
   * @param keyKey    logical key key.
   * @param plaintext bytes to encrypt.
   * @returns the ciphertext (store/transmit as-is; the key id is embedded in it).
   */
  encrypt(keyKey, plaintext) {
    return ResultUtils_default.from(async () => {
      const result = await this.client.send(new import_client_kms.EncryptCommand({ KeyId: this.keyArn(keyKey), Plaintext: plaintext }));
      return result.CiphertextBlob;
    });
  }
  /////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Decrypt ciphertext produced by {@link encrypt} (or {@link dataKey}'s encrypted key). No key
   * reference is needed — KMS reads the key id embedded in the ciphertext and picks the CMK.
   * @param ciphertext the bytes returned by a prior encrypt (the key id is embedded in them).
   * @returns the recovered plaintext bytes.
   */
  decrypt(ciphertext) {
    return ResultUtils_default.from(async () => {
      const result = await this.client.send(new import_client_kms.DecryptCommand({ CiphertextBlob: ciphertext }));
      return result.Plaintext;
    });
  }
  /////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * **Envelope encryption.** Generate a one-time data key: use the returned `plaintext` key to
   * encrypt your payload locally (e.g. AES-GCM), persist the `encrypted` key alongside the
   * data, then drop the plaintext key from memory. To read later, {@link decrypt} the stored
   * encrypted key and re-derive. This is how you encrypt large data with KMS — no 4 KB limit,
   * one network call regardless of payload size.
   * @param keyKey  logical key key.
   * @param keySpec data-key size — see {@link Kms.KeySpec} (default `AES_256`).
   * @returns `{ plaintext, encrypted }` — the usable key and the storable, KMS-wrapped key.
   */
  dataKey(keyKey, keySpec = _Kms.KeySpec.AES_256) {
    return ResultUtils_default.from(async () => {
      const result = await this.client.send(new import_client_kms.GenerateDataKeyCommand({ KeyId: this.keyArn(keyKey), KeySpec: keySpec }));
      return { plaintext: result.Plaintext, encrypted: result.CiphertextBlob };
    });
  }
};
((Kms2) => {
  let KeySpec;
  ((KeySpec2) => {
    KeySpec2["AES_256"] = "AES_256";
    KeySpec2["AES_128"] = "AES_128";
  })(KeySpec = Kms2.KeySpec || (Kms2.KeySpec = {}));
})(Kms || (Kms = {}));

// ../../../packages/services/src/Application.ts
var Application = class {
  id;
  log;
  nbr_cpus;
  serviceName;
  // Lazily-created cloud access. The base carries only what's common to EVERY Service and
  // Job (the resolver + config + keys); concrete services wire the facades they need.
  _cloud;
  _appConfig;
  _kms;
  ////////////////////////////////////////////////////////////////////////
  constructor(name) {
    this.serviceName = name;
    this.id = (0, import_crypto.randomUUID)();
    this.log = new Trace(name, this.id);
    this.nbr_cpus = os.cpus().length;
    this.bindCallbacks();
  }
  // TODO(monitor): transaction-id (request) correlation — a cross-cutting capability the
  // monitor service depends on (see apps/core/monitor/SPECS.md "Tracing & correlation").
  // Today `this.id` / `Trace.id` is ONE process-level UUID; there is no per-request id.
  // Add to this base so every service threads it automatically (no per-service code):
  //   1. Inbound (Service): read `x-transactionid` from the request (API Gateway injects it via
  //      integration mapping); FALL BACK to a generated id when absent.
  //   2. Inbound (Job): read the transaction id off the SQS message attribute / event detail.
  //   3. Per-request logger: spawn a child Trace carrying that id so every log line correlates
  //      (the current single app-scoped Trace can't distinguish concurrent requests).
  //   4. Outbound: propagate the id on every downstream call — HTTP header, SQS message
  //      attribute, EventBridge detail — so the chain stays linked across services.
  // The job-run ledger (monitor) and X-Ray (`X-Amzn-Trace-Id`) both key off this id.
  // TODO(compliance): shared SEND-COMPLIANCE gate — `canSend(...)` on this base so every Service AND Job
  // runs the SAME pre-send checks (no caller can forget one), like the RBAC Access check + entitlements gate.
  // INVOKED BY THE CHANNEL (its send worker) — dispatch governs only fairness/rate, the channel owns send
  // eligibility. See packages/services/README.md "Shared send-compliance gate",
  // apps/core/contact/SPECS.md "Consent & suppression" (contact-5), apps/core/campaign/SPECS.md, and
  // packages/services/DISPATCH.md gap #12 (enforcement point = the channel).
  //   canSend({ accountId, contactId, channel, content, at }) -> { allowed, reasons[] }
  //   composes (aggregates, does not duplicate): per-contact PER-CHANNEL consent/suppression (contact svc) +
  //   account block-list (account) + global frequency cap/fatigue + quiet-hours + SHAFT/content screening.
  //   PER-CHANNEL CONSENT RULE (mirror of contact-5.3 / 5.7): effective state = the consent record with the
  //   LATEST `at` for that channel — an opt-in dated AFTER an opt-out re-enables sending (re-subscribe).
  //   HARD-BLOCK EXCEPTION: a complaint / hard-bounce suppression (SuppressionRecord) is NOT cleared by a
  //   later opt-in timestamp; treat it as send=false regardless. (Block if: not opted_in by latest `at`,
  //   OR a hard-block suppression exists, OR on the account block-list, OR outside quiet-hours, OR over cap.)
  //   MECHANISM TBD: frequency counters likely Redis (atomic, fleet-wide — same as WorkQueue rate-limiter);
  //   quiet-hours/holiday rule source; base-method-backed-by-library vs a dedicated `compliance` service.
  // TODO(sanitize): shared OUTBOUND-HTML sanitizer — `sanitizeHtml(...)` on this base so every Service AND Job
  // that emits or stores HTML runs the SAME allowlist (no caller rolls its own; no XSS / JS slips through).
  // INVOKED BY ANY producer of HTML — email bodies/templates, collab rich-text docs, notices, Zendesk articles,
  // survey forms. Sanitize on STORE *and* OUTPUT (never trust that upstream pre-sanitized). See
  // packages/services/README.md "Shared HTML sanitizer", apps/core/app/SPECS.md (app-8.4 = the reference
  // allowlist), apps/core/email/SPECS.md, apps/core/collab/SPECS.md, apps/core/survey/SPECS.md, and
  // apps/core/web/SPECS.md (web-6.7 = the client-side render-time backstop — defense in depth).
  //   sanitizeHtml(html, profile?) -> string   (allowlist; profiles: "vanilla" default · "email" · "richtext")
  //   ALWAYS STRIPS: <script>, inline <style>/CSS, <iframe>/<object>/<embed>, and ALL `on*` event handlers.
  //   CONSTRAINS URLs: a[href] / img[src] = `https:` only (no `javascript:`/`data:`/`vbscript:`); img = our
  //   media/CDN; links routed via the tracked-[links] service. Profiles widen the TAG allowlist (email >
  //   richtext > vanilla) but NEVER re-enable script/style/`on*`/bad URLs. Backed by a VETTED library
  //   (DOMPurify / sanitize-html), not hand-rolled. Server-side; web sanitizes AGAIN at render (web-6.7).
  // TODO(reputation): shared IP REPUTATION / GEO lookup — `reputation(ip)` on this base so every Service AND
  // Job gets the same signals with no per-service wiring. The DATA + storage live in AUTH (it owns the
  // provider factory, the per-user login-context baseline, and the IP allow/deny rules); this base method is
  // a thin CLIENT that calls auth's generalized internal API. See packages/services/README.md "Shared
  // reputation / geo lookup" + apps/core/auth/specs/SPECS.md + RISK.md (risk-based challenges).
  //   reputation(ip) -> { country, asn, isTor, isVpn, isHosting, score }   (calls GET /auth/internal/reputation)
  //   auth's risk engine owns the RiskPolicy (what to DO with the signals); callers just read them.
  // TODO(audit): shared ACTION-LEVEL audit EMITTER — `audit(event)` on this base so every Service AND Job
  // records "who did what, to what, when, from where, and whether it succeeded" the SAME way. EMIT, DON'T STORE:
  // this method only ENQUEUES the event to SQS (the audit queue); the AUDIT service is the sole writer of the
  // immutable (WORM) trail. See packages/services/README.md "Shared audit emitter" + apps/core/audit/SPECS.md.
  //   audit({ actor, action, target:{type,id}, outcome, source?, context? }) -> void   (enqueues to audit SQS)
  //   PII-LIGHT BY CONTRACT: `target` is an ID not a value; `context` is ids + enums — NEVER field values or
  //   message content. This is why the trail survives a GDPR forget without redaction (audit-1.1 / 3.x).
  //   NOT change-history: audit records THAT a change happened; the field-level {before,after} diff lives in the
  //   owning service co-located (see changeHistory below + apps/core/contact/SPECS.md contact-13). Emit on:
  //   login/access, role/permission change, export, config change, consent change, integration connect, money,
  //   staff.impersonate, data.access. Reads of the audit trail are themselves audited (audit-5.2).
  // TODO(changeHistory): shared FIELD-LEVEL change-history WRITER — `changeHistory.record(...)` so every primary
  // object across services gets the SAME versioned, revertable diff trail with no per-service reinvention. Owned
  // DATA stays CO-LOCATED with each service (PII-dense; purges on GDPR forget); this is the shared MECHANISM,
  // typically invoked from each service's DDB-Streams CDC Job (it sees OldImage/NewImage). See
  // packages/services/README.md "Shared change-history" + apps/core/contact/SPECS.md (contact-13, contact-14.5).
  //   changeHistory.record({ entity:{type,id}, version, actor, source, before, after }) -> diff[]   (append-only)
  //   computes per-field { field, before, after }; supports compare(v1,v2) + revert(field[]) as a NEW guarded
  //   (version/etag) change. CONTRAST audit(): change-history HOLDS PII + purges on forget; audit() is PII-light
  //   + immutable. One per-service `change_history` table (PK accountId#entityId, SK version), NOT centralized.
  //   CHEAPEST PROVIDER: free MaxMind GeoLite2 (geo+ASN) + Tor exit-list + ASN datacenter heuristic ($0/call,
  //   local DB); paid VPN/fraud feed (MaxMind Anonymous-IP / IPQS / Spur) addable by config (provider factory).
  //   LOCAL DB FRESHNESS: keep the GeoLite2/GeoIP2 .mmdb current via MaxMind `geoipupdate`
  //   (github.com/maxmind/geoipupdate) on a schedule → S3; provider hot-reloads it (license key in Secrets
  //   Manager). A stale .mmdb silently degrades geo-fencing + residency — never hand-bundle a one-off DB.
  //
  // cloud access (lazy) — pass cloud-spec LOGICAL keys; facades resolve physical ids
  // from the env vars the /cloud build injected. Drop to `<facade>.client` for raw SDK.
  //
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /** Runtime resolver: cloud-spec logical resource keys -> physical ids. */
  get cloud() {
    return this._cloud ??= new CloudResolver(process.env.ENVIRONMENT ?? "dev" /* DEV */, this.serviceName);
  }
  /** AppConfig facade — runtime config + feature flags. Common to all services + jobs. */
  get appConfig() {
    return this._appConfig ??= new AppConfig(this.cloud);
  }
  /** KMS facade — encrypt/decrypt + envelope data keys. Common to all services + jobs. */
  get kms() {
    return this._kms ??= new Kms(this.cloud);
  }
  //
  // Everything else (S3, SQS, SNS, Secrets, EventBridge, Kafka, Dynamo, …) is wired by the
  // concrete Service/Job that needs it, e.g.:
  //
  //   import { S3 } from "@repo/services";
  //   class MediaService extends Service {
  //       private _s3? : S3;
  //       protected get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }
  //   }
  //
  // A facade that proves common to most services can migrate up here (or to Service/Job).
  //
  //
  // cloud services
  //
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  async getSecret(key) {
    return void 0;
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  async getConfig() {
    return {};
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  async setConfig(config) {
    return false;
  }
  // add:
  // config notification of change
  //
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Overridable hook for binding instance callbacks. The LONG-RUNNING base (`Daemon`) binds the signal handlers
  // + graceful-drain here — shared by its two kinds, `Service` (request-driven, HTTP) and `Consumer`
  // (self-driven, consumes the Kafka/SQS/stream backbone). The `Application` base does NOTHING so the ONE-SHOT
  // `Job`/Lambda context never installs process-level handlers. (Class hierarchy: Application → Daemon →
  // {Service, Consumer}; Job is the one-shot sibling. See packages/services/README.md "Class hierarchy".)
  bindCallbacks() {
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // allow inherited servies to perform clean up on exit
  // like cleaning up database connections
  async aboutToQuit() {
  }
  ///////////////////////////////////////////////////////////////////////////////////
  readJsonFile(path2, default_value) {
    try {
      if (fs.existsSync(path2))
        return JSON.parse(fs.readFileSync(path2, "utf8"));
      this.log.error("readJsonFile path not found", { path: path2, cwd: process.cwd() });
    } catch (err) {
      this.log.error("readJsonFile parse failed", { path: path2, err });
    }
    return default_value;
  }
  ///////////////////////////////////////////////////////////////////////////////////
  // Loads the nearest package.json by walking up from the caller's directory. Subclasses
  // pass their own __dirname so resolution is relative to the concrete app's compiled
  // location (not this base file), and works whether called from bin/ or a nested folder:
  //
  //   this.pkg = this.loadPackageInfo( __dirname );
  //
  loadPackageInfo(fromDir) {
    const fallback = { name: "unknown", version: "0.0.0" };
    let dir = fromDir;
    while (true) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate))
        return this.readJsonFile(candidate, fallback);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    this.log.error("loadPackageInfo: no package.json found", { fromDir });
    return fallback;
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  async config() {
    await this.getConfig();
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // initialize database connection or other states before everything else starts
  async init() {
  }
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////
  async start() {
  }
  /////////////////////////////////////////////////////////////////////////////////////////////
  async run() {
    try {
      this.log.info("RUN");
      await this.config();
      await this.init();
      await this.start();
    } catch (err) {
      this.log.error("run: bootstrap failed", err);
      throw err;
    }
  }
};
((Application2) => {
  Application2.ID_DIVIDER = ":";
})(Application || (Application = {}));
var Application_default = Application;

// ../../../packages/services/src/Job.ts
var Job = class extends Application {
  // resolves once the per-container cold-start bootstrap (config/init/start) has completed
  coldStart;
  ////////////////////////////////////////////////////////////////////////
  /**
  * @param name - identifier for this job, used for logging and trace correlation
  */
  constructor(name) {
    super(name);
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
  * Cold-start hook: loads configuration before the job handles any events. Override to fetch
  * job-specific config and call super.config() to preserve base behavior. Runs once per
  * execution environment as part of invoke()'s bootstrap.
  */
  async config() {
    await super.config();
  }
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
  * Cold-start hook: initializes long-lived resources (database connections, secrets, clients)
  * once per execution environment. Override and call super.init().
  */
  async init() {
    await super.init();
  }
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
  * Cold-start hook: final setup step, run after config() and init(). Override and call
  * super.start().
  */
  async start() {
    await super.start();
  }
  //////////////////////////////////////////////////////////////////////////////////////////
  // The AWS Lambda entrypoint. Wire a bound instance to the exported handler, e.g.:
  //
  //   const job : MyJob = new MyJob('my-job');
  //   export const handler = ( event, context ) => job.invoke( event, context );
  //
  // The cold-start bootstrap (config -> init -> start, via run()) runs exactly once per
  // execution environment and is reused on warm invocations; only handler() runs per call.
  async invoke(event, context) {
    if (!this.coldStart) this.coldStart = this.run();
    try {
      await this.coldStart;
    } catch (err) {
      this.coldStart = void 0;
      throw err;
    }
    return this.handler(event, context);
  }
  ////////////////////////////////////////////////////////////////////////
  /**
  * Cleanup hook invoked before the job shuts down - flush buffers, close connections, etc.
  * Override and call super.aboutToQuit().
  */
  async aboutToQuit() {
    await super.aboutToQuit();
  }
};
var Job_default = Job;

// src/jobs/AppJob.ts
var AppJob = class _AppJob extends Job_default {
  // name/version of this app, read from apps/core/app/package.json at startup
  pkg;
  ///////////////////////////////////////////////////////////////////////////////////////
  constructor(name) {
    super([_AppJob.ID, name].join(Application_default.ID_DIVIDER));
    this.pkg = this.loadPackageInfo(__dirname);
    this.log.info("version", { name: this.pkg.name, version: this.pkg.version });
  }
  ///////////////////////////////////////////////////////////////////////////////////////
  async init() {
    await super.init();
  }
};
((AppJob2) => {
  AppJob2.ID = "app";
})(AppJob || (AppJob = {}));
var AppJob_default = AppJob;

// src/jobs/AppTicketJob.ts
var AppTicketJob = class extends AppJob_default {
  /////////////////////////////////////////////////////////////////////
  constructor() {
    super("ticket");
  }
  /////////////////////////////////////////////////////////////////////
  async handler(event, _context) {
    this.log.info("AppTicketJob", { records: event.Records?.length ?? 0 });
  }
};
var job = new AppTicketJob();
var handler = (event, context) => job.invoke(event, context);
var AppTicketJob_default = AppTicketJob;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AppTicketJob,
  handler
});
//# sourceMappingURL=AppTicketJob.js.map
