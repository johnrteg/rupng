//
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Trace from '../Trace';

describe('Trace', () => {

  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Pulls the single string argument a console method was called with and parses it.
  const recordFrom = (spy: ReturnType<typeof vi.spyOn>, call = 0): any =>
    JSON.parse(spy.mock.calls[call][0] as string);

  describe('output format', () => {
    it('emits a single parseable JSON line', () =>
    {
      new Trace('svc', 'id-1').info('hello');
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0]).toHaveLength(1); // everything in one stringified arg
      expect(() => JSON.parse(logSpy.mock.calls[0][0] as string)).not.toThrow();
    });

    it('includes level, name, id and message', () =>
    {
      new Trace('svc', 'id-1').info('hello');
      const rec : Trace.Data = recordFrom(logSpy);
      expect(rec).toMatchObject({ level: 'INFO', name: 'svc', id: 'id-1', message: 'hello' });
    });

    it('stamps an ISO-8601 timestamp', () =>
    {
      new Trace('svc', 'id-1').info('hello');
      expect(recordFrom(logSpy).time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('omits args when none are passed', () =>
    {
      new Trace('svc', 'id-1').info('hello');
      expect(recordFrom(logSpy)).not.toHaveProperty('args');
    });

    it('includes args when passed', () =>
    {
      new Trace('svc', 'id-1').info('shutting down', { code: 0 }, 'extra');
      expect(recordFrom(logSpy).args).toEqual([{ code: 0 }, 'extra']);
    });
  });

  describe('stream routing', () => {
    it('writes info to stdout', () =>
    {
      new Trace('svc', 'id-1').info('hello');
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).not.toHaveBeenCalled();
    });

    it('writes warn to stderr', () =>
    {
      new Trace('svc', 'id-1').warn('careful');
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
      expect(recordFrom(errSpy).level).toBe('WARN');
    });

    it('writes error to stderr', () =>
    {
      new Trace('svc', 'id-1').error('boom');
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
      expect(recordFrom(errSpy).level).toBe('ERROR');
    });
  });

  describe('level filtering', () => {
    it('suppresses messages below the configured minimum', () =>
    {
      const log : Trace = new Trace('svc', 'id-1', Trace.Level.WARNING);
      log.info('suppressed');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('emits messages at or above the configured minimum', () =>
    {
      const log : Trace = new Trace('svc', 'id-1', Trace.Level.WARNING);
      log.warn('shown');
      log.error('shown');
      expect(errSpy).toHaveBeenCalledTimes(2);
    });

    it('defaults to INFO when no minimum is given', () =>
    {
      new Trace('svc', 'id-1').info('shown');
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('error serialization', () => {
    it('serializes Error args into name/message/stack', () =>
    {
      new Trace('svc', 'id-1').error('failed', new Error('boom'));
      const arg : any = recordFrom(errSpy).args[0];
      expect(arg.name).toBe('Error');
      expect(arg.message).toBe('boom');
      expect(typeof arg.stack).toBe('string');
    });

    it('leaves plain object args untouched', () =>
    {
      new Trace('svc', 'id-1').error('failed', { reason: 'x' });
      expect(recordFrom(errSpy).args[0]).toEqual({ reason: 'x' });
    });
  });
});
