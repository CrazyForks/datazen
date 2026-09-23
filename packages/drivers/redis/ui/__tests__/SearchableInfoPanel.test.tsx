import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchableInfoPanel } from '../observe/SearchableInfoPanel';

// Components take `useI18n` from the single @datazen/ui runtime; keep the
// assertions locale-independent by overriding only that hook (same pattern
// as PubSubPanel.test.tsx — assertions bind to i18n keys, never copy).
vi.mock('@datazen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datazen/ui')>()),
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const mockInvoke = vi.fn();

vi.mock('../shared/redisInvoke', () => ({
  redisCommandInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Wire shape of `info_filtered` is defined by Rust `InfoEntry` struct (ops_observe.rs), serialized via serde. Objects are the contract.
const structuredReply = {
  sections: [{ name: 'Server', entries: [{ key: 'redis_version', value: '7.2.0' }] }],
  totalEntries: 1,
  matchedEntries: 1,
};

describe('SearchableInfoPanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders structured info_filtered result without falling back to a second info call', async () => {
    // Default answers the fallback `info` command; the first (structured)
    // reply wins via mockResolvedValueOnce.
    mockInvoke.mockResolvedValue('# Server\nredis_version:7.2.0');
    mockInvoke.mockResolvedValueOnce(structuredReply);

    render(<SearchableInfoPanel dbSessionId="test-session" />);
    await act(async () => {
      fireEvent.click(screen.getByText('redis.monitor.refresh'));
    });

    // reconstructInfo must turn the structured reply into raw text in ONE
    // round-trip; a throw here silently swallows the result and re-issues `info`.
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('redis', 'info_filtered', {
      dbSessionId: 'test-session',
      section: undefined,
      search: undefined,
      nodeAddr: undefined,
    });

    // The reconstructed text reparses: section header + entry are visible.
    expect(screen.getByText('Server')).toBeTruthy();
    fireEvent.click(screen.getByText('Server'));
    expect(screen.getByText('redis_version')).toBeTruthy();
    expect(screen.getByText('7.2.0')).toBeTruthy();
  });

  it('renders the refresh button with a defined Button variant', async () => {
    render(<SearchableInfoPanel dbSessionId="test-session" />);
    const refreshBtn = screen.getByText('redis.monitor.refresh') as HTMLElement;
    // `variant="outline"` is not a Variant; variants['outline'] === undefined
    // silently drops all variant classes. secondary carries the outline look
    // (border + transparent bg) used across sibling redis toolbars.
    expect(refreshBtn.className).toContain('border-edge');
  });

  it('shows the matched/total stats arm once a search query is typed', async () => {
    mockInvoke.mockResolvedValue(structuredReply);

    render(<SearchableInfoPanel dbSessionId="test-session" />);
    await act(async () => {
      fireEvent.click(screen.getByText('redis.monitor.refresh'));
    });

    // Type a query that hits the fixture entry (entry key is the query).
    const input = screen.getByPlaceholderText('redis.monitor.infoSearchPlaceholder');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'redis_version' } });
    });

    // search-true arm of the stats ternary renders its i18n key; the
    // search-false arm's key must be absent (branch loc line 135 > 0).
    expect(screen.getByText(/redis\.monitor\.infoMatched/)).toBeTruthy();
    expect(screen.queryByText(/redis\.monitor\.infoEntries/)).toBeNull();
  });

  it('renders the no-match notice when the query filters every section out', async () => {
    mockInvoke.mockResolvedValue(structuredReply);

    render(<SearchableInfoPanel dbSessionId="test-session" />);
    await act(async () => {
      fireEvent.click(screen.getByText('redis.monitor.refresh'));
    });

    // rawInfo stays truthy while filtered.sections drops to zero → terminal
    // arm renders the infoNoMatch notice (branch loc line 154 > 0).
    const input = screen.getByPlaceholderText('redis.monitor.infoSearchPlaceholder');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'no-such-token-anywhere' } });
    });

    expect(screen.getByText('redis.monitor.infoNoMatch')).toBeTruthy();
    // No section survives the filter, so the sections-count key is absent.
    expect(screen.queryByText(/redis\.monitor\.infoSections/)).toBeNull();
  });
});
