import type { I18nKey, TranslationKey } from '../../locales';

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'dataBrowsing'
  | 'editor'
  | 'behavior'
  | 'logging'
  | 'ai'
  | 'prompts'
  | 'mcpServer'
  | 'mcpClient'
  | 'extensions';

/**
 * Nav groups only bucket the flat section list for display. Section ids, their
 * order and the `initialSection` deep-link contract stay exactly as they were —
 * a group is never a navigation target of its own.
 */
export type SettingsNavGroup = 'app' | 'integration';

export const SETTINGS_NAV_GROUPS: { id: SettingsNavGroup; labelKey: I18nKey }[] = [
  { id: 'app', labelKey: 'settings.nav.group.app' },
  { id: 'integration', labelKey: 'settings.nav.group.integration' },
];

export const SETTINGS_SECTIONS: {
  id: SettingsSection;
  labelKey: TranslationKey;
  group: SettingsNavGroup;
}[] = [
  { id: 'general', labelKey: 'settings.general', group: 'app' },
  { id: 'appearance', labelKey: 'settings.appearance', group: 'app' },
  { id: 'dataBrowsing', labelKey: 'settings.dataBrowsing', group: 'app' },
  { id: 'editor', labelKey: 'settings.editor', group: 'app' },
  { id: 'behavior', labelKey: 'settings.behavior', group: 'app' },
  { id: 'logging', labelKey: 'settings.logging', group: 'app' },
  { id: 'ai', labelKey: 'common.aiAssistant', group: 'integration' },
  { id: 'prompts', labelKey: 'settings.prompts', group: 'integration' },
  { id: 'mcpServer', labelKey: 'settings.mcp.title', group: 'integration' },
  { id: 'mcpClient', labelKey: 'settings.mcpClient.title', group: 'integration' },
  { id: 'extensions', labelKey: 'settings.extensions.title', group: 'integration' },
];

export function parseSettingsSection(value: string | null | undefined): SettingsSection {
  if (value && SETTINGS_SECTIONS.some((s) => s.id === value)) {
    return value as SettingsSection;
  }
  return 'general';
}
