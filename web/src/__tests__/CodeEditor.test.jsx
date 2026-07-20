import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@monaco-editor/react', () => ({
  default: function MockEditor({ value, language, options }) {
    return (
      <div data-testid="monaco-editor" data-language={language}>
        <textarea
          data-testid="monaco-textarea"
          value={value}
          readOnly={options?.readOnly}
          onChange={() => {}}
        />
      </div>
    );
  },
  loader: { init: vi.fn() },
}));

const CodeEditor = (await import('@/components/CodeEditor')).default;

describe('CodeEditor', () => {
  it('renders Monaco editor with content', () => {
    render(<CodeEditor content="hello world" path="app.js" />);
    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toBeInTheDocument();
    const textarea = screen.getByTestId('monaco-textarea');
    expect(textarea.value).toBe('hello world');
  });

  it('renders in readOnly mode when readOnly=true', () => {
    render(<CodeEditor content="readonly" readOnly path="app.js" />);
    const textarea = screen.getByTestId('monaco-textarea');
    expect(textarea).toHaveAttribute('readonly');
  });

  it('shows binary placeholder when isBinary=true', () => {
    render(<CodeEditor content="" isBinary path="image.png" />);
    expect(screen.getByText(/二进制文件/)).toBeInTheDocument();
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument();
  });

  it('infers language from file extension', () => {
    render(<CodeEditor content="const x = 1;" path="app.js" />);
    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toHaveAttribute('data-language', 'javascript');
  });

  it('infers typescript from .ts extension', () => {
    render(<CodeEditor content="const x: number = 1;" path="app.ts" />);
    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toHaveAttribute('data-language', 'typescript');
  });

  it('infers markdown from .md extension', () => {
    render(<CodeEditor content="# Hello" path="readme.md" />);
    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toHaveAttribute('data-language', 'markdown');
  });

  it('infers python from .py extension', () => {
    render(<CodeEditor content="print('hi')" path="script.py" />);
    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toHaveAttribute('data-language', 'python');
  });

  it('triggers onSave on Ctrl+S', () => {
    const onSave = vi.fn();
    const { container } = render(<CodeEditor content="test" onSave={onSave} path="app.js" />);
    fireEvent.keyDown(container.firstChild || container, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalled();
  });

  it('triggers onSave on Cmd+S (Mac)', () => {
    const onSave = vi.fn();
    const { container } = render(<CodeEditor content="test" onSave={onSave} path="app.js" />);
    fireEvent.keyDown(container.firstChild || container, { key: 's', metaKey: true });
    expect(onSave).toHaveBeenCalled();
  });

  it('shows large file warning when content exceeds 1MB', () => {
    const largeContent = 'x'.repeat(1024 * 1024 + 1);
    render(<CodeEditor content={largeContent} path="app.js" />);
    expect(screen.getByText(/文件较大/)).toBeInTheDocument();
  });

  it('resets editing state when path changes', () => {
    const { rerender } = render(<CodeEditor content="hello" path="app.js" />);
    // 点击编辑按钮进入编辑模式
    fireEvent.click(screen.getByText('编辑'));
    expect(screen.getByText('保存')).toBeInTheDocument();
    // 切换到另一个文件
    rerender(<CodeEditor content="world" path="other.js" />);
    // 应回到只读模式
    expect(screen.getByText('只读')).toBeInTheDocument();
    expect(screen.getByText('编辑')).toBeInTheDocument();
  });
});
