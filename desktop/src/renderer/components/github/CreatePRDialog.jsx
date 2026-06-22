import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import {
  ConsoleDialogShell,
  ConsoleStructuredDialogHeader,
  ConsoleStructuredDialogBody,
  ConsoleStructuredDialogFooter,
} from '../ConsoleDialog';
import Input, { FormLabel, Textarea } from '../Input';
import Button from '../Button';
import SelectMenu from '../SelectMenu';
import { useToast } from '../Toast';
import * as githubApi from '../../lib/githubApi.js';
import {
  consoleDialogMdClass,
  textPrimary,
} from '../../lib/consoleTheme';

export default function CreatePRDialog({
  open,
  projectId,
  sourceBranch,
  defaultTargetBranch,
  onClose,
}) {
  const { showToast } = useToast();
  const [branches, setBranches] = useState([]);
  const [targetBranch, setTargetBranch] = useState(defaultTargetBranch || 'main');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [diff, setDiff] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || !projectId) return;
    githubApi
      .listBranches(projectId)
      .then(({ branches: rows }) => {
        setBranches(Array.isArray(rows) ? rows : []);
      })
      .catch(() => setBranches([]));
  }, [open, projectId]);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setBody('');
      setDiff('');
      setShowDiff(false);
      setTargetBranch(defaultTargetBranch || 'main');
    }
  }, [open, defaultTargetBranch]);

  useEffect(() => {
    if (!open || !projectId || !sourceBranch) return;
    setDiffLoading(true);
    githubApi
      .getGitDiff(projectId, { base: targetBranch, head: sourceBranch })
      .then(({ diff: d }) => setDiff(d || ''))
      .catch(() => setDiff(''))
      .finally(() => setDiffLoading(false));
  }, [open, projectId, sourceBranch, targetBranch]);

  const branchOptions = useMemo(
    () => branches.map((b) => ({ value: b.name, label: b.name })),
    [branches],
  );

  const handleCreate = async () => {
    if (!projectId || !sourceBranch || !title.trim()) return;
    setCreating(true);
    try {
      const pr = await githubApi.createPullRequest(projectId, {
        title: title.trim(),
        body: body.trim(),
        target_branch: targetBranch,
      });
      showToast('success', 'Pull request created.');
      if (pr?.github_pr_url || pr?.githubPrUrl) {
        githubApi.openExternal(pr.github_pr_url || pr.githubPrUrl);
      }
      onClose();
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <ConsoleDialogShell onClose={onClose} panelClassName={`${consoleDialogMdClass} max-h-[calc(100vh-2rem)]`}>
      <ConsoleStructuredDialogHeader
        title="Create Pull Request"
        subtitle={`From ${sourceBranch || 'current branch'}`}
      />
      <ConsoleStructuredDialogBody>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FormLabel htmlFor="pr-source">Source branch</FormLabel>
            <Input
              id="pr-source"
              value={sourceBranch || ''}
              readOnly
              className="mt-1.5 bg-zinc-100"
            />
          </div>
          <div>
            <FormLabel htmlFor="pr-target">Target branch</FormLabel>
            <SelectMenu
              id="pr-target"
              value={targetBranch}
              onChange={setTargetBranch}
              options={branchOptions}
              placeholder="Select target branch"
              className="mt-1.5"
            />
          </div>
        </div>

        <div>
          <FormLabel htmlFor="pr-title">Title</FormLabel>
          <Input
            id="pr-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="feat: describe the change"
            className="mt-1.5"
            autoFocus
          />
        </div>

        <div>
          <FormLabel htmlFor="pr-body">Description</FormLabel>
          <Textarea
            id="pr-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What changed and why"
            className="mt-1.5 min-h-[6rem]"
          />
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowDiff((v) => !v)}
            className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
          >
            {showDiff ? 'Hide diff preview' : 'Show diff preview'}
          </button>
          {showDiff && (
            <div className="mt-2 max-h-48 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3">
              {diffLoading ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading diff…
                </div>
              ) : diff ? (
                <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-700">{diff}</pre>
              ) : (
                <p className="text-xs text-zinc-500">No diff available.</p>
              )}
            </div>
          )}
        </div>
      </ConsoleStructuredDialogBody>
      <ConsoleStructuredDialogFooter>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!title.trim() || creating}
          onClick={handleCreate}
        >
          {creating ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Creating…
            </>
          ) : (
            <>
              Create pull request
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </>
          )}
        </Button>
      </ConsoleStructuredDialogFooter>
    </ConsoleDialogShell>
  );
}
