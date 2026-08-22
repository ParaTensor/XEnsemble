import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Github,
  GitBranch,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Play,
  Check,
  Loader2,
  Info,
  Search,
  ChevronRight,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { useToast } from './Toast';
import { useGitProvider } from '../hooks/useGitProvider';
import * as gitApi from '../lib/gitApi';
import SelectMenu from './SelectMenu';

const STEPS = [
  { key: 'source', label: '选择代码来源' },
  { key: 'config', label: '配置与 Agent' },
  { key: 'launch', label: '启动 Workspace' },
];

const SOURCE_OPTIONS = [
  {
    id: 'github',
    icon: Github,
    title: '从 GitHub 导入',
    desc: '连接 GitHub 账号，选择仓库一键导入',
    badge: '推荐',
    badgeClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30',
  },
  {
    id: 'gitlab',
    icon: GitBranch,
    title: '从 GitLab 导入',
    desc: '连接 GitLab 账号，支持自建实例',
    badge: '自建友好',
    badgeClass: 'bg-orange-500/10 text-orange-400 border border-orange-500/30',
  },
  {
    id: 'blank',
    icon: Sparkles,
    title: '空白起步模版',
    desc: '从零创建，自带 Node / Python / React 脚手架',
    badge: '新手推荐',
    badgeClass: 'bg-zinc-900 text-zinc-500 border border-zinc-800',
  },
];

const PROVISION_STEPS = [
  { text: '正在克隆仓库与检出分支...' },
  { text: '分配执行沙盒与挂载依赖环境...' },
  { text: '绑定 Git 追踪与交付流水线...' },
  { text: '启动 Agent 首个会话...' },
];

function RepoDropdown({ provider, onSelect }) {
  const { connection, loading: connectionLoading, connect } = useGitProvider(provider);
  const [repos, setRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedFullName, setSelectedFullName] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    if (!connection) return;
    setReposLoading(true);
    const endpoint = provider === 'github' ? '/api/v1/github/repos' : `/api/v1/git/${provider}/repos`;
    apiFetch(endpoint)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : (data.repos || []);
        setRepos(list);
      })
      .catch(() => {
        showToast('error', 'Failed to load repositories');
        setRepos([]);
      })
      .finally(() => setReposLoading(false));
  }, [connection, provider, showToast]);

  if (connectionLoading) {
    return (
      <div className="flex items-center gap-2 text-zinc-400 text-xs py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>检查连接状态...</span>
      </div>
    );
  }

  if (!connection) {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          {provider === 'github' ? <Github className="w-4 h-4" /> : <GitBranch className="w-4 h-4 text-orange-400" />}
          <span>尚未连接 {provider === 'github' ? 'GitHub' : 'GitLab'}</span>
        </div>
        <button
          onClick={() => connect()}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition"
        >
          连接
        </button>
      </div>
    );
  }

  const repoOptions = useMemo(() =>
    repos.map((r) => ({
      value: r.full_name,
      label: `${r.full_name}${r.private ? ' (Private)' : ''}`,
    })),
    [repos],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-zinc-400">仓库</label>
        <span className="text-[10px] text-zinc-500">{repos.length} 个</span>
      </div>
      <SelectMenu
        value={selectedFullName}
        onChange={(val) => {
          const repo = repos.find((r) => r.full_name === val);
          if (repo) {
            setSelectedFullName(repo.full_name);
            onSelect({
              url: repo.html_url || repo.clone_url || `https://${provider}.com/${repo.full_name}`,
              name: repo.name || repo.full_name?.split('/').pop(),
              fullName: repo.full_name,
              defaultBranch: repo.default_branch || 'main',
            });
          }
        }}
        options={repoOptions}
        placeholder={reposLoading ? '加载中...' : '选择仓库...'}
        searchable
        searchPlaceholder="搜索仓库..."
        disabled={reposLoading || repoOptions.length === 0}
      />
    </div>
  );
}

export default function OnboardingWizard({ agents, onComplete }) {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState('github');
  const [repoConfig, setRepoConfig] = useState(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [provisionStep, setProvisionStep] = useState(-1);
  const [provisioning, setProvisioning] = useState(false);
  const [createdProject, setCreatedProject] = useState(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  const handleCreateAndLaunch = useCallback(async () => {
    if (provisioning) return;
    setProvisioning(true);
    setStep(2);
    setProvisionStep(0);

    try {
      const name = workspaceName.trim() || repoConfig?.name || generateWorkspaceName();
      const res = await apiFetch('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create workspace');
      setCreatedProject(data);

      for (let i = 1; i < PROVISION_STEPS.length; i++) {
        await new Promise((r) => setTimeout(r, 800));
        setProvisionStep(i);
      }

      await new Promise((r) => setTimeout(r, 600));
      const sessionRes = await apiFetch('/api/v1/session/start', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: selectedAgentId,
          project_id: data.id,
        }),
      });
      const sessionData = await sessionRes.json();
      if (!sessionRes.ok) throw new Error(sessionData.error || 'Failed to start session');

      await new Promise((r) => setTimeout(r, 500));
      setStep(3);
    } catch (err) {
      showToast('error', err.message);
      setProvisioning(false);
      setStep(1);
    }
  }, [provisioning, workspaceName, repoConfig, selectedAgentId, showToast]);

  const handleFinish = () => {
    onComplete?.(createdProject);
  };

  const canProceedToLaunch = source === 'blank' || repoConfig;

  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 p-6 relative overflow-hidden">
      <div className="absolute w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -top-20 -left-20 pointer-events-none" />
      <div className="absolute w-96 h-96 bg-purple-500/5 rounded-full blur-3xl -bottom-20 -right-20 pointer-events-none" />

      <div className="w-full max-w-2xl space-y-6">
        {/* Step indicator */}
        <div className="flex items-center justify-center space-x-2 text-xs font-medium">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center space-x-1.5">
              {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
              <div className={cn(
                'flex items-center space-x-1.5',
                (step === 0 && i === 0) || (step === 1 && i <= 1) || (step >= 2 && i <= 2)
                  ? 'text-emerald-400'
                  : 'text-zinc-500',
              )}>
                <span className={cn(
                  'w-5 h-5 rounded-full flex items-center justify-center text-[10px] border',
                  i < step || (step === 2 && i < 2) || step === 3
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                    : i === step
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-500',
                )}>
                  {i < step || step === 3 ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Stage 1: Choose Source */}
        {step === 0 && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-8 shadow-2xl space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-zinc-100">欢迎来到 XEnsemble</h2>
              <p className="text-sm text-zinc-400">只需几秒钟，我们将为您创建一个包含完整执行环境与 AI 助手的 Workspace。</p>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-2">
              {SOURCE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = source === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setSource(opt.id)}
                    className={cn(
                      'group p-5 rounded-xl flex flex-col items-center text-center space-y-3 transition transform hover:-translate-y-0.5',
                      active
                        ? 'bg-zinc-950/60 border-2 border-emerald-500/80 hover:border-emerald-400'
                        : 'bg-zinc-950/60 border border-zinc-800 hover:border-zinc-700',
                    )}
                  >
                    <div className="w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-white group-hover:scale-110 transition">
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-zinc-100">{opt.title}</div>
                      <div className="text-[11px] text-zinc-400 mt-1 leading-relaxed">{opt.desc}</div>
                    </div>
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', opt.badgeClass)}>
                      {opt.badge}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="pt-4 flex justify-end">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-xs shadow-lg flex items-center space-x-2 transition"
              >
                <span>下一步：配置 Workspace</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Stage 2: Configure & Pick Agent */}
        {step === 1 && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-8 shadow-2xl space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-zinc-100">配置您的 Workspace</h2>
              <p className="text-xs text-zinc-400">
                {source === 'blank'
                  ? '为您的新项目命名，选择一个 Agent 即可开始。'
                  : `从 ${source === 'github' ? 'GitHub' : 'GitLab'} 选择仓库，配置 Workspace。`}
              </p>
            </div>

            {/* Repo selector (GitHub/GitLab only) */}
            {(source === 'github' || source === 'gitlab') && (
              <div className="space-y-2">
                <RepoDropdown
                  provider={source}
                  onSelect={(config) => {
                    setRepoConfig(config);
                    if (!workspaceName.trim()) setWorkspaceName(config.name || '');
                  }}
                />
              </div>
            )}

            {/* Workspace name + Agent selector in one row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-400">Workspace 名称</label>
                <input
                  type="text"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder={repoConfig?.name || 'my-workspace'}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 transition"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-400">Agent</label>
                <SelectMenu
                  value={selectedAgentId}
                  onChange={setSelectedAgentId}
                  options={agents.map((a) => ({ value: a.id, label: a.name }))}
                  placeholder="选择 Agent..."
                  searchable
                  searchPlaceholder="搜索 Agent..."
                />
              </div>
            </div>

            <div className="pt-4 flex items-center justify-between border-t border-zinc-800">
              <button
                onClick={() => setStep(0)}
                className="px-4 py-2 text-zinc-400 hover:text-zinc-200 text-xs transition flex items-center space-x-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>上一步</span>
              </button>
              <button
                onClick={handleCreateAndLaunch}
                disabled={!canProceedToLaunch || !selectedAgentId}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-xs shadow-lg flex items-center space-x-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-3.5 h-3.5" />
                <span>一键构建并进入 Workspace</span>
              </button>
            </div>
          </div>
        )}

        {/* Stage 3: Provisioning */}
        {step === 2 && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-8 shadow-2xl space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto animate-pulse">
                <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
              </div>
              <h2 className="text-xl font-bold text-zinc-100">正在为您准备 Workspace 环境...</h2>
              <p className="text-xs text-zinc-400">正在隔离容器中拉取代码、准备运行环境并挂载 Agent 运行时。</p>
            </div>

            <div className="bg-zinc-950 p-5 rounded-xl border border-zinc-800 space-y-3.5 text-xs font-mono">
              {PROVISION_STEPS.map((s, i) => (
                <div key={i} className={cn(
                  'flex items-center justify-between',
                  i <= provisionStep ? 'text-zinc-300' : 'text-zinc-600',
                )}>
                  <div className="flex items-center space-x-2.5">
                    {i < provisionStep ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : i === provisionStep ? (
                      <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-zinc-700" />
                    )}
                    <span>{s.text}</span>
                  </div>
                  <span className={cn(
                    'text-[10px]',
                    i < provisionStep ? 'text-emerald-400' : i === provisionStep ? 'text-zinc-400' : 'text-zinc-600',
                  )}>
                    {i < provisionStep ? '完成' : i === provisionStep ? '进行中' : '等待中'}
                  </span>
                </div>
              ))}
            </div>

            <div className="text-center text-xs text-zinc-500">
              构建完成后将自动进入主工作台界面...
            </div>
          </div>
        )}

        {/* Stage 4: Success */}
        {step === 3 && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-8 shadow-2xl text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400">
              <Check className="w-8 h-8" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-xl font-bold text-zinc-100">Workspace 准备就绪！</h2>
              <p className="text-xs text-zinc-400">代码、沙盒环境、Git 追踪以及 Agent 助手均已就位。</p>
            </div>

            <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 text-left text-xs space-y-2">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="text-zinc-500">工作空间名称:</span>
                <span className="font-mono font-medium">{createdProject?.name || workspaceName || 'my-workspace'}</span>
              </div>
              <div className="flex items-center justify-between text-zinc-300">
                <span className="text-zinc-500">激活 Agent:</span>
                <span className="text-zinc-200">{agents.find((a) => a.id === selectedAgentId)?.name || selectedAgentId}</span>
              </div>
            </div>

            <button
              onClick={handleFinish}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-xs shadow-lg flex items-center justify-center space-x-2 transition"
            >
              <span>立即进入开发工作台</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function generateWorkspaceName() {
  const words = [
    'swift', 'bright', 'calm', 'bold', 'brave', 'clear', 'dark', 'fast',
    'fresh', 'grand', 'keen', 'light', 'neat', 'proud', 'sharp', 'warm',
  ];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}`;
}
