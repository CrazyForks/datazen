import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoScroll } from '../useAutoScroll';

describe('useAutoScroll', () => {
  it('starts with atBottom=true and unreadCount=0', () => {
    const { result } = renderHook(() => useAutoScroll());
    expect(result.current.atBottom).toBe(true);
    expect(result.current.unreadCount).toBe(0);
  });

  it('has a containerRef callback function', () => {
    const { result } = renderHook(() => useAutoScroll());
    expect(typeof result.current.containerRef).toBe('function');
  });

  it('provides onScroll callback', () => {
    const { result } = renderHook(() => useAutoScroll());
    expect(typeof result.current.onScroll).toBe('function');
  });

  it('provides jumpToBottom callback', () => {
    const { result } = renderHook(() => useAutoScroll());
    expect(typeof result.current.jumpToBottom).toBe('function');
  });
});

describe('useAutoScroll integration', () => {
  it('detects scroll position via mock element through callback ref', () => {
    const { result } = renderHook(() => useAutoScroll({ threshold: 50 }));

    // Mock a scroll container that is at the bottom
    const mockEl = {
      scrollHeight: 1000,
      scrollTop: 900,
      clientHeight: 100,
      // distance from bottom = 1000 - 900 - 100 = 0 → at bottom
    };

    // Simulate attaching via callback ref
    act(() => {
      (result.current.containerRef as (el: HTMLDivElement | null) => void)(
        mockEl as unknown as HTMLDivElement,
      );
    });

    act(() => {
      result.current.onScroll();
    });

    expect(result.current.atBottom).toBe(true);
  });

  it('detects when scrolled away from bottom', () => {
    const { result } = renderHook(() => useAutoScroll({ threshold: 50 }));

    // Mock a scroll container that is NOT at the bottom
    const mockEl = {
      scrollHeight: 1000,
      scrollTop: 500,
      clientHeight: 100,
      // distance from bottom = 1000 - 500 - 100 = 400 → NOT at bottom
    };

    act(() => {
      (result.current.containerRef as (el: HTMLDivElement | null) => void)(
        mockEl as unknown as HTMLDivElement,
      );
    });

    act(() => {
      result.current.onScroll();
    });

    expect(result.current.atBottom).toBe(false);
  });
});
