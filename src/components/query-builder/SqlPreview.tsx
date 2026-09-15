import { useI18n } from '../../hooks/useI18n';

interface SqlPreviewProps {
  sql: string;
}

export function SqlPreview({ sql }: SqlPreviewProps) {
  const { t } = useI18n();

  if (!sql) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-fg-secondary">
        {t('query.visualBuilder.preview')}
      </span>
      <pre className="overflow-auto rounded-lg border border-edge bg-surface-alt p-3 font-mono text-[12px] leading-relaxed text-fg select-all">
        <code>{sql}</code>
      </pre>
    </div>
  );
}
