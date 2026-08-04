import type { Pointer } from '../../types';
import { dirOf } from './Record';
import { isValidDatasetPath } from '../../core/settings';

export type ArchiveMode = 'new' | 'update' | 'migrate';

export function PathDisplay({
  value, onEdit, disabled = false,
}: {
  value: string;
  onEdit(): void;
  disabled?: boolean;
}) {
  return (
    <div className="path-display">
      <span className="path-label">写入路径</span>
      <span className="path-value mono" title={value}>{value}</span>
      <button className="path-edit" disabled={disabled} onClick={onEdit}>· 修改</button>
    </div>
  );
}

/**
 * 能做什么只取决于两件事：这篇有没有人采过，以及原位置是不是当前写入路径。
 *
 * 原位置就是当前路径时不存在第二种去处，只有「更新」；不同才需要使用者选留在
 * 原地还是搬过来。别人采过的走同一套动作，只多一句接管说明——接管会作废对方
 * 的指针，这件事必须在按下去之前看到。
 */
export function ArchiveActions({
  existing, datasetPath, collector, busy, onArchive,
}: {
  existing: Pointer | null;
  datasetPath: string;
  collector: string;
  busy: boolean;
  onArchive(mode: ArchiveMode): void;
}) {
  const disabled = busy || !isValidDatasetPath(datasetPath);

  if (!existing) {
    return (
      <div className="acts">
        <button className="btn btn-primary" disabled={disabled} onClick={() => onArchive('new')}>
          采集这篇
        </button>
      </div>
    );
  }

  const dir = dirOf(existing);
  const same = datasetPath.replace(/\/+$/, '') === dir;
  const takeover = existing.collector !== collector;

  return (
    <div className="acts">
      {takeover && (
        <div className="act-warn">接管后这篇归到你名下，{existing.collector} 的采集记录会被替换。</div>
      )}
      {same ? (
        <button className="btn btn-primary" disabled={disabled} onClick={() => onArchive('update')}>
          更新
        </button>
      ) : (
        <>
          <button className="btn btn-primary" disabled={disabled} onClick={() => onArchive('update')}>
            原位更新（留在 {dir}）
          </button>
          <button className="btn btn-sm" disabled={disabled} onClick={() => onArchive('migrate')}>
            迁移到当前目录并更新（删除 {dir}/）
          </button>
        </>
      )}
    </div>
  );
}
