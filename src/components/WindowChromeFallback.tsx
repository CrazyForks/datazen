import { TitleBar } from './TitleBar';
import { Spinner } from './ui/Spinner';

/**
 * Overlay title-bar windows have no native drag area until React mounts.
 * Use as Suspense/error chrome so the window can be moved and closed.
 */
export function WindowChromeFallback() {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-surface" data-testid="window-chrome-fallback">
      <TitleBar />
      <div className="flex flex-1 items-center justify-center">
        {/*
          A bare spinner is the only thing on screen here, so it is the one
          place in the app that has to announce itself. The label is a literal
          rather than a `t()` call for the same reason as `LocaleDomainLoading`:
          this renders before the i18n domain can be trusted.
        */}
        <Spinner variant="ring" size="2xl" tone="accent" label="Loading" />
      </div>
    </div>
  );
}
