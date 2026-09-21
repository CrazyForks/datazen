import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { KeyPropsSidebarProps } from '@datazen/driver-sdk';
import { ContentViewDrawers } from '../ContentViewDrawers';
import type { KvKeyPropsSidebarBinding } from '../useKvWorkspaceSlots';
import type { Panel } from '../../../stores/panelStore';

vi.mock('../../../hooks/useResizable', () => ({
  useResizable: () => ({ size: 320, handleRef: { current: null }, startResize: vi.fn() }),
}));

// The row-detail drawer is what a KV panel used to show empty; keep it as a spy.
vi.mock('../../../components/DataTable/DetailPanel', () => ({
  DetailPanel: ({ open }: { open: boolean }) => (
    <div data-testid="mock-detail-panel" data-open={String(open)} />
  ),
}));

vi.mock('../../../components/ai/AiChatPanel', () => ({
  AiChatPanel: () => <div data-testid="mock-ai-chat-panel" />,
}));

const KV_PANEL = {
  id: 'panel-kv-1',
  type: 'redis-db',
  connectionId: 'cfg-1',
  dbSessionId: 'sess-1',
  connectionName: 'KV Local',
  databaseType: 'redis',
  dbName: 'db7',
} as unknown as Panel;

/** Fixture standing in for a driver's key-props sidebar: props echoed as data. */
function FixtureKeyPropsSidebar({
  connectionId,
  dbSessionId,
  database,
  dbIndex,
  open,
  onClose,
  state,
}: KeyPropsSidebarProps) {
  if (!open) return null;
  return (
    <div
      data-testid="fixture-key-props-sidebar"
      data-connection-id={connectionId}
      data-db-session-id={dbSessionId}
      data-database={database ?? ''}
      data-db-index={dbIndex ?? ''}
      data-open={String(open)}
      data-has-state={state ? 'yes' : 'no'}
    >
      <button data-testid="fixture-sidebar-close" onClick={onClose} />
    </div>
  );
}

const state = {
  subscribe: () => () => {},
  getSelectedKey: () => 'user:42',
  selectKey: vi.fn(),
  getDirty: () => true,
  setDirty: vi.fn(),
};

const slot: KvKeyPropsSidebarBinding = {
  Component: FixtureKeyPropsSidebar,
  props: {
    connectionId: 'cfg-1',
    dbSessionId: 'sess-1',
    connectionName: 'KV Local',
    databaseType: 'redis',
    database: 'db7',
    dbIndex: 7,
    state,
  },
};

function renderDrawers(over: Partial<ComponentProps<typeof ContentViewDrawers>> = {}) {
  return render(
    <ContentViewDrawers
      activePanel={KV_PANEL}
      detailOpen
      aiChatOpen={false}
      detailPanelApplicable
      dbSessionId="sess-1"
      currentDatabase="db7"
      databaseType="redis"
      onCloseDetail={vi.fn()}
      pendingDraftRequest={null}
      onDraftConsumed={vi.fn()}
      {...over}
    />,
  );
}

afterEach(cleanup);

describe('ContentViewDrawers key-props sidebar slot', () => {
  it('renders the driver sidebar in the drawer instead of the empty row-detail table', () => {
    renderDrawers({ keyPropsSidebarSlot: slot });

    const drawer = screen.getByTestId('conn-kv-key-props-sidebar');
    expect(drawer.getAttribute('data-slot')).toBe('kv-key-props-sidebar');

    const fixture = screen.getByTestId('fixture-key-props-sidebar');
    expect(fixture.getAttribute('data-connection-id')).toBe('cfg-1');
    expect(fixture.getAttribute('data-db-session-id')).toBe('sess-1');
    expect(fixture.getAttribute('data-database')).toBe('db7');
    expect(fixture.getAttribute('data-db-index')).toBe('7');
    expect(fixture.getAttribute('data-has-state')).toBe('yes');
    // P-3: the drawer now carries content — the blank row grid is gone.
    expect(screen.queryByTestId('mock-detail-panel')).not.toBeInTheDocument();
  });

  it('hands the host drawer open state down to the sidebar', () => {
    renderDrawers({ keyPropsSidebarSlot: slot, detailOpen: false });

    // The host owns `open`; the driver decides to render nothing while collapsed.
    expect(screen.getByTestId('conn-kv-key-props-sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('fixture-key-props-sidebar')).not.toBeInTheDocument();
  });

  it('wires the sidebar close request back to the host toggle', () => {
    const onCloseDetail = vi.fn();
    renderDrawers({ keyPropsSidebarSlot: slot, detailOpen: true, onCloseDetail });

    expect(screen.getByTestId('fixture-key-props-sidebar').getAttribute('data-open')).toBe('true');
    fireEvent.click(screen.getByTestId('fixture-sidebar-close'));
    expect(onCloseDetail).toHaveBeenCalledOnce();
  });

  it('keeps the row-detail drawer when the driver contributes no sidebar', () => {
    renderDrawers();

    expect(screen.queryByTestId('conn-kv-key-props-sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-detail-panel')).toBeInTheDocument();
  });

  it('renders no drawer at all while the detail panel is not applicable', () => {
    renderDrawers({ keyPropsSidebarSlot: slot, detailPanelApplicable: false });

    expect(screen.queryByTestId('conn-kv-key-props-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-detail-panel')).not.toBeInTheDocument();
  });
});
