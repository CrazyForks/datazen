import { useCallback, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../hooks/useI18n';
import {
  checkForUpdates,
  downloadAndInstallUpdate,
  isUpdaterSupported,
  type UpdateProgress,
} from '../../lib/updater';

import { SectionTitle, ToggleRow } from './settingsUi';

function progressLabel(
  progress: UpdateProgress,
  t: (key: import('../../locales').TranslationKey) => string,
): string {
  switch (progress.phase) {
    case 'checking':
      return t('settings.updater.checking');
    case 'downloading':
      if (progress.total) {
        const pct = Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
        return t('settings.updater.downloading').replace('{pct}', String(pct));
      }
      return t('settings.updater.downloadingIndeterminate');
    case 'installing':
      return t('settings.updater.installing');
    case 'done':
      return t('settings.updater.installed').replace('{version}', progress.version);
    default:
      return '';
  }
}

export function UpdateSection({
  checkOnStartup,
  onCheckOnStartupChange,
}: {
  checkOnStartup: boolean;
  onCheckOnStartupChange: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = useCallback(async () => {
    if (!isUpdaterSupported()) {
      setError(t('settings.updater.unavailable'));
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(t('settings.updater.checking'));

    const result = await checkForUpdates();
    if (result.status === 'upToDate') {
      setStatus(t('settings.updater.upToDate'));
    } else if (result.status === 'available') {
      setStatus(t('settings.updater.available').replace('{version}', result.version));
    } else if (result.status === 'error') {
      setError(result.message);
      setStatus(null);
    }
    setBusy(false);
  }, [t]);

  const handleDownload = useCallback(async () => {
    if (!isUpdaterSupported()) {
      setError(t('settings.updater.unavailable'));
      return;
    }

    setBusy(true);
    setError(null);

    const result = await downloadAndInstallUpdate((progress) => {
      setStatus(progressLabel(progress, t));
    });

    if (result.status === 'upToDate') {
      setStatus(t('settings.updater.upToDate'));
    } else if (result.status === 'installed') {
      setStatus(t('settings.updater.installed').replace('{version}', result.version));
    } else if (result.status === 'error') {
      setError(result.message);
      setStatus(null);
    }
    setBusy(false);
  }, [t]);

  const handleStartupToggle = (enabled: boolean) => {
    onCheckOnStartupChange(enabled);
  };

  if (!isUpdaterSupported()) {
    return null;
  }

  return (
    <>
      <SectionTitle hint={t('settings.updater.description')}>
        {t('settings.updater.title')}
      </SectionTitle>

      <ToggleRow
        label={t('settings.updater.checkOnStartup')}
        checked={checkOnStartup}
        onChange={(v) => void handleStartupToggle(v)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => void handleCheck()}>
          {t('settings.updater.check')}
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void handleDownload()}>
          {t('settings.updater.downloadInstall')}
        </Button>
      </div>

      {status && <p className="text-xs text-fg-secondary">{status}</p>}
      {error && <p className="select-text text-xs text-red-500">{error}</p>}
    </>
  );
}
