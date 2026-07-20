import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    gitChanges: null,
    onGitFileClick: vi.fn(),
    gitDiffView: null,
    onCloseGitDiff: vi.fn(),
  };

  beforeEach(() => {
    sessionStorage.clear();
  });

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

  it('shows git changes badge on activity bar', () => {
    const gitChanges = {
      files: [{ path: 'src/a.js', status: ' M' }, { path: 'src/b.js', status: '??' }],
      dirty: true,
      branch: 'main',
      ahead: 0,
      behind: 0,
    };
    render(<WorkspacePanel {...defaultProps} gitChanges={gitChanges} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows git files and branch in source control panel', async () => {
    const gitChanges = {
      files: [{ path: 'src/a.js', status: ' M' }],
      dirty: true,
      branch: 'main',
      ahead: 0,
      behind: 0,
    };
    render(<WorkspacePanel {...defaultProps} gitChanges={gitChanges} />);
    // 点击活动栏的变更图标
    fireEvent.click(screen.getByTitle(/源代码管理/));
    await waitFor(() => {
      expect(screen.getByText('main')).toBeInTheDocument();
      expect(screen.getByText('a.js')).toBeInTheDocument();
      expect(screen.getByText('M')).toBeInTheDocument();
    });
  });

  it('shows empty state in source control when no git files', async () => {
    const gitChanges = { files: [], dirty: false, branch: 'main', ahead: 0, behind: 0 };
    render(<WorkspacePanel {...defaultProps} gitChanges={gitChanges} />);
    fireEvent.click(screen.getByTitle(/源代码管理/));
    await waitFor(() => {
      expect(screen.getByText(/暂无已保存的更改/)).toBeInTheDocument();
    });
  });

  it('calls onGitFileClick when clicking git file', async () => {
    const onGitFileClick = vi.fn();
    const gitChanges = {
      files: [{ path: 'src/a.js', status: ' M' }],
      dirty: true,
      branch: 'main',
      ahead: 0,
      behind: 0,
    };
    render(<WorkspacePanel {...defaultProps} gitChanges={gitChanges} onGitFileClick={onGitFileClick} />);
    fireEvent.click(screen.getByTitle(/源代码管理/));
    await waitFor(() => { expect(screen.getByText('a.js')).toBeInTheDocument(); });
    fireEvent.click(screen.getByText('a.js'));
    expect(onGitFileClick).toHaveBeenCalledWith('src/a.js');
  });
});