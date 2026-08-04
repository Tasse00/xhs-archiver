export interface ScanState {
  running: boolean;
  done: number;
  total: number;
  /** 上一次扫描的失败清单，扫完才有 */
  failures: { path: string; reason: string }[];
}

export function TopBar({
  rootName, crumb, count, query, onQuery, collector, collectors, onCollector,
  showCommentCol, onShowCommentCol, detailOpen, onDetailOpen, onReload,
  buildProgress, scan, onCancelScan,
}: {
  rootName: string;
  crumb: string;
  count: number;
  query: string;
  onQuery(q: string): void;
  collector: string | null;
  collectors: string[];
  onCollector(c: string | null): void;
  showCommentCol: boolean;
  onShowCommentCol(v: boolean): void;
  detailOpen: boolean;
  onDetailOpen(v: boolean): void;
  onReload(): void;
  buildProgress: string | null;
  scan: ScanState;
  onCancelScan(): void;
}) {
  return (
    <header className="bw-top">
      <span className="bw-brand"><span className="dot" />数据集浏览</span>
      <span className="bw-root">{rootName}</span>
      <span className="bw-crumb">{crumb} · {count} 篇</span>

      <input
        className="bw-search"
        placeholder="搜索标题、正文、作者、标签"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />

      <select
        className="bw-btn"
        value={collector ?? ''}
        onChange={(e) => onCollector(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">采集者：全部</option>
        {collectors.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      <label className="bw-check">
        <input type="checkbox" checked={showCommentCol} onChange={(e) => onShowCommentCol(e.target.checked)} />
        已采评论列
      </label>

      <button className="bw-btn" onClick={() => onDetailOpen(!detailOpen)}>
        {detailOpen ? '关闭详情' : '打开详情'}
      </button>

      <span className="bw-spacer" />

      {buildProgress && <span className="bw-progress">正在读取目录 · {buildProgress}</span>}
      {scan.running && (
        <span className="bw-progress">
          正在读取 {scan.done} / {scan.total}
          <button className="bw-btn" onClick={onCancelScan}>取消</button>
        </span>
      )}
      {!scan.running && scan.failures.length > 0 && (
        <span className="bw-progress" title={scan.failures.map((f) => `${f.path}：${f.reason}`).join('\n')}>
          {scan.failures.length} 篇读取失败
        </span>
      )}

      <button className="bw-btn" onClick={onReload}>重新加载</button>
    </header>
  );
}
