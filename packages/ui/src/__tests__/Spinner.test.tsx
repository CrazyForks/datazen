/**
 * Spinner: the size/tone/variant matrix that has to reproduce the exact boxes
 * the hand-written `animate-spin` markup used, and — the part that actually
 * matters — the accessibility contract. The default spinner must stay
 * decorative (`aria-hidden`), and a spinner that is the *only* feedback on
 * screen must be able to promote itself into a live status region.
 *
 * Class assertions are exact SET comparisons, never substring matching. The
 * whole point of the refactor is that `<Spinner size="lg" />` renders exactly
 * what the hand-written `<Loader2 className="h-4 w-4 animate-spin" />` did, and
 * `toContain('h-4 w-4')` happily passes a size map that renders
 * `h-4 w-4 opacity-50` — the added class is precisely the render drift this is
 * meant to catch. `cn()` reorders classes, so compare sets, not strings.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Spinner } from '../Spinner';
import type { SpinnerSize, SpinnerTone } from '../Spinner';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

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

function classSetOf(el: Element): Set<string> {
  return new Set((el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
}

/** Asserts the element carries exactly `expected` and not one class more. */
function expectExactClasses(el: Element, expected: string): void {
  const wanted = new Set(expected.split(/\s+/).filter(Boolean));
  const actual = classSetOf(el);
  const extra = [...actual].filter((c) => !wanted.has(c));
  const missing = [...wanted].filter((c) => !actual.has(c));
  expect({ extra, missing }).toEqual({ extra: [], missing: [] });
}

/** lucide-react stamps its own base classes onto the glyph. */
const ICON_BASE = 'lucide lucide-loader-circle';

const SIZE_CLASS: ReadonlyArray<[SpinnerSize, string]> = [
  ['xs', 'h-2.5 w-2.5'],
  ['sm', 'h-3 w-3'],
  ['md', 'h-3.5 w-3.5'],
  ['lg', 'h-4 w-4'],
  ['xl', 'h-5 w-5'],
  ['2xl', 'h-6 w-6'],
];
const ICON_TONE_CLASS: ReadonlyArray<[SpinnerTone, string]> = [
  ['current', ''],
  ['accent', 'text-accent'],
  ['muted', 'text-fg-muted'],
];
const RING_TONE_CLASS: ReadonlyArray<[SpinnerTone, string]> = [
  ['current', 'border-current'],
  ['accent', 'border-accent'],
  ['muted', 'border-fg-muted'],
];

/** The full cross product: 6 sizes × 3 tones × 2 variants. */
const MATRIX = SIZE_CLASS.flatMap(([size, box]) =>
  (['icon', 'ring'] as const).flatMap((variant) =>
    (variant === 'icon' ? ICON_TONE_CLASS : RING_TONE_CLASS).map(([tone, toneCls]) => ({
      size,
      variant,
      box,
      tone,
      toneCls,
    })),
  ),
);

describe('Spinner renders exactly the hand-written box', () => {
  it.each(MATRIX)(
    '[tester] $variant size=$size tone=$tone renders exactly its class set',
    ({ size, variant, box, tone, toneCls }) => {
      const { container } = render(<Spinner size={size} variant={variant} tone={tone} />);
      const expected =
        variant === 'icon'
          ? `${ICON_BASE} ${box} animate-spin ${toneCls}`
          : `${box} animate-spin rounded-full border-2 ${toneCls} border-t-transparent`;
      expectExactClasses(glyphOf(container), expected);
    },
  );

  it('[tester] the matrix is the full 6x3x2 cross product', () => {
    expect(MATRIX).toHaveLength(36);
  });

  it('[tester] default size is md, current tone, icon variant', () => {
    const { container } = render(<Spinner />);
    expectExactClasses(glyphOf(container), `${ICON_BASE} h-3.5 w-3.5 animate-spin`);
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
    expectExactClasses(
      ring,
      'h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent',
    );
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
    expectExactClasses(getByText('Loading rows'), 'sr-only');
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

  it('[tester] the status wrapper is inline-flex with nothing else on it', () => {
    const { getByRole } = render(<Spinner label="Loading" />);
    expectExactClasses(getByRole('status'), 'inline-flex items-center');
  });
});

describe('Spinner label inside an interactive element', () => {
  /**
   * The warn text is the only thing a developer gets from this guard, so it
   * has to actually help. These assert the three structural parts of an
   * actionable message — what happened, and what to do about it — rather than
   * the exact wording, so a punctuation fix is not a red test but degrading
   * the text into "do not do this." is.
   */
  function expectActionable(message: string): void {
    // Names the component and the prop that triggered it.
    expect(message).toContain('Spinner');
    expect(message).toContain('label');
    // At least one concrete remedy: an imperative, not a restatement of the ban.
    expect(message).toMatch(/\b(Move|drop|Remove|Use|Place|Render)\w*/);
    // A remedy phrased as a sentence, not a fragment glued onto the diagnosis.
    expect(message.split(/(?<=[.!?])\s+/).length).toBeGreaterThanOrEqual(2);
  }

  it('[tester] this suite runs with the dev latch OPEN', () => {
    // Precondition, not a tautology: the guard is gated on import.meta.env.DEV,
    // so if a runner ever ran this file with DEV=false the warn assertions
    // below would go permanently green while the guard was dead. Asserting it
    // turns that silent false-pass into a red one.
    expect(import.meta.env.DEV).toBe(true);
  });

  // Pinned, not aspirational: this is the exact failure the guard below exists
  // to prevent. If a future change to the wrapper (say, moving the text into
  // `aria-label` instead of visually hidden text) fixes it, this goes red and
  // the JSDoc has to be updated to match.
  it('[tester] the hidden label really does leak into the button name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getByRole, queryByRole } = render(
      <button type="button">
        <Spinner label="Thinking" />
        <span>Go</span>
      </button>,
    );
    expect(getByRole('button', { name: 'ThinkingGo' })).toBeTruthy();
    expect(queryByRole('button', { name: 'Go' })).toBeNull();
    warn.mockRestore();
  });

  it('[tester] warns once when a label is nested inside a button', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <button type="button">
        <Spinner label="Thinking" />
      </button>,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('<Spinner label="Thinking">');
    expect(message).toContain('button');
    expectActionable(message);
    warn.mockRestore();
  });

  it.each([
    ['an anchor', <Spinner label="Busy" key="s" />],
    ['a role=button element', <Spinner label="Busy" key="s" />],
  ])('[tester] warns when a label is nested inside %s', (_name, inner) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      _name === 'an anchor' ? <a href="#">{inner}</a> : <div role="button">{inner}</div>,
    );
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    expect(warn).toHaveBeenCalledTimes(1);
    expectActionable(String(warn.mock.calls[0]?.[0] ?? ''));
    warn.mockRestore();
  });

  it('[tester] the remedy names both ways out, not just the ban', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <button type="button">
        <Spinner label="Thinking" />
      </button>,
    );
    const message = String(warn.mock.calls[0]?.[0] ?? '');
    // Two distinct remedies: relocate the live region, or drop the label.
    expect(message).toMatch(/Move/);
    expect(message).toMatch(/drop/);
    warn.mockRestore();
  });

  it('[tester] a live region nested in a button is still its own status region', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getByRole } = render(
      <button type="button">
        <Spinner label="Busy" />
      </button>,
    );
    // The region itself is well-formed; only the placement is wrong. That is
    // why this needs a guard rather than a fix in the component.
    expect(getByRole('status').getAttribute('aria-busy')).toBe('true');
    warn.mockRestore();
  });

  it('[tester] stays silent for a label in ordinary flow content', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <div>
        <Spinner label="Loading" />
      </div>,
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('[tester] stays silent for a decorative spinner inside a button', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <button type="button">
        <Spinner />
        <span>Go</span>
      </button>,
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('[tester] production build: fully silent, but still renders the live region', () => {
    vi.stubEnv('DEV', false);
    expect(import.meta.env.DEV).toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getByRole } = render(
      <button type="button">
        <Spinner label="Thinking" />
      </button>,
    );
    // The latch gates the *diagnostic*, never the accessibility output: the
    // role=status region is correct in production and must still be there.
    expect(warn).not.toHaveBeenCalled();
    expect(getByRole('status').getAttribute('aria-busy')).toBe('true');
    warn.mockRestore();
  });
});

describe('Spinner className passthrough', () => {
  it('[tester] spacing classes land on the glyph when decorative', () => {
    const { container } = render(<Spinner className="mr-2 shrink-0" />);
    expectExactClasses(glyphOf(container), `${ICON_BASE} h-3.5 w-3.5 animate-spin mr-2 shrink-0`);
  });

  it('[tester] spacing classes land on the status wrapper when labelled', () => {
    const { getByRole } = render(<Spinner label="Loading" className="mr-2" />);
    expectExactClasses(getByRole('status'), 'inline-flex items-center mr-2');
  });

  it('[tester] inline stays available for in-text spinners', () => {
    const { container } = render(<Spinner size="xs" className="inline" />);
    expectExactClasses(glyphOf(container), `${ICON_BASE} h-2.5 w-2.5 animate-spin inline`);
  });

  it('[tester] a caller class wins over the size it collides with', () => {
    const { container } = render(<Spinner size="sm" className="h-8 w-8" />);
    expectExactClasses(glyphOf(container), `${ICON_BASE} h-8 w-8 animate-spin`);
  });

  it('[tester] a caller colour class wins over the tone it collides with', () => {
    const { container } = render(<Spinner tone="accent" className="text-red-500" />);
    expectExactClasses(glyphOf(container), `${ICON_BASE} h-3.5 w-3.5 animate-spin text-red-500`);
  });
});
