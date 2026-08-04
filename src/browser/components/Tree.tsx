import { useState } from 'react';
import type { DatasetNode } from '../../core/browse/types';
import type { Selection } from '../hooks/useScope';

function Node({
  node, depth, selected, onSelect,
}: {
  node: DatasetNode; depth: number; selected: Selection; onSelect(p: Selection): void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className={`bw-node${selected === node.path ? ' on' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onSelect(node.path)}
      >
        <span
          className={`bw-twist${hasChildren ? '' : ' hidden'}${open ? ' open' : ''}`}
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        >
          ▸
        </span>
        <span className="bw-node-name" title={node.path}>{node.name}</span>
        <span className="bw-node-count">{node.count}</span>
      </div>
      {open && node.children.map((c) => (
        <Node key={c.path} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
      ))}
    </>
  );
}

export function Tree({
  tree, total, selected, onSelect,
}: {
  tree: DatasetNode[]; total: number; selected: Selection; onSelect(p: Selection): void;
}) {
  return (
    <nav className="bw-tree">
      <div
        className={`bw-node${selected === null ? ' on' : ''}`}
        style={{ paddingLeft: 8 }}
        onClick={() => onSelect(null)}
      >
        <span className="bw-twist hidden">▸</span>
        <span className="bw-node-name">全部</span>
        <span className="bw-node-count">{total}</span>
      </div>
      {tree.map((n) => (
        <Node key={n.path} node={n} depth={0} selected={selected} onSelect={onSelect} />
      ))}
      {tree.length === 0 && <p className="bw-empty">还没有采集过笔记</p>}
    </nav>
  );
}
