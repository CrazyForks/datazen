import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../htmlSanitizer';

describe('htmlSanitizer', () => {
  it('passes safe HTML through', () => {
    const input = '<p>Hello <strong>world</strong></p>';
    expect(sanitizeHtml(input)).toContain('Hello');
    expect(sanitizeHtml(input)).toContain('<strong>');
  });

  it('strips script tags', () => {
    const input = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('<script');
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  it('strips iframe tags', () => {
    const input = '<iframe src="evil.com"></iframe>';
    expect(sanitizeHtml(input)).not.toContain('<iframe');
  });

  it('strips event handler attributes', () => {
    const input = '<p onclick="alert(1)">Hello</p>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('onclick');
    expect(result).toContain('Hello');
  });

  it('neuters javascript: links', () => {
    const input = '<a href="javascript:alert(1)">Click</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('javascript:');
    expect(result).toContain('href="#"');
    expect(result).toContain('Click');
  });

  it('adds target="_blank" and rel="noopener noreferrer" to links', () => {
    const input = '<a href="https://example.com">Link</a>';
    const result = sanitizeHtml(input);
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it('strips style tags', () => {
    const input = '<style>body { color: red; }</style><p>Hello</p>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('<style');
    expect(result).toContain('Hello');
  });

  it('strips form/input elements', () => {
    const input = '<form><input type="text" /></form>';
    expect(sanitizeHtml(input)).not.toContain('<form');
    expect(sanitizeHtml(input)).not.toContain('<input');
  });

  it('handles nested dangerous content', () => {
    const input = '<div><p>Hello</p><script>evil()</script><p>World</p></div>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('<script');
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  it('preserves markdown-rendered HTML structures', () => {
    const input =
      '<h1>Title</h1><ul><li>Item 1</li><li>Item 2</li></ul><pre><code>const x = 1;</code></pre>';
    const result = sanitizeHtml(input);
    expect(result).toContain('<h1>');
    expect(result).toContain('<ul>');
    expect(result).toContain('<pre>');
  });

  it('strips onmouseover and other event handlers', () => {
    const input = '<div onmouseover="alert(1)" onfocus="alert(2)">hover</div>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('onmouseover');
    expect(result).not.toContain('onfocus');
    expect(result).toContain('hover');
  });

  it('handles javascript: in href with various casing', () => {
    const input = '<a href="JAVASCRIPT:alert(1)">XSS</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('JAVASCRIPT:');
  });
});
