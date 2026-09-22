import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConnectionAdvancedSettings } from '../ConnectionAdvancedSettings';
import type { ConnectionFormState } from '../useConnectionForm';
import type { SavedTunnelSummary } from '../../../types';

vi.mock('../../../hooks/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../lib/windowManager', () => ({
  openSettingsWindow: vi.fn(),
}));

afterEach(cleanup);

const savedSsh: SavedTunnelSummary = { id: 'tun_ssh', name: 'Bastion', kind: 'ssh' };

/**
 * Fully typed mock form: every `ConnectionFormState` field is present, so a
 * contract change fails here instead of being hidden behind a cast.
 */
function createMockForm(overrides: Partial<ConnectionFormState> = {}): ConnectionFormState {
  return {
    name: '',
    setName: vi.fn(),
    databaseType: 'postgresql',
    setDatabaseType: vi.fn(),
    host: '127.0.0.1',
    setHost: vi.fn(),
    port: '5432',
    setPort: vi.fn(),
    database: 'postgres',
    setDatabase: vi.fn(),
    schema: 'default',
    setSchema: vi.fn(),
    username: 'postgres',
    setUsername: vi.fn(),
    password: '',
    setPassword: vi.fn(),
    sslMode: 'prefer',
    setSslMode: vi.fn(),
    group: '',
    setGroup: vi.fn(),
    colorTag: '#3b82f6',
    setColorTag: vi.fn(),
    readOnly: false,
    driverReadOnly: false,
    setReadOnly: vi.fn(),

    tunnelSource: 'none',
    setTunnelSource: vi.fn(),
    tunnelKind: 'none',
    setTunnelKind: vi.fn(),
    tunnelId: null,
    setTunnelId: vi.fn(),
    savedTunnels: [],
    savedTunnel: null,
    tunnelRefMissing: false,
    tunnelInlineValid: false,
    tunnelBusy: false,
    tunnelError: null,
    effectiveTunnelKind: 'none',
    unbindTunnel: vi.fn().mockResolvedValue(undefined),
    saveAsTunnel: vi.fn().mockResolvedValue(null),
    hydrateTunnelRef: vi.fn(),
    resetTunnel: vi.fn(),

    sshEnabled: false,
    setSshEnabled: vi.fn(),
    sshHost: '',
    setSshHost: vi.fn(),
    sshPort: '22',
    setSshPort: vi.fn(),
    sshUsername: '',
    setSshUsername: vi.fn(),
    sshAuthMethod: 'password',
    setSshAuthMethod: vi.fn(),
    sshPassword: '',
    setSshPassword: vi.fn(),
    sshKeyPath: '',
    setSshKeyPath: vi.fn(),
    sshPassphrase: '',
    setSshPassphrase: vi.fn(),
    sshJumpEnabled: false,
    setSshJumpEnabled: vi.fn(),
    sshJumpHost: '',
    setSshJumpHost: vi.fn(),
    sshJumpPort: '22',
    setSshJumpPort: vi.fn(),
    sshJumpUsername: '',
    setSshJumpUsername: vi.fn(),
    sshJumpAuthMethod: 'password',
    setSshJumpAuthMethod: vi.fn(),
    sshJumpPassword: '',
    setSshJumpPassword: vi.fn(),
    sshJumpKeyPath: '',
    setSshJumpKeyPath: vi.fn(),
    sshJumpPassphrase: '',
    setSshJumpPassphrase: vi.fn(),

    httpProxyHost: '',
    setHttpProxyHost: vi.fn(),
    httpProxyPort: '8080',
    setHttpProxyPort: vi.fn(),
    httpProxyScheme: 'http',
    setHttpProxyScheme: vi.fn(),
    httpProxyUsername: '',
    setHttpProxyUsername: vi.fn(),
    httpProxyPassword: '',
    setHttpProxyPassword: vi.fn(),
    httpProxyTimeout: '30',
    setHttpProxyTimeout: vi.fn(),

    wsUrl: '',
    setWsUrl: vi.fn(),
    wsMode: 'datazen_v1',
    setWsMode: vi.fn(),
    wsAuthToken: '',
    setWsAuthToken: vi.fn(),
    wsTimeout: '30',
    setWsTimeout: vi.fn(),

    formVariant: 'standard',
    hasUsername: true,
    supportsSSL: false,
    supportsSSH: true,
    sslOptions: [],
    handleDatabaseTypeChange: vi.fn(),
    onTest: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn().mockResolvedValue(undefined),
    testing: false,
    testOk: null,
    setTestOk: vi.fn(),
    testErr: null,
    setTestErr: vi.fn(),
    testResultRef: { current: null },
    showAdvanced: true,
    setShowAdvanced: vi.fn(),
    tabFill: () => () => undefined,
    validationErrors: {},
    validate: () => true,
    options: {},
    setOptions: vi.fn(),

    ...overrides,
  };
}

describe('ConnectionAdvancedSettings', () => {
  it('allows toggling read-only checkbox when driver is not read-only', () => {
    const setReadOnly = vi.fn();
    const form = createMockForm({ readOnly: false, driverReadOnly: false, setReadOnly });

    render(<ConnectionAdvancedSettings form={form} />);

    const checkbox = screen.getByRole('checkbox', { name: /newConn\.readOnly/i });
    expect(checkbox).not.toBeDisabled();
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(setReadOnly).toHaveBeenCalledWith(true);
  });

  it('disables read-only checkbox and shows locked hint when driver is read-only', () => {
    const setReadOnly = vi.fn();
    const form = createMockForm({ readOnly: true, driverReadOnly: true, setReadOnly });

    render(<ConnectionAdvancedSettings form={form} />);

    const checkbox = screen.getByRole('checkbox', { name: /newConn\.readOnly/i });
    expect(checkbox).toBeDisabled();
    expect(checkbox).toBeChecked();
    expect(screen.getByText('newConn.driverReadOnlyLocked')).toBeInTheDocument();

    fireEvent.click(checkbox);
    expect(setReadOnly).not.toHaveBeenCalled();
  });

  it('always renders the tunnel source control, even with an empty collection', () => {
    const form = createMockForm({ tunnelKind: 'none', savedTunnels: [] });
    render(<ConnectionAdvancedSettings form={form} />);
    fireEvent.click(screen.getByTestId('new-conn-tunnel-toggle'));
    expect(screen.getByTestId('new-conn-tunnel-source')).toBeInTheDocument();
    expect(screen.getByText('newConn.tunnelSource')).toBeInTheDocument();
  });

  it('guides the user and offers a create entry when no tunnel is saved yet', () => {
    const setTunnelSource = vi.fn();
    const form = createMockForm({ tunnelSource: 'none', savedTunnels: [], setTunnelSource });
    render(<ConnectionAdvancedSettings form={form} />);
    fireEvent.click(screen.getByTestId('new-conn-tunnel-toggle'));

    expect(screen.getByTestId('new-conn-tunnel-empty')).toBeInTheDocument();
    expect(screen.getByText('newConn.tunnelEmptyHint')).toBeInTheDocument();
    expect(screen.getByTestId('new-conn-tunnel-manage-entry')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('new-conn-tunnel-create-entry'));
    expect(setTunnelSource).toHaveBeenCalledWith('inline');
  });

  it('hides the empty-collection guidance once inline configuration is active', () => {
    const form = createMockForm({
      tunnelSource: 'inline',
      tunnelKind: 'httpProxy',
      savedTunnels: [],
    });
    render(<ConnectionAdvancedSettings form={form} />);
    // An active tunnel source keeps the panel expanded on its own.
    expect(screen.getByTestId('new-conn-tunnel-panel')).toBeInTheDocument();

    expect(screen.queryByTestId('new-conn-tunnel-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('new-conn-inline-tunnel')).toBeInTheDocument();
  });

  it('renders the saved-tunnel state with a read-only summary and an unbind action', () => {
    const unbindTunnel = vi.fn().mockResolvedValue(undefined);
    const form = createMockForm({
      tunnelSource: 'saved',
      tunnelKind: 'ssh',
      effectiveTunnelKind: 'ssh',
      tunnelId: 'tun_ssh',
      savedTunnels: [savedSsh],
      savedTunnel: savedSsh,
      unbindTunnel,
    });
    render(<ConnectionAdvancedSettings form={form} />);

    // Saved state keeps the panel open without any user toggle.
    expect(screen.getByTestId('new-conn-saved-tunnel')).toBeInTheDocument();
    expect(screen.getByTestId('new-conn-saved-tunnel-summary')).toHaveTextContent('Bastion');
    expect(screen.queryByTestId('new-conn-inline-tunnel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-conn-ssh-tunnel-checkbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('new-conn-tunnel-unbind'));
    expect(unbindTunnel).toHaveBeenCalledTimes(1);
  });

  it('warns when the referenced tunnel no longer exists', () => {
    const form = createMockForm({
      tunnelSource: 'saved',
      tunnelKind: 'ssh',
      tunnelId: 'tun_gone',
      savedTunnels: [savedSsh],
      savedTunnel: null,
      tunnelRefMissing: true,
    });
    render(<ConnectionAdvancedSettings form={form} />);

    expect(screen.getByTestId('new-conn-tunnel-missing')).toHaveTextContent(
      'newConn.tunnelMissing',
    );
  });

  it('renders HttpProxyTunnelFields when the inline kind is httpProxy', () => {
    const form = createMockForm({ tunnelSource: 'inline', tunnelKind: 'httpProxy' });
    render(<ConnectionAdvancedSettings form={form} />);
    expect(screen.getByTestId('new-conn-http-proxy-fields')).toBeInTheDocument();
    expect(screen.queryByTestId('new-conn-ws-fields')).not.toBeInTheDocument();
  });

  it('renders WebSocketTunnelFields when the inline kind is websocket', () => {
    const form = createMockForm({ tunnelSource: 'inline', tunnelKind: 'websocket' });
    render(<ConnectionAdvancedSettings form={form} />);
    expect(screen.getByTestId('new-conn-ws-fields')).toBeInTheDocument();
    expect(screen.queryByTestId('new-conn-http-proxy-fields')).not.toBeInTheDocument();
  });

  it('disables "save as tunnel" until the inline configuration is valid', () => {
    const invalid = createMockForm({
      tunnelSource: 'inline',
      tunnelKind: 'websocket',
      tunnelInlineValid: false,
    });
    const { unmount } = render(<ConnectionAdvancedSettings form={invalid} />);
    expect(screen.getByTestId('new-conn-tunnel-save-as')).toBeDisabled();
    unmount();

    const valid = createMockForm({
      tunnelSource: 'inline',
      tunnelKind: 'websocket',
      wsUrl: 'wss://relay.example/v1',
      tunnelInlineValid: true,
    });
    render(<ConnectionAdvancedSettings form={valid} />);
    expect(screen.getByTestId('new-conn-tunnel-save-as')).not.toBeDisabled();
  });

  it('opens the save dialog and submits the entered tunnel name', async () => {
    const saveAsTunnel = vi.fn().mockResolvedValue({ id: 'tun_new', name: 'Bastion', kind: 'ssh' });
    const form = createMockForm({
      tunnelSource: 'inline',
      tunnelKind: 'ssh',
      sshEnabled: true,
      sshHost: 'bastion.example.com',
      sshUsername: 'ops',
      tunnelInlineValid: true,
      saveAsTunnel,
    });
    render(<ConnectionAdvancedSettings form={form} />);

    fireEvent.click(screen.getByTestId('new-conn-tunnel-save-as'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('save-tunnel-name'), {
      target: { value: 'Bastion' },
    });
    fireEvent.click(screen.getByTestId('save-tunnel-confirm'));

    await vi.waitFor(() => expect(saveAsTunnel).toHaveBeenCalledWith('Bastion'));
  });

  it('switching the inline kind calls setTunnelKind without clearing tunnelId', () => {
    const setTunnelKind = vi.fn();
    const setTunnelId = vi.fn();
    const form = createMockForm({
      tunnelSource: 'inline',
      tunnelKind: 'httpProxy',
      setTunnelKind,
      setTunnelId,
    });
    render(<ConnectionAdvancedSettings form={form} />);

    // Open the kind select and pick the WebSocket option.
    const kindSelect = screen.getByTestId('new-conn-tunnel-kind');
    fireEvent.click(kindSelect.querySelector('button') ?? kindSelect);
    const option = screen
      .getAllByTestId('select-option')
      .find((el) => el.textContent?.includes('newConn.tunnelWebSocket'));
    expect(option).toBeTruthy();
    fireEvent.mouseDown(option as HTMLElement);

    expect(setTunnelKind).toHaveBeenCalledWith('websocket');
    // The old double-control bug: changing the kind must not clear the reference.
    expect(setTunnelId).not.toHaveBeenCalled();
  });
});
