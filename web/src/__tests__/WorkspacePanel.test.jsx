import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@monaco-editor/react', () => ({
  default: function MockEditor({ value, onChange, options }) {
    return (
      <div data-testid="monaco-editor">
        <textarea
          data-testid="monaco-textarea"
          value={value}
          readOnly={options?.readOnly}
          onChange={onChange}
        />
      </div>
    );
  },
  loader: { init: vi.fn() },
}));

const WorkspacePanel = (await import('@/components/WorkspacePanel')).default;

describe('WorkspacePanel', () => {
  const defaultProps = {
    projectId: 'proj1',
    tabs: [],
    activePath: '',
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onSaveTab: vi.fn(),
    onOpenFile: vi.fn(),
    onFetchDir: vi.fn().mockResolvedValue([]),
    onCreateFile: vi.fn(),
    onCreateDir: vi.fn(),
  };

  it('renders empty state when no file is open', async () => {
    render(<WorkspacePanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/从左侧文件树选择一个文件打开/)).toBeInTheDocument();
    });
  });

  it('renders editor with tabs when files are open', () => {
    const tabs = [
      { path: 'src/index.js', content: 'hello', originalContent: 'hello', isBinary: false },
    ];
    render(<WorkspacePanel {...defaultProps} tabs={tabs} activePath="src/index.js" />);
    expect(screen.getByText('index.js')).toBeInTheDocument();
  });

  it('opens new file dialog with autoFocus', () => {
    render(<WorkspacePanel {...defaultProps} />);
    fireEvent.click(screen.getByTitle('新建文件'));
    const input = screen.getByPlaceholderText(/文件名/);
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('creates new file on confirm', async () => {
    const onCreateFile = vi.fn().mockResolvedValue({ ok: true });
    const onFetchDir = vi.fn().mockResolvedValue([]);
    render(<WorkspacePanel {...defaultProps} onCreateFile={onCreateFile} onFetchDir={onFetchDir} />);

    fireEvent.click(screen.getByTitle('新建文件'));
    const input = screen.getByPlaceholderText(/文件名/);
    fireEvent.change(input, { target: { value: 'newfile.js' } });
    fireEvent.click(screen.getByText('创建'));

    await waitFor(() => {
      expect(onCreateFile).toHaveBeenCalledWith('proj1', 'newfile.js');
    });
  });

  it('opens new folder dialog with autoFocus', () => {
    render(<WorkspacePanel {...defaultProps} />);
    fireEvent.click(screen.getByTitle('新建文件夹'));
    const input = screen.getByPlaceholderText(/文件夹名/);
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('creates new folder on confirm', async () => {
    const onCreateDir = vi.fn().mockResolvedValue({ ok: true });
    const onFetchDir = vi.fn().mockResolvedValue([]);
    render(<WorkspacePanel {...defaultProps} onCreateDir={onCreateDir} onFetchDir={onFetchDir} />);

    fireEvent.click(screen.getByTitle('新建文件夹'));
    const input = screen.getByPlaceholderText(/文件夹名/);
    fireEvent.change(input, { target: { value: 'newdir' } });
    fireEvent.click(screen.getByText('创建'));

    await waitFor(() => {
      expect(onCreateDir).toHaveBeenCalledWith('proj1', 'newdir');
    });
  });

  it('shows file tree on the left side', async () => {
    render(<WorkspacePanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-panel')).toBeInTheDocument();
    });
  });

  it('shows changes panel tab and dirty file count', () => {
    const tabs = [
      { path: 'src/a.js', content: 'modified', originalContent: 'original', isBinary: false },
      { path: 'src/b.js', content: 'same', originalContent: 'same', isBinary: false },
    ];
    render(<WorkspacePanel {...defaultProps} tabs={tabs} activePath="src/a.js" />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows dirty files in changes panel', () => {
    const tabs = [
      { path: 'src/a.js', content: 'modified', originalContent: 'original', isBinary: false },
    ];
    render(<WorkspacePanel {...defaultProps} tabs={tabs} activePath="src/a.js" />);
    fireEvent.click(screen.getAllByText('变更')[0]);
    expect(screen.getByText('src/a.js')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('shows empty state in changes panel when no dirty files', () => {
    render(<WorkspacePanel {...defaultProps} />);
    fireEvent.click(screen.getAllByText('变更')[0]);
    expect(screen.getByText(/暂无未保存的变更/)).toBeInTheDocument();
  });

  it('calls onShowDiff and onSelectTab when clicking dirty file', () => {
    const onSelectTab = vi.fn();
    const onShowDiff = vi.fn();
    const tabs = [
      { path: 'src/a.js', content: 'modified', originalContent: 'original', isBinary: false },
    ];
    render(
      <WorkspacePanel
        {...defaultProps}
        tabs={tabs}
        activePath="src/a.js"
        onSelectTab={onSelectTab}
        onShowDiff={onShowDiff}
      />
    );
    fireEvent.click(screen.getAllByText('变更')[0]);
    fireEvent.click(screen.getByText('src/a.js'));
    expect(onSelectTab).toHaveBeenCalledWith('src/a.js');
    expect(onShowDiff).toHaveBeenCalledWith('src/a.js');
  });
});
