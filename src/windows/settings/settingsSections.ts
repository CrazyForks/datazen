import type { TranslationKey } from '../../locales';

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
  | 'tunnels'
  | 'extensions';

/**
 * Section labels are host translation keys. `TranslationKey` is derived from the
 * zh-CN pack, and the i18n rule for development is "en only" — so a freshly
 * added en key is not part of that union yet and must be listed explicitly.
 * Listing it here still fails type-checking on a typo, unlike widening the whole
 * array to the loose `I18nKey` (`TranslationKey | string`).
 */
export type SettingsSectionLabelKey = TranslationKey | 'settings.tunnels.title';

export const SETTINGS_SECTIONS: { id: SettingsSection; labelKey: SettingsSectionLabelKey }[] = [
  { id: 'general', labelKey: 'settings.general' },
  { id: 'appearance', labelKey: 'settings.appearance' },
  { id: 'dataBrowsing', labelKey: 'settings.dataBrowsing' },
  { id: 'editor', labelKey: 'settings.editor' },
  { id: 'behavior', labelKey: 'settings.behavior' },
  { id: 'logging', labelKey: 'settings.logging' },
  { id: 'ai', labelKey: 'common.aiAssistant' },
  { id: 'prompts', labelKey: 'settings.prompts' },
  { id: 'mcpServer', labelKey: 'settings.mcp.title' },
  { id: 'mcpClient', labelKey: 'settings.mcpClient.title' },
  { id: 'tunnels', labelKey: 'settings.tunnels.title' },
  { id: 'extensions', labelKey: 'settings.extensions.title' },
];

export function parseSettingsSection(value: string | null | undefined): SettingsSection {
  if (value && SETTINGS_SECTIONS.some((s) => s.id === value)) {
    return value as SettingsSection;
  }
  return 'general';
}
