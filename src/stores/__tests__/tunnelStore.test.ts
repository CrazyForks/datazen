import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SavedTunnel, SavedTunnelSummary } from '../../types';

const mockTunnelCommands = {
  getTunnels: vi.fn(),
  getTunnelSummaries: vi.fn(),
  getTunnel: vi.fn(),
  getTunnelUsage: vi.fn(),
  saveTunnel: vi.fn(),
  deleteTunnel: vi.fn(),
  testTunnel: vi.fn(),
};

vi.mock('../../commands/tunnel', () => ({
  tunnelCommands: mockTunnelCommands,
}));

const sshSummary: SavedTunnelSummary = { id: 'tun_ssh', name: 'Bastion', kind: 'ssh' };

const sshTunnel: SavedTunnel = {
  id: 'tun_ssh',
  name: 'Bastion',
  kind: 'ssh',
  ssh: {
    enabled: true,
    host: 'bastion.example.com',
    port: 22,
    username: 'ops',
    authMethod: 'agent',
  },
};

describe('tunnelStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('load() fetches once, short-circuits when already loaded, and refetches on force', async () => {
    const { useTunnelStore } = await import('../tunnelStore');
    mockTunnelCommands.getTunnelSummaries.mockResolvedValue([sshSummary]);

    await useTunnelStore.getState().load();
    expect(mockTunnelCommands.getTunnelSummaries).toHaveBeenCalledTimes(1);
    expect(useTunnelStore.getState().summaries).toEqual([sshSummary]);
    expect(useTunnelStore.getState().loaded).toBe(true);
    expect(useTunnelStore.getState().loading).toBe(false);

    await useTunnelStore.getState().load();
    expect(mockTunnelCommands.getTunnelSummaries).toHaveBeenCalledTimes(1);

    await useTunnelStore.getState().load(true);
    expect(mockTunnelCommands.getTunnelSummaries).toHaveBeenCalledTimes(2);
  });

  it('load() degrades to an empty collection without throwing on failure', async () => {
    const { useTunnelStore } = await import('../tunnelStore');
    mockTunnelCommands.getTunnelSummaries.mockRejectedValue('ipc exploded');

    await expect(useTunnelStore.getState().load()).resolves.toBeUndefined();
    expect(useTunnelStore.getState().summaries).toEqual([]);
    expect(useTunnelStore.getState().loaded).toBe(true);
    expect(useTunnelStore.getState().loading).toBe(false);
    expect(useTunnelStore.getState().error).toBe('ipc exploded');

    // A failed load still counts as loaded: no retry storm on every render.
    await useTunnelStore.getState().load();
    expect(mockTunnelCommands.getTunnelSummaries).toHaveBeenCalledTimes(1);
  });

  it('create() generates an id, persists the entity, and refreshes the collection', async () => {
    const { useTunnelStore } = await import('../tunnelStore');
    mockTunnelCommands.saveTunnel.mockResolvedValue(undefined);
    mockTunnelCommands.getTunnelSummaries.mockResolvedValue([sshSummary]);

    const created = await useTunnelStore
      .getState()
      .create({ name: 'Bastion', kind: 'ssh', ssh: sshTunnel.ssh });

    expect(created.id).toMatch(/^tun_/);
    expect(created.name).toBe('Bastion');
    expect(mockTunnelCommands.saveTunnel).toHaveBeenCalledWith(created);
    expect(mockTunnelCommands.getTunnelSummaries).toHaveBeenCalledTimes(1);
    expect(useTunnelStore.getState().summaries).toEqual([sshSummary]);
  });

  it('create() keeps an explicitly supplied id', async () => {
    const { useTunnelStore } = await import('../tunnelStore');
    mockTunnelCommands.saveTunnel.mockResolvedValue(undefined);
    mockTunnelCommands.getTunnelSummaries.mockResolvedValue([]);

    const created = await useTunnelStore
      .getState()
      .create({ id: 'tun_fixed', name: 'Fixed', kind: 'websocket' });

    expect(created.id).toBe('tun_fixed');
    expect(mockTunnelCommands.saveTunnel).toHaveBeenCalledWith(created);
  });

  it('create() propagates persistence failures to the caller', async () => {
    const { useTunnelStore } = await import('../tunnelStore');
    mockTunnelCommands.saveTunnel.mockRejectedValue(new Error('disk full'));

    await expect(
      useTunnelStore.getState().create({ name: 'Nope', kind: 'ssh', ssh: sshTunnel.ssh }),
    ).rejects.toThrow('disk full');
    expect(useTunnelStore.getState().summaries).toEqual([]);
  });

  it('update() and remove() persist then refresh the collection', async () => {
    const { useTunnelStore } = await import('../tunnelStore');
    mockTunnelCommands.saveTunnel.mockResolvedValue(undefined);
    mockTunnelCommands.deleteTunnel.mockResolvedValue(undefined);
    mockTunnelCommands.getTunnelSummaries.mockResolvedValue([]);

    await useTunnelStore.getState().update({ ...sshTunnel, name: 'Renamed' });
    expect(mockTunnelCommands.saveTunnel).toHaveBeenCalledWith({ ...sshTunnel, name: 'Renamed' });
    expect(mockTunnelCommands.getTunnelSummaries).toHaveBeenCalledTimes(1);

    await useTunnelStore.getState().remove('tun_ssh');
    expect(mockTunnelCommands.deleteTunnel).toHaveBeenCalledWith('tun_ssh');
    expect(mockTunnelCommands.getTunnelSummaries).toHaveBeenCalledTimes(2);
  });

  it('usage() delegates to get_tunnel_usage', async () => {
    const { useTunnelStore } = await import('../tunnelStore');
    const usage = { connectionIds: ['c1'], connectionNames: ['Prod'] };
    mockTunnelCommands.getTunnelUsage.mockResolvedValue(usage);

    await expect(useTunnelStore.getState().usage('tun_ssh')).resolves.toEqual(usage);
    expect(mockTunnelCommands.getTunnelUsage).toHaveBeenCalledWith('tun_ssh');
  });

  it('newTunnelId() never collides with connection ids', async () => {
    const { newTunnelId } = await import('../tunnelStore');
    expect(newTunnelId()).toMatch(/^tun_[a-z0-9]+$/);
    expect(newTunnelId()).not.toBe(newTunnelId());
  });
});
