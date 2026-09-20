import { describe, expect, it, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  getLocale,
  getRegisteredTranslations,
  registerTranslations,
  setLocale,
  t,
  useI18n,
} from '../i18n';

function Probe() {
  const { t: translate, language } = useI18n();
  return (
    <div>
      <span data-testid="label">{translate('greeting.hello', { name: 'Ada' })}</span>
      <span data-testid="lang">{language}</span>
    </div>
  );
}

describe('@datazen/ui i18n engine (single implementation)', () => {
  registerTranslations({
    en: { 'greeting.hello': 'Hello {name}!', 'settings.plain': 'Plain' },
    'zh-CN': { 'greeting.hello': '你好，{name}！' },
  });

  afterEach(() => {
    setLocale('en');
  });

  it('resolves the active locale and interpolates {param}', () => {
    expect(t('greeting.hello', { name: 'Ada' })).toBe('Hello Ada!');
    setLocale('zh-CN');
    expect(getLocale()).toBe('zh-CN');
    expect(t('greeting.hello', { name: 'Ada' })).toBe('你好，Ada！');
  });

  it('falls back to en then to the raw key', () => {
    setLocale('zh-CN');
    expect(t('settings.plain')).toBe('Plain');
    expect(t('no.such.key', { x: 1 })).toBe('no.such.key');
    // Empty-string values are real translations, not missing keys.
    registerTranslations({ 'zh-CN': { 'option.separator': '' } });
    expect(t('option.separator')).toBe('');
  });

  it('keeps unmatched {tokens} intact during interpolation', () => {
    registerTranslations({ en: { 'partial.tokens': '{a} and {b}' } });
    expect(t('partial.tokens', { a: 'A' })).toBe('A and {b}');
  });

  it('merges repeated registrations (later wins per key)', () => {
    registerTranslations({ 'zh-CN': { 'settings.plain': '朴素' } });
    registerTranslations({ 'zh-CN': { 'settings.plain': '纯文本' } });
    setLocale('zh-CN');
    expect(t('settings.plain')).toBe('纯文本');
  });

  it('exposes a read-only snapshot of the registered dictionary', () => {
    registerTranslations({ 'xx-XX': { 'snapshot.only': 'Snap' } });
    expect(getRegisteredTranslations('xx-XX')).toEqual({ 'snapshot.only': 'Snap' });
    // Mutating the snapshot must not write back into the registry.
    const snapshot = getRegisteredTranslations('xx-XX');
    snapshot['snapshot.only'] = 'tampered';
    delete snapshot['snapshot.only'];
    expect(getRegisteredTranslations('xx-XX')['snapshot.only']).toBe('Snap');
    setLocale('xx-XX');
    expect(t('snapshot.only')).toBe('Snap');
    expect(getRegisteredTranslations('no-such-locale')).toEqual({});
    // Host snapshot covers every registration so far (host + driver packs).
    expect(getRegisteredTranslations('en')['greeting.hello']).toBe('Hello {name}!');
  });

  it('re-renders useI18n consumers when the locale changes', () => {
    render(<Probe />);
    expect(screen.getByTestId('label').textContent).toBe('Hello Ada!');
    expect(screen.getByTestId('lang').textContent).toBe('en');
    act(() => setLocale('zh-CN'));
    expect(screen.getByTestId('label').textContent).toBe('你好，Ada！');
    expect(screen.getByTestId('lang').textContent).toBe('zh-CN');
    act(() => setLocale('en'));
    expect(screen.getByTestId('label').textContent).toBe('Hello Ada!');
  });
});
