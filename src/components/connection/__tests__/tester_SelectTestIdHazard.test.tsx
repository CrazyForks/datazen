import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Select } from '@datazen/ui';
import { HttpProxyTunnelFields } from '../HttpProxyTunnelFields';
import { WebSocketTunnelFields } from '../WebSocketTunnelFields';
import type {
  HttpProxyTunnelFieldsValue,
  WebSocketTunnelFieldsValue,
} from '../tunnelFieldContracts';

vi.mock('../../../hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

/**
 * [tester] (h) — known hazard: `@datazen/ui`'s `Select` does not spread unknown
 * props (see `packages/ui/src/Select.tsx`: only the explicitly destructured props
 * plus `triggerDataAttrs` reach the DOM). A hyphenated JSX attribute such as
 * `data-testid` therefore compiles — TypeScript exempts non-identifier attribute
 * names from excess-property checking — but is silently dropped at runtime.
 *
 * Consequence: the pre-existing `new-conn-http-proxy-scheme` / `new-conn-ws-mode`
 * locators are inert. No unit test or E2E spec references them (verified by
 * repo-wide grep), so nothing was silently testing the wrong element; the usable
 * handle is the listbox trigger. If `Select` ever starts forwarding arbitrary
 * props, the negative assertions below must be turned into positive ones.
 */
describe('[tester] Select data-testid hazard (h)', () => {
  it('drops a hyphenated data-testid passed directly to Select', () => {
    render(
      <Select
        value="http"
        options={[
          { value: 'http', label: 'HTTP' },
          { value: 'https', label: 'HTTPS' },
        ]}
        onChange={() => {}}
        data-testid="probe-inert"
      />,
    );

    expect(screen.queryByTestId('probe-inert')).toBeNull();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does forward the explicitly supported triggerDataAttrs escape hatch', () => {
    render(
      <Select
        value="http"
        options={[{ value: 'http', label: 'HTTP' }]}
        onChange={() => {}}
        triggerDataAttrs={{ 'data-testid': 'probe-live' }}
      />,
    );

    expect(screen.getByTestId('probe-live')).toBeInTheDocument();
  });

  it('leaves the http proxy / websocket scheme and mode locators inert in production code', () => {
    const http: HttpProxyTunnelFieldsValue = {
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
    };
    const httpRender = render(<HttpProxyTunnelFields form={http} />);
    expect(screen.queryByTestId('new-conn-http-proxy-scheme')).toBeNull();
    expect(httpRender.container.querySelector('button[aria-haspopup="listbox"]')).not.toBeNull();
    httpRender.unmount();

    const ws: WebSocketTunnelFieldsValue = {
      wsUrl: '',
      setWsUrl: vi.fn(),
      wsMode: 'datazen_v1',
      setWsMode: vi.fn(),
      wsAuthToken: '',
      setWsAuthToken: vi.fn(),
      wsTimeout: '30',
      setWsTimeout: vi.fn(),
    };
    const wsRender = render(<WebSocketTunnelFields form={ws} />);
    expect(screen.queryByTestId('new-conn-ws-mode')).toBeNull();
    expect(wsRender.container.querySelector('button[aria-haspopup="listbox"]')).not.toBeNull();
  });

  it('keeps the settings editor on the supported triggerDataAttrs path', () => {
    render(
      <Select
        value="ssh"
        options={[{ value: 'ssh', label: 'SSH' }]}
        onChange={() => {}}
        triggerDataAttrs={{ 'data-testid': 'tunnel-edit-kind' }}
      />,
    );
    expect(screen.getByTestId('tunnel-edit-kind')).toBeInTheDocument();
    expect(screen.getByTestId('tunnel-edit-kind')).toHaveAttribute('aria-haspopup', 'listbox');
  });
});
