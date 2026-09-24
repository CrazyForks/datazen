import { Boxes, Download, Plus, Radio, Terminal } from 'lucide-react';
import { useI18n } from '@datazen/ui';
import { OverviewCard } from './OverviewCard';
import type { OverviewJumpHandler, OverviewJumpTarget } from './overviewNavigation';
import { jumpStateAttribute } from './overviewNavigation';

/**
 * KV 版快捷动作（PRD §3.1 第六行）— 取代 SQL `quickActions` 在 Redis 下长度为 0
 * 的问题。动作集是**键值语义**（浏览库 / 命令行 / 发布订阅 / 导入导出 / 新建键），
 * 不含 newQuery / newTable / ER 图。
 */
export interface QuickAction {
  id: 'browseDb' | 'console' | 'pubsub' | 'importExport' | 'newKey';
  labelKey: string;
  icon: typeof Boxes;
  target: OverviewJumpTarget;
}

export function buildQuickActions(defaultDbIndex: number): QuickAction[] {
  return [
    {
      id: 'browseDb',
      labelKey: 'redis.overview.action.browseDb',
      icon: Boxes,
      target: { kind: 'database', dbIndex: defaultDbIndex },
    },
    {
      id: 'console',
      labelKey: 'redis.overview.action.console',
      icon: Terminal,
      target: { kind: 'console' },
    },
    {
      id: 'pubsub',
      labelKey: 'redis.overview.action.pubsub',
      icon: Radio,
      target: { kind: 'pubsub' },
    },
    {
      id: 'importExport',
      labelKey: 'redis.overview.action.importExport',
      icon: Download,
      target: { kind: 'importExport' },
    },
    {
      id: 'newKey',
      labelKey: 'redis.overview.action.newKey',
      icon: Plus,
      target: { kind: 'newKey', dbIndex: defaultDbIndex },
    },
  ];
}

export interface QuickActionsCardProps {
  defaultDbIndex: number;
  onJump: (target: OverviewJumpTarget) => void;
  jumpHandler?: OverviewJumpHandler;
}

export function QuickActionsCard({ defaultDbIndex, onJump, jumpHandler }: QuickActionsCardProps) {
  const { t } = useI18n();
  const jumpState = jumpStateAttribute(jumpHandler);
  const actions = buildQuickActions(defaultDbIndex);

  return (
    <OverviewCard cardId="actions" titleKey="redis.overview.actions.title">
      <ul className="flex flex-wrap gap-1.5 p-2.5 text-xs">
        {actions.map((action) => (
          <li key={action.id}>
            <button
              type="button"
              data-overview-action={action.id}
              data-overview-action-target={action.target.kind}
              data-overview-jump={jumpState}
              className="flex h-7 items-center gap-1.5 rounded-full border border-edge bg-surface-alt px-2.5 text-fg-secondary transition-colors hover:border-accent/45 hover:text-fg"
              onClick={() => onJump(action.target)}
            >
              <action.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t(action.labelKey)}
            </button>
          </li>
        ))}
      </ul>
    </OverviewCard>
  );
}
