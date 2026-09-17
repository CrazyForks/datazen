import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Badge, Button, Dialog, Input, Label, Select, Slider, Tabs } from '../index';

afterEach(cleanup);

describe('@datazen/ui Button', () => {
  it('renders with primary variant by default', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.className).toContain('bg-accent');
  });

  it('applies danger variant classes', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button').className).toContain('bg-danger');
  });
});

describe('@datazen/ui Input', () => {
  it('renders a text input with base styles', () => {
    render(<Input placeholder="Name" />);
    const input = screen.getByPlaceholderText('Name');
    expect(input.tagName).toBe('INPUT');
    expect(input.className).toContain('border-edge');
  });
});

describe('@datazen/ui Badge', () => {
  it('renders success tone classes', () => {
    render(<Badge tone="success">OK</Badge>);
    const badge = screen.getByText('OK');
    expect(badge.className).toContain('text-success');
  });
});

describe('@datazen/ui Label', () => {
  it('shows required asterisk when required', () => {
    render(<Label required>Host</Label>);
    expect(screen.getByText('*')).toBeInTheDocument();
  });
});

describe('@datazen/ui Tabs', () => {
  it('renders active tab content', () => {
    render(
      <Tabs
        items={[
          { id: 'a', label: 'Tab A', content: <div>Content A</div> },
          { id: 'b', label: 'Tab B', content: <div>Content B</div> },
        ]}
        activeId="a"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Content A')).toBeInTheDocument();
    expect(screen.queryByText('Content B')).not.toBeInTheDocument();
  });
});

describe('@datazen/ui Slider', () => {
  it('renders slider semantics and clamps pointer drags to the range', () => {
    const onChange = vi.fn();
    render(<Slider aria-label="Font size" value={13} min={10} max={24} onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'Font size' });
    expect(slider).toHaveAttribute('aria-valuenow', '13');
    expect(slider).toHaveAttribute('aria-valuemin', '10');
    expect(slider).toHaveAttribute('aria-valuemax', '24');
    // jsdom reports zero-width rects; mock the slider container as the track.
    slider.getBoundingClientRect = () => new DOMRect(0, 0, 140, 36);
    fireEvent.pointerDown(slider, { clientX: 500, button: 0, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(24);
    fireEvent.pointerDown(slider, { clientX: -50, button: 0, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(10);
    fireEvent.pointerDown(slider, { clientX: 70, button: 0, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(17);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(14);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(24);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('ignores interaction when disabled and respects step rounding', () => {
    const onChange = vi.fn();
    render(
      <Slider aria-label="Rows" value={5} min={1} max={10} step={3} disabled onChange={onChange} />,
    );
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    fireEvent.pointerDown(slider, { clientX: 70, button: 0, pointerId: 1 });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('@datazen/ui Select', () => {
  it('opens listbox on trigger click', () => {
    render(
      <Select
        value="one"
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
        ]}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});

describe('@datazen/ui Dialog', () => {
  it('renders title when open', () => {
    render(
      <Dialog open title="Confirm" onClose={() => {}}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const { container } = render(
      <Dialog open={false} title="Hidden" onClose={() => {}}>
        <p>Hidden</p>
      </Dialog>,
    );
    expect(container.innerHTML).toBe('');
  });
});
