import { describe, it, expect } from 'vitest';
import { parseDSN } from '../src/dsn';

describe('parseDSN', () => {
  it('should parse a DSN without path (new format)', () => {
    const result = parseDSN('https://lp_abc123@api.logtide.dev');
    expect(result).toEqual({
      apiUrl: 'https://api.logtide.dev',
      apiKey: 'lp_abc123',
    });
  });

  it('should accept legacy DSN with project ID path and ignore it', () => {
    const result = parseDSN('https://lp_abc123@api.logtide.dev/my-project');
    expect(result).toEqual({
      apiUrl: 'https://api.logtide.dev',
      apiKey: 'lp_abc123',
    });
  });

  it('should handle DSN with port', () => {
    const result = parseDSN('https://lp_key@localhost:3000');
    expect(result).toEqual({
      apiUrl: 'https://localhost:3000',
      apiKey: 'lp_key',
    });
  });

  it('should handle http scheme', () => {
    const result = parseDSN('http://lp_key@localhost');
    expect(result).toEqual({
      apiUrl: 'http://localhost',
      apiKey: 'lp_key',
    });
  });

  it('should handle DSN with trailing slash', () => {
    const result = parseDSN('https://lp_key@api.logtide.dev/');
    expect(result).toEqual({
      apiUrl: 'https://api.logtide.dev',
      apiKey: 'lp_key',
    });
  });

  it('should throw on missing API key', () => {
    expect(() => parseDSN('https://api.logtide.dev/project')).toThrow('Missing API key');
  });

  it('should throw on invalid DSN string', () => {
    expect(() => parseDSN('not-a-url')).toThrow('Invalid DSN');
  });

  it('should throw on empty string', () => {
    expect(() => parseDSN('')).toThrow('Invalid DSN');
  });
});
