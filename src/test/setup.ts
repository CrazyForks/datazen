// Vitest 4 note: registering through "@testing-library/jest-dom/vitest"
// silently no-ops in this environment (its side-effect entry ends up with
// an empty matcher set), so every toBeInTheDocument-style assertion fails
// with "Invalid Chai property". Extending from the standalone "./matchers"
// export with the runner's own `expect` registers correctly.

// `expect.extend` above only registers the matchers at *runtime*; it does not
// widen vitest's `Assertion` interface, so every `toBeInTheDocument` call in the
// suites type-checked as a missing property. This reference pulls in the
// package's `declare module 'vitest'` augmentation and nothing else — a
// triple-slash types reference is compile-time only, so the broken runtime
// entry noted above is still never loaded.
/// <reference types="@testing-library/jest-dom/vitest" />
import { expect } from 'vitest';
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';

expect.extend(jestDomMatchers as unknown as Record<string, never>);

// jsdom does not implement getClientRects on Range/Element — CodeMirror 6
// calls it during gutter measurement. Return a minimal empty rect list.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Range.prototype as any).getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  });
}
