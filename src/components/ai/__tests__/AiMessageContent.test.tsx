import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AiMessageContent } from '../AiMessageContent';

vi.mock('../../SqlCodeBlock', () => ({
  SqlCodeBlock: ({ code }: { code: string }) => <div data-testid="sql-code-block">{code}</div>,
}));

describe('AiMessageContent', () => {
  it('renders plain text via markdown', () => {
    const { container } = render(<AiMessageContent content="Hello world" />);
    expect(container.textContent).toContain('Hello world');
  });

  it('renders markdown headings', () => {
    const { container } = render(<AiMessageContent content="# Title" />);
    expect(container.querySelector('h1')).toBeTruthy();
    expect(container.textContent).toContain('Title');
  });

  it('renders markdown lists', () => {
    const { container } = render(<AiMessageContent content="- Item 1\n- Item 2" />);
    expect(container.querySelector('ul')).toBeTruthy();
  });

  it('renders markdown bold and italic', () => {
    const { container } = render(<AiMessageContent content="**bold** and *italic*" />);
    expect(container.querySelector('strong')).toBeTruthy();
    expect(container.querySelector('em')).toBeTruthy();
  });

  it('renders fenced code block as AiCodeBlock', () => {
    const { getByTestId, queryByText } = render(
      <AiMessageContent content={'Before\n```sql\nSELECT 1\n```\nAfter'} onInsertSql={vi.fn()} />,
    );
    expect(getByTestId('ai-code-block')).toBeInTheDocument();
    expect(queryByText('```sql')).toBeNull();
  });

  it('renders text around code blocks', () => {
    const { getByText } = render(
      <AiMessageContent content={'Before\n```sql\nSELECT 1\n```\nAfter'} />,
    );
    expect(getByText('Before')).toBeInTheDocument();
    expect(getByText('After')).toBeInTheDocument();
  });

  it('applies animate-pulse when streaming', () => {
    const { container } = render(<AiMessageContent content="Hello" isStreaming />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders multiple code blocks', () => {
    const { getAllByTestId } = render(
      <AiMessageContent content={'```sql\nSELECT 1\n```\n\n```sql\nSELECT 2\n```'} />,
    );
    expect(getAllByTestId('ai-code-block')).toHaveLength(2);
  });

  it('renders empty content as null', () => {
    const { container } = render(<AiMessageContent content="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders whitespace-only text segments as null', () => {
    const { container } = render(
      <AiMessageContent content={'   \n\n```sql\nSELECT 1\n```\n\n   '} />,
    );
    // The code block should render, whitespace-only text segments should be filtered
    expect(container.querySelector('[data-testid="ai-code-block"]')).toBeTruthy();
  });
});
