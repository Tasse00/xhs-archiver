import { useState } from 'react';
import type { LogEntry } from '../log';
import { IconCaret } from './Icons';

/**
 * 每次判定的现场快照。排查时最有价值的是 tabUrl 与 pathname 的差异
 * （不一致 = SPA 导航后 tab.url 滞后）以及 urlId / currentNoteId / 命中情况。
 */
export function LogView({ log, onRefresh }: { log: LogEntry[]; onRefresh(): void }) {
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <details className="pt-log">
      <summary>
        <IconCaret />工作日志
        <span className="push">{log.length} 条</span>
      </summary>

      <div className="log-body">
        <div className="log-tools">
          <button className="btn btn-sm" onClick={onRefresh}>重新读取页面</button>
          <button className="btn btn-sm" onClick={() => void copyAll()}>
            {copied ? '已复制' : '复制全部'}
          </button>
        </div>

        {/* 只在笔记页上记录，见 shouldLog */}
        {log.length === 0 && <p className="hint">还没有记录。只记录笔记页上的判定。</p>}

        {log.map((e, i) => (
          <div className="log-e" key={`${e.at}-${i}`}>
            <div className="l1">
              <time>{e.at}</time>
              <span className="oc">{e.outcome}</span>
              {/* 重复触发与重读次数压在这里，避免它们各自占一条 */}
              {e.repeats > 1 && <span className="rep">×{e.repeats}</span>}
              {e.attempts > 0 && <span className="rep">重读 {e.attempts}</span>}
            </div>
            <dl>
              <dt>页面</dt>
              <dd>
                {e.pathname}
                {/* 两者对不上就是 tab.url 滞后，这是最常见的误判来源 */}
                {e.pathname !== '—' && !e.tabUrl.endsWith(e.pathname) && (
                  <span className="flag"> ≠ tab</span>
                )}
              </dd>
              <dt>tab</dt><dd>{e.tabUrl || '—'}</dd>
              <dt>id</dt><dd>url {e.urlId} · cur {e.currentNoteId}</dd>
              <dt>map</dt>
              <dd>{e.mapKeys} 条 · {e.entryFound ? '命中' : '未命中'} · 评论 {e.comments}</dd>
              {e.error && <><dt>错误</dt><dd className="err">{e.error}</dd></>}
            </dl>
          </div>
        ))}
      </div>
    </details>
  );
}
