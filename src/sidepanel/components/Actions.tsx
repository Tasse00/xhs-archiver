import type { Pointer } from '../../types';
import type { DeletePlan } from '../../core/delete';
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

/**
 * 删除入口。确认块内联展开而不是弹 modal——侧边栏窄，modal 在这里不好使；
 * 而 window.confirm 显示不了清单，清单恰恰是这个确认框存在的理由：删除按
 * note_id 清全部痕迹，可能连带删掉别处那一份，这件事必须在按下去之前看见。
 *
 * 计划由上层现算（要读盘），所以 plan 为 null 就表示还没打开。
 */
export function DeleteAction({
  plan, busy, onOpen, onCancel, onConfirm,
}: {
  plan: DeletePlan | null;
  busy: boolean;
  onOpen(): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  // 用 !plan 而不是 plan === null：vitest 不做类型检查，既有测试渲染 NoteView
  // 时漏传这个 prop 就会传进 undefined，严格比 null 会让它一头撞进下面的 plan.dirs
  if (!plan) {
    return (
      <button className="btn btn-sm btn-danger" disabled={busy} onClick={onOpen}>
        删除这篇
      </button>
    );
  }

  return (
    <div className="del-confirm">
      <div className="del-h">删除后不可撤销，恢复只能靠 git</div>
      <div className="del-list">
        {plan.dirs.length === 0 ? (
          <p className="hint">没有数据目录，只清理索引指针</p>
        ) : (
          plan.dirs.map((d) => <p className="mono" key={d}>{d}/</p>)
        )}
        {plan.pointers.length > 0 && (
          <p className="hint">索引指针：{plan.pointers.map((p) => p.collector).join('、')}</p>
        )}
      </div>
      <div className="del-acts">
        <button className="btn btn-sm" onClick={onCancel}>取消</button>
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={onConfirm}>确认删除</button>
      </div>
    </div>
  );
}
