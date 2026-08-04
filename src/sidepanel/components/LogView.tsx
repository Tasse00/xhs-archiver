import type { LogEntry } from '../log';

const mono = { fontFamily: 'ui-monospace, monospace', fontSize: 11 } as const;

/**
 * 每次判定的现场快照。排查时最有价值的是 tabUrl 与 pathname 的差异
 * （不一致 = SPA 导航后 tab.url 滞后）以及 urlId / currentNoteId / 命中情况。
 */
export function LogView({ log, onRefresh }: { log: LogEntry[]; onRefresh(): void }) {
  return (
    <details style={{ marginTop: 16, borderTop: '1px solid rgba(128,128,128,0.3)', paddingTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, opacity: 0.7 }}>
        工作日志（{log.length}）
      </summary>

      <div style={{ margin: '8px 0' }}>
        <button onClick={onRefresh}>重新读取页面</button>
        <button
          style={{ marginLeft: 8 }}
          onClick={() => void navigator.clipboard.writeText(JSON.stringify(log, null, 2))}
        >
          复制全部
        </button>
      </div>

      {log.length === 0 && <p style={{ ...mono, opacity: 0.6 }}>还没有记录。</p>}

      <ol style={{ ...mono, listStyle: 'none', padding: 0, margin: 0 }}>
        {log.map((e, i) => (
          <li
            key={`${e.at}-${i}`}
            style={{
              padding: '6px 0',
              borderTop: i === 0 ? 'none' : '1px dotted rgba(128,128,128,0.3)',
            }}
          >
            <div><b>{e.at}</b> {e.outcome}</div>
            <div style={{ opacity: 0.75 }}>tab: {e.tabUrl || '—'}</div>
            <div style={{ opacity: 0.75 }}>
              页面: {e.pathname}
              {/* 两者对不上就是 tab.url 滞后，这是最常见的误判来源 */}
              {e.pathname !== '—' && !e.tabUrl.endsWith(e.pathname) && (
                <span style={{ color: 'darkorange' }}> ≠ tab</span>
              )}
            </div>
            <div style={{ opacity: 0.75 }}>
              urlId: {e.urlId} · currentNoteId: {e.currentNoteId} · map: {e.mapKeys} 条 ·{' '}
              {e.entryFound ? '命中' : '未命中'}
            </div>
            {e.error && <div style={{ color: 'crimson' }}>{e.error}</div>}
          </li>
        ))}
      </ol>
    </details>
  );
}
