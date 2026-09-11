import { describe, expect, it } from 'vitest';
import { formatRelativeTime, getRelativeTimeParts } from '../relativeTime';

describe('formatRelativeTime', () => {
  it('returns "just now" for timestamps within the last minute', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 5_000, now)).toBe('just now');
    expect(formatRelativeTime(now, now)).toBe('just now');
  });

  it('returns "just now" for timestamps in the future (clock skew tolerance)', () => {
    const now = Date.now();
    expect(formatRelativeTime(now + 30_000, now)).toBe('just now');
    expect(formatRelativeTime(now + 5 * 60_000, now)).toBe('just now');
  });

  it('formats minutes with singular and plural', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 60_000, now)).toBe('1 minute ago');
    expect(formatRelativeTime(now - 2 * 60_000, now)).toBe('2 minutes ago');
    expect(formatRelativeTime(now - 59 * 60_000, now)).toBe('59 minutes ago');
  });

  it('formats hours with singular and plural', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 3_600_000, now)).toBe('1 hour ago');
    expect(formatRelativeTime(now - 5 * 3_600_000, now)).toBe('5 hours ago');
  });

  it('formats days up to the 7-day cutoff', () => {
    const now = Date.now();
    // Intl.RelativeTimeFormat with numeric:'auto' renders -1 day as "yesterday".
    expect(formatRelativeTime(now - 86_400_000, now)).toBe('yesterday');
    expect(formatRelativeTime(now - 6 * 86_400_000, now)).toBe('6 days ago');
    expect(formatRelativeTime(now - 7 * 86_400_000, now)).toBe('7 days ago');
  });

  it('falls back to a short date beyond 7 days', () => {
    const now = new Date('2026-09-11T12:00:00Z').getTime();
    const ts = new Date('2026-05-04T03:24:00Z').getTime();
    const formatted = formatRelativeTime(ts, now);
    expect(typeof formatted).toBe('string');
    expect(formatted).not.toContain('day');
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('returns empty string for invalid timestamps', () => {
    expect(formatRelativeTime(Number.NaN)).toBe('');
    expect(formatRelativeTime(0)).toBe('');
  });
});

describe('getRelativeTimeParts', () => {
  it('splits value and unit for Intl.RelativeTimeFormat consumers', () => {
    const now = Date.now();
    expect(getRelativeTimeParts(now - 90_000, now)).toEqual({ value: -1, unit: 'minute' });
    expect(getRelativeTimeParts(now - 3 * 3_600_000, now)).toEqual({ value: -3, unit: 'hour' });
    expect(getRelativeTimeParts(now - 2 * 86_400_000, now)).toEqual({ value: -2, unit: 'day' });
    // At or beyond the 7-day cutoff: signal fallback.
    expect(getRelativeTimeParts(now - 8 * 86_400_000, now)).toEqual({ value: -8, unit: 'day' });
  });
});
