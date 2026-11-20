'use client';

import { useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

type GraphState = {
  id: string;
  name: string;
  url?: string | null;
  title?: string | null;
  visited?: boolean;
};

const nodeTypes = { state: StateNode };

export function FlowGraph({
  states,
  edges,
  failedUrls,
}: {
  states: GraphState[];
  edges: Array<{ id: string; fromStateId: string; toStateId: string }>;
  failedUrls?: string[];
}) {
  const labeled = useMemo(() => uniqueStateLabels(states), [states]);
  const failedExact = useMemo(() => uniqueFailedUrls(states, failedUrls ?? []), [states, failedUrls]);
  const loopCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      if (edge.fromStateId === edge.toStateId) {
        counts.set(edge.fromStateId, (counts.get(edge.fromStateId) ?? 0) + 1);
      }
    }
    return counts;
  }, [edges]);
  const positions = useMemo(() => layoutStates(states, edges), [states, edges]);

  const nodes: Node[] = useMemo(
    () =>
      states.map((state) => {
        const url = normalizeUrl(state.url);
        const failedState = failedExact.has(url);
        const status = failedState ? 'failed' : state.visited ? 'visited' : 'untested';
        return {
          id: state.id,
          type: 'state',
          position: positions.get(state.id) ?? { x: 0, y: 0 },
          data: {
            label: labeled.get(state.id) ?? state.name,
            path: pathFromUrl(state.url),
            status,
            loops: loopCounts.get(state.id) ?? 0,
          },
        };
      }),
    [states, labeled, failedExact, loopCounts, positions],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges
        .filter((edge) => edge.fromStateId !== edge.toStateId)
        .map((edge) => ({
          id: edge.id,
          source: edge.fromStateId,
          target: edge.toStateId,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        })),
    [edges],
  );

  if (states.length === 0) {
    return (
      <div className="flex h-[320px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#cfd3d9] text-center">
        <p className="text-sm font-medium text-ink">No application states discovered yet</p>
        <p className="max-w-sm text-[13px] text-muted-foreground">Screens and the actions between them appear here as the audit explores.</p>
      </div>
    );
  }

  return (
    <div className="h-[420px] overflow-hidden rounded-lg border border-border bg-well sm:h-[560px]">
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.25}
        nodesConnectable={false}
        elementsSelectable
        colorMode="light"
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background gap={20} color="#d3d6db" />
        <Controls showInteractive={false} className="!overflow-hidden !rounded-md !border !border-border !shadow-none" />
      </ReactFlow>
    </div>
  );
}

function StateNode({ data }: NodeProps) {
  const status = String(data.status ?? 'untested');
  const tone =
    status === 'failed'
      ? 'border-[#f2c4bf] bg-[#fdf1ef] text-ink'
      : status === 'visited'
        ? 'border-border bg-card text-ink'
        : 'border-border bg-well text-muted-foreground';
  const dot = status === 'failed' ? 'bg-danger' : status === 'visited' ? 'bg-success' : 'bg-[#cfd3d9]';
  return (
    <div className={`min-w-[200px] max-w-[240px] rounded-md border px-3 py-2 ${tone}`}>
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-[#8a8f97]" />
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-[#8a8f97]" />
      <div className="flex items-center gap-2">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate text-sm font-medium">{String(data.label)}</span>
      </div>
      {data.path ? <div className="mono mt-0.5 truncate text-[11px] text-muted-foreground">{String(data.path)}</div> : null}
      {Number(data.loops) > 0 ? <div className="mt-1 text-[11px] text-muted-foreground">↻ {String(data.loops)} self-loop{Number(data.loops) === 1 ? '' : 's'}</div> : null}
    </div>
  );
}

export function uniqueStateLabels(states: GraphState[]): Map<string, string> {
  const totals = new Map<string, number>();
  for (const state of states) {
    const base = displayName(state);
    totals.set(base, (totals.get(base) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const result = new Map<string, string>();
  for (const state of states) {
    const base = displayName(state);
    const total = totals.get(base) ?? 1;
    const next = (seen.get(base) ?? 0) + 1;
    seen.set(base, next);
    result.set(state.id, total === 1 ? base : `${base} (${next})`);
  }
  return result;
}

function displayName(state: GraphState): string {
  const title = (state.title ?? '').trim();
  const name = state.name.trim();
  const path = pathFromUrl(state.url);
  if (title && !looksLikePath(title)) {
    return title;
  }
  if (name && !looksLikePath(name)) {
    return name;
  }
  if (path) {
    const leaf = path.split('/').filter(Boolean).slice(-2).join('/') || path;
    return leaf;
  }
  return name || title || 'State';
}

function looksLikePath(value: string): boolean {
  return value.includes('/') && !value.includes(' ');
}

function pathFromUrl(url: string | null | undefined): string {
  if (!url) {
    return '';
  }
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

function normalizeUrl(url: string | null | undefined): string {
  return (url ?? '').replace(/\/$/, '');
}

function uniqueFailedUrls(states: GraphState[], failedUrls: string[]): Set<string> {
  const failed = new Set(failedUrls.map((item) => normalizeUrl(item)).filter(Boolean));
  const urlCounts = new Map<string, number>();
  for (const state of states) {
    const url = normalizeUrl(state.url);
    urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1);
  }
  const exact = new Set<string>();
  for (const url of failed) {
    if ((urlCounts.get(url) ?? 0) === 1) {
      exact.add(url);
    }
  }
  return exact;
}

function layoutStates(
  states: GraphState[],
  edges: Array<{ fromStateId: string; toStateId: string }>,
): Map<string, { x: number; y: number }> {
  const ids = states.map((state) => state.id);
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const edge of edges) {
    if (edge.fromStateId === edge.toStateId) {
      continue;
    }
    if (!outgoing.has(edge.fromStateId) || !outgoing.has(edge.toStateId)) {
      continue;
    }
    outgoing.get(edge.fromStateId)?.push(edge.toStateId);
    indegree.set(edge.toStateId, (indegree.get(edge.toStateId) ?? 0) + 1);
  }
  const roots = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const queue = (roots.length > 0 ? roots : ids.slice(0, 1)).map((id) => ({ id, depth: 0 }));
  const depth = new Map<string, number>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || depth.has(current.id)) {
      continue;
    }
    depth.set(current.id, current.depth);
    for (const next of outgoing.get(current.id) ?? []) {
      queue.push({ id: next, depth: current.depth + 1 });
    }
  }
  for (const id of ids) {
    if (!depth.has(id)) {
      depth.set(id, 0);
    }
  }
  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const column = depth.get(id) ?? 0;
    const list = columns.get(column) ?? [];
    list.push(id);
    columns.set(column, list);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [column, list] of [...columns.entries()].sort((left, right) => left[0] - right[0])) {
    list.forEach((id, index) => {
      positions.set(id, { x: column * 280, y: index * 140 });
    });
  }
  return positions;
}
