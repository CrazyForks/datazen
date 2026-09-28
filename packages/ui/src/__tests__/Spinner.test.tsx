/**
 * Spinner: the size/tone/variant matrix that has to reproduce the exact boxes
 * the hand-written `animate-spin` markup used, and — the part that actually
 * matters — the accessibility contract. The default spinner must stay
 * decorative (`aria-hidden`), and a spinner that is the *only* feedback on
 * screen must be able to promote itself into a live status region.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Spinner } from '../Spinner';
import type { SpinnerSize, SpinnerTone } from '../Spinner';

afterEach(cleanup);

/**
 * The single element the spinner renders when it is purely decorative.
 * `getAttribute('class')` rather than `.className`: the glyph is an SVG
 * element, whose `className` is an `SVGAnimatedString`, not a string.
 */
function glyphOf(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  if (!el) throw new Error('spinner rendered nothing');
  return el as HTMLElement;
}

function classesOf(el: Element): string {
  return el.getAttribute('class') ?? '';
}

describe('Spinner size matrix', () => {
  const CASES: ReadonlyArray<[SpinnerSize, string]> = [
    ['xs', 'h-2.5 w-2.5'],
    ['sm', 'h-3 w-3'],
    ['md', 'h-3.5 w-3.5'],
    ['lg', 'h-4 w-4'],
    ['xl', 'h-5 w-5'],
    ['2xl', 'h-6 w-6'],
  ];

  it.each(CASES)('[tester] size=%s renders the %s box', (size, expected) => {
    const { container } = render(<Spinner size={size} />);
    const glyph = glyphOf(container);
    expect(classesOf(glyph)).toContain(expected);
  });

  it('[tester] default size is md', () => {
    const { container } = render(<Spinner />);
    expect(classesOf(glyphOf(container))).toContain('h-3.5 w-3.5');
  });

  it('[tester] every size still animates', () => {
    for (const [size] of CASES) {
      const { container, unmount } = render(<Spinner size={size} />);
      expect(classesOf(glyphOf(container))).toContain('animate-spin');
      unmount();
    }
  });
});

describe('Spinner tone matrix', () => {
  const CASES: ReadonlyArray<[SpinnerTone, string | null]> = [
    ['current', null],
    ['accent', 'text-accent'],
    ['muted', 'text-fg-muted'],
  ];

  it.each(CASES)('[tester] icon tone=%s applies %s', (tone, expected) => {
    const { container } = render(<Spinner tone={tone} />);
    const cls = classesOf(glyphOf(container));
    if (expected === null) {
      expect(cls).not.toContain('text-accent');
      expect(cls).not.toContain('text-fg-muted');
    } else {
      expect(cls).toContain(expected);
    }
  });

  it.each(CASES)('[tester] ring tone=%s paints the border with %s', (tone, expected) => {
    const { container } = render(<Spinner variant="ring" tone={tone} />);
    const cls = classesOf(glyphOf(container));
    if (expected === null) {
      expect(cls).toContain('border-current');
    } else {
      expect(cls).toContain(expected.replace('text-', 'border-'));
    }
  });
});

describe('Spinner variant', () => {
  it('[tester] default variant is the stroked glyph, not the ring', () => {
    const { container } = render(<Spinner />);
    expect(glyphOf(container).tagName.toLowerCase()).toBe('svg');
  });

  it('[tester] ring variant is a bordered circle with a transparent leading edge', () => {
    const { container } = render(<Spinner variant="ring" />);
    const ring = glyphOf(container);
    expect(ring.tagName.toLowerCase()).toBe('span');
    const cls = classesOf(ring);
    expect(cls).toContain('rounded-full');
    expect(cls).toContain('border-2');
    expect(cls).toContain('border-t-transparent');
  });

  it('[tester] ring variant is available at every size', () => {
    const { container } = render(<Spinner variant="ring" size="2xl" tone="accent" />);
    const cls = classesOf(glyphOf(container));
    expect(cls).toContain('h-6 w-6');
    expect(cls).toContain('border-accent');
  });
});

describe('Spinner accessibility', () => {
  it('[tester] an unlabelled spinner is decorative and hidden from screen readers', () => {
    const { container } = render(<Spinner />);
    const glyph = glyphOf(container);
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    expect(glyph.getAttribute('role')).toBeNull();
  });

  it('[tester] an unlabelled spinner announces nothing at all', () => {
    const { queryByRole } = render(<Spinner />);
    expect(queryByRole('status')).toBeNull();
  });

  it('[tester] a labelled spinner becomes a busy status region', () => {
    const { getByRole } = render(<Spinner label="Loading rows" />);
    const status = getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
  });

  it('[tester] a labelled spinner carries the label as visually hidden text', () => {
    const { getByText } = render(<Spinner label="Loading rows" />);
    expect(getByText('Loading rows').className).toContain('sr-only');
  });

  it('[tester] the animated glyph inside a labelled spinner stays aria-hidden', () => {
    const { getByRole } = render(<Spinner label="Loading rows" />);
    const status = getByRole('status');
    const glyph = status.firstElementChild;
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
  });

  it('[tester] a labelled ring spinner also hides its glyph', () => {
    const { getByRole } = render(<Spinner variant="ring" label="Exporting" />);
    const glyph = getByRole('status').firstElementChild;
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
  });

  it('[tester] a labelled spinner does not double up the spin role on the glyph', () => {
    const { getAllByRole } = render(<Spinner label="Loading" />);
    // Exactly one status region — the wrapper. The glyph must not add another.
    expect(getAllByRole('status')).toHaveLength(1);
  });
});

describe('Spinner className passthrough', () => {
  it('[tester] spacing classes land on the glyph when decorative', () => {
    const { container } = render(<Spinner className="mr-2 shrink-0" />);
    const cls = classesOf(glyphOf(container));
    expect(cls).toContain('mr-2');
    expect(cls).toContain('shrink-0');
  });

  it('[tester] spacing classes land on the status wrapper when labelled', () => {
    const { getByRole } = render(<Spinner label="Loading" className="mr-2" />);
    expect(classesOf(getByRole('status'))).toContain('mr-2');
  });

  it('[tester] inline stays available for in-text spinners', () => {
    const { container } = render(<Spinner size="xs" className="inline" />);
    expect(classesOf(glyphOf(container))).toContain('inline');
  });

  it('[tester] a caller class wins over the size it collides with', () => {
    const { container } = render(<Spinner size="sm" className="h-8 w-8" />);
    const cls = classesOf(glyphOf(container));
    expect(cls).toContain('h-8 w-8');
    expect(cls).not.toContain('h-3 w-3');
  });
});
