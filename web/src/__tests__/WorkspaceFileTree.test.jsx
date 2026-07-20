import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkspaceFileTree from '@/components/WorkspaceFileTree';

describe('WorkspaceFileTree lazy mode', () => {
  let onFetchDir;
  let onOpenFile;

  beforeEach(() => {
    onFetchDir = vi.fn();
    onOpenFile = vi.fn();
  });

  it('fetches root directory on mount with depth=single', async () => {
    onFetchDir.mockResolvedValueOnce([
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'index.js', path: 'index.js', type: 'file' },
    ]);

    render(
      <WorkspaceFileTree
        lazy
        projectId="proj1"
        onFetchDir={onFetchDir}
        onOpenFile={onOpenFile}
      />
    );

    expect(onFetchDir).toHaveBeenCalledWith('proj1', '.');
    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
      expect(screen.getByText('index.js')).toBeInTheDocument();
    });
  });

  it('fetches directory children on expand', async () => {
    onFetchDir
      .mockResolvedValueOnce([
        { name: 'src', path: 'src', type: 'directory' },
      ])
      .mockResolvedValueOnce([
        { name: 'app.js', path: 'src/app.js', type: 'file' },
        { name: 'lib.js', path: 'src/lib.js', type: 'file' },
      ]);

    render(
      <WorkspaceFileTree
        lazy
        projectId="proj1"
        onFetchDir={onFetchDir}
        onOpenFile={onOpenFile}
      />
    );

    await waitFor(() => expect(screen.getByText('src')).toBeInTheDocument());

    const expandButton = screen.getByLabelText('展开/折叠 src');
    fireEvent.click(expandButton);

    expect(onFetchDir).toHaveBeenCalledWith('proj1', 'src');

    await waitFor(() => {
      expect(screen.getByText('app.js')).toBeInTheDocument();
      expect(screen.getByText('lib.js')).toBeInTheDocument();
    });
  });

  it('shows loading indicator while fetching directory', async () => {
    let resolveFetch;
    onFetchDir.mockReturnValueOnce(
      new Promise((resolve) => { resolveFetch = resolve; })
    );

    render(
      <WorkspaceFileTree
        lazy
        projectId="proj1"
        onFetchDir={onFetchDir}
        onOpenFile={onOpenFile}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('tree-loading')).toBeInTheDocument();
    });

    await resolveFetch([
      { name: 'a.js', path: 'a.js', type: 'file' },
    ]);

    await waitFor(() => {
      expect(screen.queryByTestId('tree-loading')).not.toBeInTheDocument();
    });
  });

  it('calls onOpenFile when clicking a file', async () => {
    onFetchDir.mockResolvedValueOnce([
      { name: 'index.js', path: 'index.js', type: 'file' },
    ]);

    render(
      <WorkspaceFileTree
        lazy
        projectId="proj1"
        onFetchDir={onFetchDir}
        onOpenFile={onOpenFile}
      />
    );

    await waitFor(() => expect(screen.getByText('index.js')).toBeInTheDocument());
    fireEvent.click(screen.getByText('index.js'));
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'index.js', path: 'index.js', type: 'file' }));
  });

  it('collapses directory on second click', async () => {
    onFetchDir
      .mockResolvedValueOnce([
        { name: 'src', path: 'src', type: 'directory' },
      ])
      .mockResolvedValueOnce([
        { name: 'app.js', path: 'src/app.js', type: 'file' },
      ]);

    render(
      <WorkspaceFileTree
        lazy
        projectId="proj1"
        onFetchDir={onFetchDir}
        onOpenFile={onOpenFile}
      />
    );

    await waitFor(() => expect(screen.getByText('src')).toBeInTheDocument());

    const expandButton = screen.getByLabelText('展开/折叠 src');
    fireEvent.click(expandButton);
    await waitFor(() => expect(screen.getByText('app.js')).toBeInTheDocument());

    fireEvent.click(expandButton);
    await waitFor(() => {
      expect(screen.queryByText('app.js')).not.toBeInTheDocument();
    });
  });

  it('does not re-fetch already loaded directory', async () => {
    onFetchDir
      .mockResolvedValueOnce([
        { name: 'src', path: 'src', type: 'directory' },
      ])
      .mockResolvedValueOnce([
        { name: 'app.js', path: 'src/app.js', type: 'file' },
      ]);

    render(
      <WorkspaceFileTree
        lazy
        projectId="proj1"
        onFetchDir={onFetchDir}
        onOpenFile={onOpenFile}
      />
    );

    await waitFor(() => expect(screen.getByText('src')).toBeInTheDocument());

    const expandButton = screen.getByLabelText('展开/折叠 src');
    fireEvent.click(expandButton);
    await waitFor(() => expect(screen.getByText('app.js')).toBeInTheDocument());

    fireEvent.click(expandButton);
    fireEvent.click(expandButton);

    expect(onFetchDir).toHaveBeenCalledTimes(2);
  });

  it('renders empty state when no items', async () => {
    onFetchDir.mockResolvedValueOnce([]);

    const { container } = render(
      <WorkspaceFileTree
        lazy
        projectId="proj1"
        onFetchDir={onFetchDir}
        onOpenFile={onOpenFile}
      />
    );

    await waitFor(() => {
      expect(container.querySelector('[data-testid="tree-empty"]')).toBeInTheDocument();
    });
  });
});