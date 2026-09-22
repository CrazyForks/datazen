import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSyncExternalStore, type ReactNode } from 'react';
import type { KvContextBarProps } from '@datazen/driver-sdk';
import { ContentToolbar } from '../ContentToolbar';
import { createKvSlotState } from '../../../lib/kvSlotState';
import type { KvContextBarBinding } from '../useKvWorkspaceSlots';

// useCompactToolbar observes the toolbar width; jsdom has no ResizeObserver.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
globalThis.ResizeObserver ??= MockResizeObserver as unknown as typeof ResizeObserver;

vi.mock('../../../hooks/useI18n', () => ({
  // Key-style mock: assertions target i18n keys, never visible English copy.
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../lib/windowManager', () => ({
  openDocsWindow: vi.fn(),
}));

vi.mock('../../../components/DataTable/DetailPanelToggle', () => ({
  DetailPanelToggle: ({ children }: { children?: ReactNode }) => (
    <div data-testid="mock-detail-panel-toggle">{children}</div>
  ),
}));

/**
 * Fixture standing in for a driver's KV context bar: it renders the props the host
 * hands over as data attributes, subscribes to the shared selection atom and calls
 * `request` for a host action, which is exactly the contract Wave 2/3 implements
 * against.
 */
function FixtureContextBar({
  connectionId,
  dbSessionId,
  connectionName,
  databaseType,
  database,
  dbIndex,
  compact,
  state,
  request,
}: KvContextBarProps) {
  const selectedKey = useSyncExternalStore(state.subscribe, state.getSelectedKey);
  return (
    <div
      data-testid="fixture-context-bar"
      data-connection-id={connectionId}
      data-db-session-id={dbSessionId}
      data-connection-name={connectionName}
      data-database-type={databaseType}
      data-database={database ?? ''}
      data-db-index={dbIndex ?? ''}
      data-compact={String(compact)}
      data-selected-key={selectedKey ?? ''}
      data-request={typeof request === 'function' ? 'wired' : 'missing'}
    >
      <button
        type="button"
        data-testid="fixture-request-flush"
        onClick={() => request({ type: 'flushDb' })}
      >
        flush
      </button>
    </div>
  );
}

function binding(
  state: KvContextBarProps['state'],
  request: KvContextBarProps['request'] = vi.fn(),
): KvContextBarBinding {
  return {
    Component: FixtureContextBar,
    props: {
      connectionId: 'cfg-1',
      dbSessionId: 'sess-1',
      connectionName: 'KV Local',
      databaseType: 'redis' as never,
      database: 'db7',
      dbIndex: 7,
      state,
      request,
    },
  };
}

function renderToolbar(contextBarSlot?: KvContextBarBinding) {
  return render(
    <ContentToolbar
      showNewQuery={false}
      showNewTable={false}
      showErDiagram={false}
      showObjects={false}
      showBatchExport={false}
      aiChatOpen={false}
      detailPanelApplicable={false}
      detailOpen={false}
      contextBarSlot={contextBarSlot}
      onNewQuery={vi.fn()}
      onCreateTable={vi.fn()}
      onOpenErDiagram={vi.fn()}
      onOpenObjects={vi.fn()}
      onOpenPrivileges={vi.fn()}
      onBatchExport={vi.fn()}
      onToggleAiChat={vi.fn()}
      onToggleDetail={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ContentToolbar KV context bar slot', () => {
  it('keeps the plain spacer when no context bar was contributed', () => {
    const { container } = renderToolbar();
    const toolbar = container.firstElementChild as HTMLElement;

    expect(screen.queryByTestId('conn-toolbar-kv-context-bar')).not.toBeInTheDocument();
    // The pre-track 48px band is unchanged: a bare spacer, nothing else.
    expect(toolbar.querySelector(':scope > div[class="flex-1"]')).not.toBeNull();
  });

  it('renders the driver cluster into the 48px band with the frozen props', () => {
    const request = vi.fn();
    const { container } = renderToolbar(binding(createKvSlotState(), request));
    const toolbar = container.firstElementChild as HTMLElement;

    const bar = screen.getByTestId('conn-toolbar-kv-context-bar');
    expect(bar.getAttribute('data-slot')).toBe('kv-context-bar');
    const fixture = screen.getByTestId('fixture-context-bar');
    expect(fixture.getAttribute('data-connection-id')).toBe('cfg-1');
    expect(fixture.getAttribute('data-db-session-id')).toBe('sess-1');
    expect(fixture.getAttribute('data-db-index')).toBe('7');
    expect(fixture.getAttribute('data-database')).toBe('db7');
    // The toolbar owns `compact`; the driver never has to observe the width itself.
    expect(fixture.getAttribute('data-compact')).toBe('false');
    // P-1: the driver cluster takes the free space instead of an empty band.
    expect(bar.className).toContain('flex-1');
    expect(toolbar.querySelector(':scope > div[class="flex-1"]')).toBeNull();
    // §1.2: the reverse action channel reaches the slot through its props.
    expect(fixture.getAttribute('data-request')).toBe('wired');
    fireEvent.click(screen.getByTestId('fixture-request-flush'));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ type: 'flushDb' });
  });

  it('re-renders the driver cluster when the panel selection changes', () => {
    const state = createKvSlotState();
    renderToolbar(binding(state));
    expect(screen.getByTestId('fixture-context-bar').getAttribute('data-selected-key')).toBe('');

    act(() => {
      state.selectKey('user:42');
    });

    expect(screen.getByTestId('fixture-context-bar').getAttribute('data-selected-key')).toBe(
      'user:42',
    );
  });
});
