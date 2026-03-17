'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { VariantPreview } from '@/components/dashboard/variant-preview';
import type { VariantConfig } from '@/lib/types/variant-config';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  followUps?: string[];
  toolCalls?: Array<{ tool: string; input: object; result?: string; done?: boolean }>;
  changeProposal?: {
    changeId: string;
    hypothesis: string;
    changes: Record<string, unknown>;
    expectedImpact: string;
    currentConfig?: Record<string, unknown>;
    fullCurrentConfig?: Record<string, unknown>;
  };
  variantCreated?: {
    variantId: string;
    slug: string;
    liveUrl: string;
    headline: string;
    config: Record<string, unknown>;
    changeId: string;
  };
  codeChanges?: Array<{
    changeId: string;
    prNumber: number;
    prUrl: string;
    branch: string;
    repo: string;
    filePath: string;
    hypothesis: string;
  }>;
  pagePreview?: {
    url: string;
    title: string;
    headings: string[];
  };
  draft?: {
    verticalId: string;
    sourcePath: string;
    newRoute: string;
    hypothesis: string;
    replacements: Array<{ find: string; replace: string; context?: string }>;
    status: 'drafting' | 'pushing' | 'pushed';
    prUrl?: string;
    prNumber?: number;
  };
  wireframe?: {
    title: string;
    ascii: string;
    sourcePath: string;
    variantLabel?: string;
  };
  status?: 'streaming' | 'complete';
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SavedChat {
  id: string;
  title: string;
  savedAt: string;
  messages: ChatMessage[];
  conversationHistory: ConversationMessage[];
}

interface Props {
  projectId?: string;
  initialPrompt?: string;
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const HISTORY_KEY = 'greenhouse_chat_history';
const MAX_HISTORY = 20;

function loadHistory(): SavedChat[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedChat[];
  } catch {
    return [];
  }
}

function persistChat(chat: SavedChat, existing: SavedChat[]): SavedChat[] {
  const filtered = existing.filter((c) => c.id !== chat.id);
  const updated = [chat, ...filtered].slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch { /* quota exceeded — ignore */ }
  return updated;
}

// ---------------------------------------------------------------------------
// Human-readable tool labels
// ---------------------------------------------------------------------------

const TOOL_LABELS: Record<string, string> = {
  get_experiment_overview: 'Pulling experiment data',
  get_variant_performance: 'Analyzing variant performance',
  compare_variants: 'Comparing variants',
  get_funnel_data: 'Loading funnel data',
  get_growth_metrics: 'Loading growth metrics',
  fetch_page: 'Analyzing page content',
  get_variant_config: 'Reading variant config',
  get_change_history: 'Reviewing change history',
  propose_variant_change: 'Drafting change proposal',
  extract_page_content: 'Extracting page content',
  show_draft_preview: 'Building draft preview',
  create_vertical: 'Creating vertical',
  create_variant: 'Creating new variant',
  fork_page: 'Forking page as new variant',
  update_variant_status: 'Updating variant status',
  get_ad_spend_overview: 'Loading ad spend data',
  get_campaign_performance: 'Analyzing campaigns',
  get_budget_recommendations: 'Running budget analysis',
  calculate_required_sample: 'Calculating significance',
  read_file: 'Reading file',
  list_repo_files: 'Browsing repo',
  propose_code_change: 'Creating code PR',
  get_pr_status: 'Checking PR status',
  generate_wireframe: 'Building wireframe preview',
};

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Follow-up parser — strips GREENHOUSE_FOLLOWUPS line from text
// ---------------------------------------------------------------------------

function parseFollowUps(text: string): { content: string; followUps: string[] } {
  const marker = 'GREENHOUSE_FOLLOWUPS:';
  const idx = text.lastIndexOf(marker);
  if (idx === -1) return { content: text.trimEnd(), followUps: [] };

  const before = text.slice(0, idx).trimEnd();
  const after = text.slice(idx + marker.length).trim();
  const followUps = after
    .split('|')
    .map((q) => q.trim())
    .filter((q) => q.length > 0);

  return { content: before, followUps };
}

// ---------------------------------------------------------------------------
// Markdown-lite renderer
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];
  let keyCounter = 0;

  function flushBullets() {
    if (bulletBuffer.length > 0) {
      elements.push(
        <ul key={`ul-${keyCounter++}`} className="list-disc list-inside space-y-0.5 my-1 pl-2">
          {bulletBuffer.map((b, i) => (
            <li key={i} className="text-sm leading-relaxed">
              {renderInline(b)}
            </li>
          ))}
        </ul>
      );
      bulletBuffer = [];
    }
  }

  for (const line of lines) {
    if (line.startsWith('GREENHOUSE_FOLLOWUPS:')) {
      flushBullets();
    } else if (line.startsWith('## ')) {
      flushBullets();
      elements.push(
        <p key={keyCounter++} className="font-semibold text-sm mt-3 mb-1 text-white">
          {line.slice(3)}
        </p>
      );
    } else if (line.startsWith('# ')) {
      flushBullets();
      elements.push(
        <p key={keyCounter++} className="font-bold text-base mt-3 mb-1 text-white">
          {line.slice(2)}
        </p>
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      bulletBuffer.push(line.slice(2));
    } else if (line.trim() === '') {
      flushBullets();
      elements.push(<div key={keyCounter++} className="h-1" />);
    } else {
      flushBullets();
      elements.push(
        <p key={keyCounter++} className="text-sm leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }
  }
  flushBullets();
  return elements;
}

function renderInline(text: string): React.ReactNode {
  // Split on bold, markdown links, inline code, and bare URLs
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`|https?:\/\/[^\s)]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
    }

    const m = match[0];
    if (m.startsWith('**') && m.endsWith('**')) {
      // Bold
      parts.push(<strong key={key++} className="font-semibold text-white">{m.slice(2, -2)}</strong>);
    } else if (m.startsWith('[')) {
      // Markdown link: [text](url)
      const linkMatch = m.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        parts.push(
          <a key={key++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2">
            {linkMatch[1]}
          </a>
        );
      } else {
        parts.push(<span key={key++}>{m}</span>);
      }
    } else if (m.startsWith('`') && m.endsWith('`')) {
      // Inline code
      parts.push(<code key={key++} className="bg-zinc-800 text-amber-400 px-1 py-0.5 rounded text-xs font-mono">{m.slice(1, -1)}</code>);
    } else if (m.startsWith('http')) {
      // Bare URL
      parts.push(
        <a key={key++} href={m} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2 break-all">
          {m}
        </a>
      );
    }

    lastIndex = match.index + m.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }

  return parts.length > 0 ? parts : text;
}

// ---------------------------------------------------------------------------
// ChangeProposalCard
// ---------------------------------------------------------------------------

interface ChangeProposalCardProps {
  proposal: ChatMessage['changeProposal'];
  onApprove: (changeId: string) => Promise<void>;
  onReject: (changeId: string, reason: string) => Promise<void>;
}

/** Deep merge proposed changes into the current config, handling dot-notation keys like "cta_primary.text" */
function mergeChanges(
  base: Record<string, unknown>,
  changes: Record<string, unknown>
): Record<string, unknown> {
  const merged = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (key.includes('.')) {
      const parts = key.split('.');
      let target = merged as Record<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof target[parts[i]] !== 'object' || target[parts[i]] === null) {
          target[parts[i]] = {};
        }
        target = target[parts[i]] as Record<string, unknown>;
      }
      target[parts[parts.length - 1]] = value;
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function ChangeProposalCard({ proposal, onApprove, onReject }: ChangeProposalCardProps) {
  const [status, setStatus] = useState<'idle' | 'approving' | 'rejecting' | 'approved' | 'rejected'>('idle');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [previewTab, setPreviewTab] = useState<'diff' | 'before' | 'after'>('diff');

  if (!proposal) return null;

  const { changeId, hypothesis, changes, expectedImpact } = proposal;
  const hasFullConfig = !!proposal.fullCurrentConfig;

  async function handleApprove() {
    setStatus('approving');
    try {
      await onApprove(changeId);
      setStatus('approved');
    } catch {
      setStatus('idle');
    }
  }

  async function handleReject() {
    if (!showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    setStatus('rejecting');
    try {
      await onReject(changeId, rejectReason);
      setStatus('rejected');
    } catch {
      setStatus('idle');
    }
  }

  return (
    <div className="mt-3 border border-amber-500/20 rounded-xl bg-zinc-900/80 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
        <span className="text-sm leading-none">&#127793;</span>
        <span className="text-xs font-semibold text-amber-400">Change Proposal</span>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <p className="text-xs text-zinc-500 mb-1">Hypothesis</p>
          <p className="text-sm text-zinc-200">{hypothesis}</p>
        </div>

        {/* Tab toggle: Diff / Before / After */}
        <div className="flex items-center gap-1 border-b border-white/5 pb-0">
          {(['diff', ...(hasFullConfig ? ['before', 'after'] as const : [])] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setPreviewTab(tab as 'diff' | 'before' | 'after')}
              className={`text-xs px-3 py-1.5 rounded-t-md transition-colors ${
                previewTab === tab
                  ? 'bg-zinc-800 text-white border-b-2 border-amber-500'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab === 'diff' ? 'Changes' : tab === 'before' ? 'Before' : 'After'}
            </button>
          ))}
        </div>

        {previewTab === 'diff' && (
          <div>
            <div className="space-y-1">
              {Object.entries(changes).map(([key, value]) => {
                const currentVal = proposal.currentConfig?.[key];
                return (
                  <div key={key} className="text-xs font-mono bg-zinc-800 rounded px-2 py-1.5">
                    <span className="text-zinc-400">{key}:</span>{' '}
                    {currentVal !== undefined && (
                      <>
                        <span className="text-red-400 line-through">{String(currentVal)}</span>
                        <span className="text-zinc-600 mx-1">&rarr;</span>
                      </>
                    )}
                    <span className="text-green-400">{String(value)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {previewTab === 'before' && hasFullConfig && (
          <div className="mt-2">
            <VariantPreview config={proposal.fullCurrentConfig as Partial<VariantConfig>} />
          </div>
        )}

        {previewTab === 'after' && hasFullConfig && (
          <div className="mt-2">
            <VariantPreview config={mergeChanges(proposal.fullCurrentConfig!, changes) as Partial<VariantConfig>} />
          </div>
        )}

        <div>
          <p className="text-xs text-zinc-500 mb-1">Expected Impact</p>
          <p className="text-xs text-zinc-300">{expectedImpact}</p>
        </div>

        {showRejectInput && status !== 'rejected' && (
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (optional)..."
            className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-500 resize-none focus:outline-none focus:border-white/30"
            rows={2}
          />
        )}

        {status === 'approved' && (
          <div className="flex items-center gap-2 text-green-400 text-xs font-medium">
            <span>&#10003;</span> Change approved and applied
          </div>
        )}
        {status === 'rejected' && (
          <div className="flex items-center gap-2 text-red-400 text-xs font-medium">
            <span>&#10005;</span> Change rejected
          </div>
        )}
        {status !== 'approved' && status !== 'rejected' && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleApprove}
              disabled={status === 'approving'}
              className="flex-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {status === 'approving' ? 'Applying...' : 'Approve'}
            </button>
            <button
              onClick={handleReject}
              disabled={status === 'rejecting'}
              className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {status === 'rejecting' ? 'Rejecting...' : showRejectInput ? 'Confirm Reject' : 'Reject'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VariantCreatedCard
// ---------------------------------------------------------------------------

function VariantCreatedCard({ data }: { data: ChatMessage['variantCreated'] }) {
  if (!data) return null;

  const isExternal = data.config?.template === 'external';

  return (
    <div className="mt-3 border border-green-500/20 rounded-xl bg-zinc-900/80 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
        <span className="text-sm leading-none">{isExternal ? '&#8599;' : '&#10024;'}</span>
        <span className="text-xs font-semibold text-green-400">
          {isExternal ? 'External URL Variant Added' : 'Variant Created'}
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">{data.slug}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{data.headline}</p>
          </div>
          <a
            href={data.liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-green-500/20 text-green-400 border border-green-500/30 px-3 py-1.5 rounded-lg hover:bg-green-500/30 transition-colors"
          >
            {isExternal ? 'Open URL' : 'View Live'} &#8599;
          </a>
        </div>
        {isExternal ? (
          <div className="bg-zinc-800 rounded-lg px-3 py-2.5 text-xs font-mono text-blue-400 break-all">
            {data.liveUrl}
          </div>
        ) : (
          <>
            <VariantPreview config={data.config as Partial<VariantConfig>} />
            <p className="text-xs text-zinc-600 text-center">Live preview at 33% scale</p>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CodeChangeCard
// ---------------------------------------------------------------------------

function CodeChangeCard({ data }: { data: NonNullable<ChatMessage['codeChanges']>[number] | undefined }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!data?.changeId) return;

    // Poll for Vercel preview URL
    async function check() {
      try {
        const res = await fetch(`/api/changes/${data!.changeId}/preview-url`);
        if (res.ok) {
          const json = await res.json() as { preview_url?: string };
          if (json.preview_url) {
            setPreviewUrl(json.preview_url);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        }
      } catch { /* ignore */ }
    }

    check();
    pollRef.current = setInterval(check, 15_000); // poll every 15s
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [data?.changeId]);

  if (!data) return null;

  return (
    <div className="mt-3 border border-blue-500/20 rounded-xl bg-zinc-900/80 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
        <span className="text-sm leading-none">&#128736;</span>
        <span className="text-xs font-semibold text-blue-400">Code Change — PR #{data.prNumber}</span>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <p className="text-xs text-zinc-500 mb-1">Hypothesis</p>
          <p className="text-sm text-zinc-200">{data.hypothesis}</p>
        </div>
        <div className="text-xs font-mono bg-zinc-800 rounded px-3 py-2 space-y-1">
          <p><span className="text-zinc-500">repo:</span> <span className="text-zinc-300">{data.repo}</span></p>
          <p><span className="text-zinc-500">file:</span> <span className="text-zinc-300">{data.filePath}</span></p>
          <p><span className="text-zinc-500">branch:</span> <span className="text-zinc-300">{data.branch}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={data.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-3 py-1.5 rounded-lg hover:bg-blue-500/30 transition-colors"
          >
            Review PR &#8599;
          </a>
          {previewUrl && (
            <button
              onClick={() => setShowPreview(true)}
              className="text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30 px-3 py-1.5 rounded-lg hover:bg-purple-500/30 transition-colors"
            >
              Vercel Preview &#9654;
            </button>
          )}
          {!previewUrl && (
            <span className="text-xs text-zinc-600 animate-pulse">Waiting for deploy preview...</span>
          )}
        </div>
      </div>

      {/* Vercel preview modal */}
      {showPreview && previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowPreview(false); }}
        >
          <div className="bg-zinc-900 border border-white/10 rounded-xl w-full max-w-6xl h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-purple-400">Vercel Deploy Preview</span>
                <span className="text-xs text-zinc-600 truncate max-w-md">{previewUrl}</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-zinc-400 hover:text-white transition-colors"
                >
                  Open in new tab &#8599;
                </a>
                <button
                  onClick={() => setShowPreview(false)}
                  className="text-zinc-500 hover:text-white text-lg leading-none transition-colors"
                >
                  &times;
                </button>
              </div>
            </div>
            <iframe
              src={previewUrl}
              className="flex-1 w-full bg-white"
              title="Vercel Deploy Preview"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PagePreviewCard — shows iframe of the fetched URL
// ---------------------------------------------------------------------------

function PagePreviewCard({ data }: { data: ChatMessage['pagePreview'] }) {
  const [iframeError, setIframeError] = useState(false);

  if (!data) return null;

  return (
    <div className="mt-3 border border-zinc-700/50 rounded-xl bg-zinc-900/80 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm leading-none">&#127760;</span>
          <span className="text-xs font-semibold text-zinc-300 truncate">{data.title || data.url}</span>
        </div>
        <a
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-zinc-500 hover:text-white transition-colors flex-shrink-0"
        >
          Open &#8599;
        </a>
      </div>

      {/* Page content summary */}
      {data.headings.length > 0 && (
        <div className="px-4 py-2.5 border-b border-white/5">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5">Page content</p>
          {data.headings.slice(0, 5).map((h, i) => (
            <p key={i} className="text-xs text-zinc-400 truncate">{h}</p>
          ))}
        </div>
      )}

      {/* Iframe preview — with error fallback */}
      {!iframeError ? (
        <div className="relative" style={{ height: 300 }}>
          <iframe
            src={data.url}
            className="w-full h-full border-0 bg-white"
            title={`Preview: ${data.url}`}
            sandbox="allow-scripts allow-same-origin allow-top-navigation-by-user-activation allow-popups"
            onError={() => setIframeError(true)}
            onLoad={(e) => {
              // Some sites block iframe but don't fire onerror —
              // we can't reliably detect this, so we show the iframe anyway
              try {
                const iframe = e.target as HTMLIFrameElement;
                // If we can't access contentDocument, it's likely blocked
                if (!iframe.contentDocument && !iframe.contentWindow) {
                  setIframeError(true);
                }
              } catch {
                // Cross-origin — expected for external sites, iframe still renders
              }
            }}
          />
        </div>
      ) : (
        <div className="px-4 py-6 text-center">
          <p className="text-xs text-zinc-500 mb-2">This site blocks iframe previews</p>
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg hover:bg-zinc-700 transition-colors"
          >
            Open in new tab &#8599;
          </a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WireframeCard — ASCII wireframe preview of a page
// ---------------------------------------------------------------------------

function WireframeCard({ data }: { data: ChatMessage['wireframe'] }) {
  if (!data) return null;

  return (
    <div className="mt-3 border border-zinc-700/50 rounded-xl bg-zinc-900/80 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm leading-none">&#9638;</span>
          <span className="text-xs font-semibold text-zinc-300 truncate">{data.title}</span>
          {data.variantLabel && (
            <span className="text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
              {data.variantLabel}
            </span>
          )}
        </div>
        <span className="text-[10px] text-zinc-600 font-mono truncate max-w-[200px]">{data.sourcePath}</span>
      </div>

      <div className="p-4 overflow-x-auto">
        <pre className="text-xs font-mono leading-relaxed text-zinc-300 whitespace-pre">{data.ascii}</pre>
      </div>

      <div className="px-4 py-2 border-t border-white/5">
        <p className="text-[10px] text-zinc-600">
          Based on <span className="font-mono">{data.sourcePath}</span>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DraftCard — shows accumulated text replacements as a visual diff
// ---------------------------------------------------------------------------

function DraftCard({ data, onPush }: { data: ChatMessage['draft']; onPush: (draft: NonNullable<ChatMessage['draft']>) => Promise<void> }) {
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<{ prUrl: string; prNumber: number } | null>(null);

  if (!data) return null;

  async function handlePush() {
    setPushing(true);
    try {
      await onPush(data!);
      // result is set by the parent via the data.status changing
    } catch {
      setPushing(false);
    }
  }

  const isPushed = data.status === 'pushed' || !!result;

  return (
    <div className="mt-3 border border-amber-500/20 rounded-xl bg-zinc-900/80 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm leading-none">{'\u270F'}</span>
          <span className="text-xs font-semibold text-amber-400">Draft Variant</span>
        </div>
        <span className="text-xs text-zinc-500 font-mono">{data.sourcePath} {'\u2192'} /{data.newRoute}</span>
      </div>

      <div className="p-4 space-y-3">
        {/* Hypothesis */}
        <div>
          <p className="text-xs text-zinc-500 mb-1">Hypothesis</p>
          <p className="text-sm text-zinc-200">{data.hypothesis}</p>
        </div>

        {/* Replacement diffs */}
        <div>
          <p className="text-xs text-zinc-500 mb-2">Proposed Changes ({data.replacements.length})</p>
          <div className="space-y-2">
            {data.replacements.map((r, idx) => (
              <div key={idx} className="bg-zinc-800 rounded-lg px-3 py-2">
                {r.context && (
                  <p className="text-[10px] text-zinc-600 mb-1">{r.context}</p>
                )}
                <p className="text-xs">
                  <span className="text-red-400 line-through">{r.find}</span>
                </p>
                <p className="text-xs mt-0.5">
                  <span className="text-green-400">{r.replace}</span>
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        {isPushed ? (
          <div className="flex items-center gap-2">
            <span className="text-green-400 text-xs">{'\u2713'} PR created</span>
            {(data.prUrl || result?.prUrl) && (
              <a
                href={data.prUrl ?? result?.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                View PR #{data.prNumber ?? result?.prNumber} {'\u2197'}
              </a>
            )}
          </div>
        ) : (
          <button
            onClick={handlePush}
            disabled={pushing || data.replacements.length === 0}
            className="w-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 text-xs font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {pushing ? 'Creating PR...' : `Push ${data.replacements.length} changes to GitHub`}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notify parent (dashboard) that data changed — triggers router.refresh()
// ---------------------------------------------------------------------------

function notifyDataChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('greenhouse:data-changed'));
  }
}

// ---------------------------------------------------------------------------
// Helper: update last message
// ---------------------------------------------------------------------------

function updateLastMessage(
  messages: ChatMessage[],
  updater: (msg: ChatMessage) => ChatMessage
): ChatMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), updater(last)];
}

// ---------------------------------------------------------------------------
// Empty state suggestions
// ---------------------------------------------------------------------------

const EMPTY_SUGGESTIONS = [
  'How are my experiments performing this week?',
  'Which variant is winning and by how much?',
  'Where am I losing users in the funnel?',
  'Which campaigns have the lowest CPA?',
  'Do I have enough data to call a winner?',
];

// ---------------------------------------------------------------------------
// History panel
// ---------------------------------------------------------------------------

function HistoryPanel({
  chats,
  onRestore,
  onRename,
  onDelete,
  onClearAll,
  onClose,
}: {
  chats: SavedChat[];
  onRestore: (chat: SavedChat) => void;
  onRename: (chatId: string, newTitle: string) => void;
  onDelete: (chatId: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  return (
    <div className="absolute right-0 top-full mt-1 z-30 w-72 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
      <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Recent chats</p>
        <div className="flex items-center gap-2">
          {chats.length > 0 && (
            <button
              onClick={() => { if (confirm('Clear all chat history?')) onClearAll(); }}
              className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors"
            >
              Clear all
            </button>
          )}
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-sm leading-none">{'\u00D7'}</button>
        </div>
      </div>
      {chats.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-xs text-zinc-600">No saved conversations yet</p>
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className="flex items-center gap-1 px-4 py-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 group"
            >
              {renamingId === chat.id ? (
                <div className="flex-1 flex items-center gap-1">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { onRename(chat.id, renameValue); setRenamingId(null); }
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    className="flex-1 bg-zinc-800 border border-white/20 rounded px-2 py-1 text-xs text-white focus:outline-none"
                  />
                  <button onClick={() => { onRename(chat.id, renameValue); setRenamingId(null); }} className="text-[10px] text-green-400">Save</button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => onRestore(chat)}
                    className="flex-1 text-left min-w-0"
                  >
                    <p className="text-xs text-zinc-200 truncate">{chat.title}</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      {new Date(chat.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </button>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenamingId(chat.id); setRenameValue(chat.title); }}
                      className="text-zinc-700 hover:text-zinc-400 text-[10px] px-1 transition-colors"
                      title="Rename"
                    >
                      {'\u270E'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(chat.id); }}
                      className="text-zinc-700 hover:text-red-400 text-[10px] px-1 transition-colors"
                      title="Delete"
                    >
                      {'\u2715'}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ChatInterface
// ---------------------------------------------------------------------------

export function ChatInterface({ projectId, initialPrompt, compact }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialPromptSent = useRef(false);
  const currentChatIdRef = useRef<string | null>(null);

  // Load history from localStorage on mount
  useEffect(() => {
    setSavedChats(loadHistory());
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (initialPrompt && !initialPromptSent.current) {
      initialPromptSent.current = true;
      sendMessage(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return;

    setIsStreaming(true);
    setInput('');

    const userMsg: ChatMessage = { role: 'user', content, status: 'complete' };
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [],
      status: 'streaming',
    };

    const newHistory: ConversationMessage[] = [
      ...conversationHistory,
      { role: 'user', content },
    ];

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setConversationHistory(newHistory);

    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newHistory,
          projectId,
        }),
      });

      if (!response.ok) {
        let errorMsg = `API error: ${response.status}`;
        try {
          const errJson = await response.json() as { error?: string };
          if (errJson.error) errorMsg = errJson.error;
        } catch { /* ignore */ }
        throw new Error(errorMsg);
      }

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (event.type === 'text') {
            assistantText += event.content as string;
            const captured = assistantText;
            setMessages((prev) =>
              updateLastMessage(prev, (msg) => ({ ...msg, content: captured }))
            );
          } else if (event.type === 'tool_call') {
            setMessages((prev) =>
              updateLastMessage(prev, (msg) => ({
                ...msg,
                toolCalls: [
                  ...(msg.toolCalls ?? []),
                  { tool: event.tool as string, input: (event.input as object) ?? {}, done: false },
                ],
              }))
            );
          } else if (event.type === 'tool_result') {
            const toolName = event.tool as string;
            const result = event.result as string;

            if (toolName === 'generate_wireframe') {
              try {
                const parsed = JSON.parse(result) as {
                  type?: string;
                  title?: string;
                  ascii?: string;
                  source_path?: string;
                  variant_label?: string | null;
                };
                if (parsed.type === 'wireframe' && parsed.ascii) {
                  setMessages((prev) =>
                    updateLastMessage(prev, (msg) => ({
                      ...msg,
                      wireframe: {
                        title: parsed.title ?? '',
                        ascii: parsed.ascii!,
                        sourcePath: parsed.source_path ?? '',
                        variantLabel: parsed.variant_label ?? undefined,
                      },
                      toolCalls: (msg.toolCalls ?? []).map((tc) =>
                        tc.tool === toolName && !tc.done
                          ? { ...tc, result, done: true }
                          : tc
                      ),
                    }))
                  );
                  continue;
                }
              } catch {
                // fall through
              }
            }

            if (toolName === 'show_draft_preview') {
              try {
                const parsed = JSON.parse(result) as {
                  type?: string;
                  vertical_id?: string;
                  source_path?: string;
                  new_route?: string;
                  hypothesis?: string;
                  replacements?: Array<{ find: string; replace: string; context?: string }>;
                };
                if (parsed.type === 'draft_preview' && parsed.replacements) {
                  setMessages((prev) =>
                    updateLastMessage(prev, (msg) => ({
                      ...msg,
                      draft: {
                        verticalId: parsed.vertical_id ?? '',
                        sourcePath: parsed.source_path ?? '',
                        newRoute: (parsed.new_route ?? '').replace(/^\//, ''),
                        hypothesis: parsed.hypothesis ?? '',
                        replacements: parsed.replacements ?? [],
                        status: 'drafting' as const,
                      },
                      toolCalls: (msg.toolCalls ?? []).map((tc) =>
                        tc.tool === toolName && !tc.done
                          ? { ...tc, result, done: true }
                          : tc
                      ),
                    }))
                  );
                  continue;
                }
              } catch {
                // fall through
              }
            }

            if (toolName === 'fetch_page') {
              try {
                const parsed = JSON.parse(result) as {
                  url?: string;
                  title?: string;
                  headings?: Array<{ level: number; text: string }>;
                };
                if (parsed.url) {
                  setMessages((prev) =>
                    updateLastMessage(prev, (msg) => ({
                      ...msg,
                      pagePreview: {
                        url: parsed.url!,
                        title: parsed.title ?? '',
                        headings: (parsed.headings ?? []).map((h) => h.text),
                      },
                      toolCalls: (msg.toolCalls ?? []).map((tc) =>
                        tc.tool === toolName && !tc.done
                          ? { ...tc, result, done: true }
                          : tc
                      ),
                    }))
                  );
                  continue;
                }
              } catch {
                // fall through
              }
            }

            if (toolName === 'propose_variant_change') {
              try {
                const parsed = JSON.parse(result) as {
                  change_id?: string;
                  hypothesis?: string;
                  changes?: Record<string, unknown>;
                  expected_impact?: string;
                  current_config_summary?: Record<string, unknown>;
                  current_config?: Record<string, unknown>;
                };
                if (parsed.change_id) {
                  setMessages((prev) =>
                    updateLastMessage(prev, (msg) => ({
                      ...msg,
                      changeProposal: {
                        changeId: parsed.change_id!,
                        hypothesis: parsed.hypothesis ?? '',
                        changes: parsed.changes ?? {},
                        expectedImpact: parsed.expected_impact ?? '',
                        currentConfig: parsed.current_config_summary,
                        fullCurrentConfig: parsed.current_config,
                      },
                      toolCalls: (msg.toolCalls ?? []).map((tc) =>
                        tc.tool === toolName && !tc.done
                          ? { ...tc, result, done: true }
                          : tc
                      ),
                    }))
                  );
                  continue;
                }
              } catch {
                // fall through
              }
            }

            if (toolName === 'create_variant') {
              try {
                const parsed = JSON.parse(result) as {
                  variant_id?: string;
                  variant_type?: string;
                  slug?: string;
                  live_url?: string;
                  external_url?: string;
                  label?: string;
                  headline?: string;
                  config?: Record<string, unknown>;
                  change_id?: string;
                };
                if (parsed.variant_id) {
                  setMessages((prev) =>
                    updateLastMessage(prev, (msg) => ({
                      ...msg,
                      variantCreated: {
                        variantId: parsed.variant_id!,
                        slug: parsed.slug ?? '',
                        liveUrl: parsed.variant_type === 'external_url'
                          ? (parsed.external_url ?? '')
                          : (parsed.live_url ?? ''),
                        headline: parsed.variant_type === 'external_url'
                          ? (parsed.label ?? parsed.external_url ?? '')
                          : (parsed.headline ?? ''),
                        config: parsed.config ?? {},
                        changeId: parsed.change_id ?? '',
                      },
                      toolCalls: (msg.toolCalls ?? []).map((tc) =>
                        tc.tool === toolName && !tc.done
                          ? { ...tc, result, done: true }
                          : tc
                      ),
                    }))
                  );
                  notifyDataChanged();
                  continue;
                }
              } catch {
                // fall through
              }
            }

            if (toolName === 'fork_page' || toolName === 'propose_code_change') {
              try {
                const parsed = JSON.parse(result) as {
                  change_id?: string;
                  pr_number?: number;
                  pr_url?: string;
                  branch?: string;
                  repo?: string;
                  file_path?: string;
                  new_file?: string;
                  source_file?: string;
                  new_route?: string;
                  hypothesis?: string;
                };
                if (parsed.pr_number) {
                  const newCodeChange = {
                    changeId: parsed.change_id ?? '',
                    prNumber: parsed.pr_number!,
                    prUrl: parsed.pr_url ?? '',
                    branch: parsed.branch ?? '',
                    repo: parsed.repo ?? 'popcorn',
                    filePath: parsed.file_path ?? parsed.new_file ?? parsed.source_file ?? '',
                    hypothesis: parsed.hypothesis ?? '',
                  };
                  setMessages((prev) =>
                    updateLastMessage(prev, (msg) => ({
                      ...msg,
                      codeChanges: [...(msg.codeChanges ?? []), newCodeChange],
                      toolCalls: (msg.toolCalls ?? []).map((tc) =>
                        tc.tool === toolName && !tc.done
                          ? { ...tc, result, done: true }
                          : tc
                      ),
                    }))
                  );
                  notifyDataChanged();
                  continue;
                }
              } catch {
                // fall through
              }
            }

            setMessages((prev) =>
              updateLastMessage(prev, (msg) => ({
                ...msg,
                toolCalls: (msg.toolCalls ?? []).map((tc, idx, arr) => {
                  const isLast = arr.slice(idx + 1).every((t) => t.tool !== toolName || t.done);
                  return tc.tool === toolName && !tc.done && isLast
                    ? { ...tc, result, done: true }
                    : tc;
                }),
              }))
            );
          } else if (event.type === 'done') {
            const { content: cleanContent, followUps } = parseFollowUps(assistantText);

            const finalHistory: ConversationMessage[] = [
              ...newHistory,
              { role: 'assistant', content: cleanContent },
            ];

            setConversationHistory(finalHistory);
            setMessages((prev) =>
              updateLastMessage(prev, (msg) => ({
                ...msg,
                content: cleanContent,
                followUps: followUps.length > 0 ? followUps : undefined,
                status: 'complete',
              }))
            );

            // Save conversation to localStorage
            const chatId = currentChatIdRef.current ?? `chat-${Date.now()}`;
            currentChatIdRef.current = chatId;
            const title = newHistory[0]?.content?.slice(0, 60) ?? 'Conversation';
            const historyMessages: ChatMessage[] = finalHistory.map((m) => ({
              role: m.role,
              content: m.content,
              status: 'complete' as const,
            }));
            const chatToSave: SavedChat = {
              id: chatId,
              title,
              savedAt: new Date().toISOString(),
              messages: historyMessages,
              conversationHistory: finalHistory,
            };
            setSavedChats((prev) => persistChat(chatToSave, prev));

            setIsStreaming(false);
          } else if (event.type === 'error') {
            setMessages((prev) =>
              updateLastMessage(prev, (msg) => ({
                ...msg,
                content: `⚠ ${event.message as string}`,
                status: 'complete',
              }))
            );
            setIsStreaming(false);
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) =>
        updateLastMessage(prev, (msg) => ({
          ...msg,
          content: `⚠ ${message}`,
          status: 'complete',
        }))
      );
      setIsStreaming(false);
    }
  }, [conversationHistory, isStreaming, projectId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function clearConversation() {
    setMessages([]);
    setConversationHistory([]);
    setInput('');
    currentChatIdRef.current = null;
    initialPromptSent.current = false;
    setHistoryOpen(false);
  }

  function restoreChat(chat: SavedChat) {
    setMessages(chat.messages);
    setConversationHistory(chat.conversationHistory);
    currentChatIdRef.current = chat.id;
    setHistoryOpen(false);
  }

  async function handleApprove(changeId: string) {
    const res = await fetch(`/api/changes/${changeId}/approve`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error ?? 'Approval failed');
    }
    notifyDataChanged();
  }

  async function handleReject(changeId: string, reason: string) {
    const res = await fetch(`/api/changes/${changeId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error ?? 'Rejection failed');
    }
  }

  async function handleDraftPush(draft: NonNullable<ChatMessage['draft']>) {
    const res = await fetch(`/api/verticals/${draft.verticalId}/variants/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        new_route: draft.newRoute,
        text_replacements: draft.replacements.map(({ find, replace }) => ({ find, replace })),
        hypothesis: draft.hypothesis,
        description: draft.hypothesis,
      }),
    });

    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error ?? 'Failed to create PR');
    }

    const result = await res.json() as { pr_url: string; pr_number: number };

    // Update the draft status in the message
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.draft?.verticalId === draft.verticalId && msg.draft?.newRoute === draft.newRoute) {
          return {
            ...msg,
            draft: { ...msg.draft, status: 'pushed' as const, prUrl: result.pr_url, prNumber: result.pr_number },
          };
        }
        return msg;
      })
    );

    notifyDataChanged();
  }

  return (
    <div className={`flex flex-col h-full bg-zinc-950`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/8 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 bg-amber-500/15 rounded-md flex items-center justify-center">
            <span className="text-base leading-none">🌱</span>
          </div>
          <div>
            <p className="font-semibold text-sm leading-none">Growth Expert</p>
            <p className="text-zinc-500 text-xs mt-0.5">Powered by Claude</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* History button */}
          <div className="relative">
            <button
              onClick={() => setHistoryOpen((o) => !o)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2.5 py-1 rounded-lg hover:bg-white/5 flex items-center gap-1"
            >
              History
              {savedChats.length > 0 && (
                <span className="text-[10px] bg-zinc-700 text-zinc-400 rounded-full px-1.5 py-0.5 leading-none">
                  {savedChats.length}
                </span>
              )}
            </button>
            {historyOpen && (
              <HistoryPanel
                chats={savedChats}
                onRestore={restoreChat}
                onRename={(chatId, newTitle) => {
                  setSavedChats((prev) => {
                    const updated = prev.map((c) => c.id === chatId ? { ...c, title: newTitle } : c);
                    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch { /* */ }
                    return updated;
                  });
                }}
                onDelete={(chatId) => {
                  setSavedChats((prev) => {
                    const updated = prev.filter((c) => c.id !== chatId);
                    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch { /* */ }
                    return updated;
                  });
                }}
                onClearAll={() => {
                  setSavedChats([]);
                  try { localStorage.removeItem(HISTORY_KEY); } catch { /* */ }
                }}
                onClose={() => setHistoryOpen(false)}
              />
            )}
          </div>
          <button
            onClick={clearConversation}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2.5 py-1 rounded-lg hover:bg-white/5"
          >
            New chat
          </button>
        </div>
      </div>

      {/* Click-outside to close history */}
      {historyOpen && (
        <div className="fixed inset-0 z-20" onClick={() => setHistoryOpen(false)} />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-8">
            <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center">
              <span className="text-2xl">🌱</span>
            </div>
            <div>
              <p className="text-white font-semibold text-base">Ask about your experiments</p>
              <p className="text-zinc-500 text-sm mt-1">Get data-driven insights on performance, significance, and what to test next</p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-sm mt-2">
              {EMPTY_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => sendMessage(suggestion)}
                  disabled={isStreaming}
                  className="w-full text-left text-xs text-zinc-400 hover:text-white bg-zinc-900/60 hover:bg-zinc-800/80 border border-white/6 hover:border-white/12 px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`${msg.role === 'user' ? 'max-w-[72%]' : 'w-full'}`}>

              {/* Tool call indicators */}
              {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  {msg.toolCalls.map((tc, tcIdx) => (
                    <div
                      key={tcIdx}
                      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
                        tc.done
                          ? 'bg-transparent border-white/5 text-zinc-600'
                          : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400 animate-pulse'
                      }`}
                    >
                      {tc.done ? (
                        <span className="text-green-500 text-[10px]">✓</span>
                      ) : (
                        <span className="text-amber-400/60 text-[10px]">⟳</span>
                      )}
                      <span>{tc.done ? toolLabel(tc.tool) : `${toolLabel(tc.tool)}...`}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Message bubble */}
              {msg.role === 'user' ? (
                <div className="bg-zinc-800 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-white">
                  {msg.content}
                </div>
              ) : (
                <div className="space-y-1">
                  {/* Assistant label */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base leading-none">🌱</span>
                    {msg.status === 'streaming' && (
                      <span className="text-xs text-zinc-600">thinking...</span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="text-zinc-200 space-y-0.5">
                    {msg.content && renderMarkdown(msg.content)}
                    {msg.status === 'streaming' && !msg.content && (
                      <div className="flex gap-1 items-center h-5">
                        <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    )}
                  </div>

                  {/* Change proposal card */}
                  {msg.changeProposal && (
                    <ChangeProposalCard
                      proposal={msg.changeProposal}
                      onApprove={handleApprove}
                      onReject={handleReject}
                    />
                  )}

                  {/* Variant created card */}
                  {msg.variantCreated && (
                    <VariantCreatedCard data={msg.variantCreated} />
                  )}

                  {/* Code change cards with Vercel preview */}
                  {msg.codeChanges && msg.codeChanges.map((cc, idx) => (
                    <CodeChangeCard key={cc.changeId || idx} data={cc} />
                  ))}

                  {/* Page preview card */}
                  {msg.pagePreview && (
                    <PagePreviewCard data={msg.pagePreview} />
                  )}

                  {/* Wireframe preview card */}
                  {msg.wireframe && (
                    <WireframeCard data={msg.wireframe} />
                  )}

                  {/* Draft preview card */}
                  {msg.draft && (
                    <DraftCard data={msg.draft} onPush={handleDraftPush} />
                  )}

                  {/* Suggested follow-ups */}
                  {msg.status === 'complete' && msg.followUps && msg.followUps.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <p className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-2">
                        Suggested follow-ups
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {msg.followUps.map((q, qi) => (
                          <button
                            key={qi}
                            onClick={() => sendMessage(q)}
                            disabled={isStreaming}
                            className="text-left text-xs text-zinc-400 hover:text-white bg-zinc-900/50 hover:bg-zinc-800 border border-white/6 hover:border-white/15 px-3 py-2 rounded-lg transition-colors disabled:opacity-40 flex items-start gap-2"
                          >
                            <span className="text-amber-500/60 mt-0.5 shrink-0">›</span>
                            <span>{q}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-white/8 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your experiments, campaigns, or variants..."
            disabled={isStreaming}
            rows={1}
            className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 resize-none focus:outline-none focus:border-white/25 disabled:opacity-50 transition-colors max-h-32 overflow-y-auto"
            style={{ minHeight: '42px' }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={isStreaming || !input.trim()}
            className="flex-shrink-0 bg-amber-500 hover:bg-amber-400 disabled:opacity-35 disabled:cursor-not-allowed text-black font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors"
          >
            {isStreaming ? (
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 bg-black rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 bg-black rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 bg-black rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            ) : (
              '↑'
            )}
          </button>
        </div>
        <p className="text-xs text-zinc-700 mt-1.5 px-1">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
