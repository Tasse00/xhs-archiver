import { useState } from 'react';
import { deleteNote, planDelete, type DeletePlan } from '../../core/delete';
import { isPermissionError } from '../../core/handle-store';
import { noteKeyOf } from '../../core/browse/scope';
import type { NoteRef } from '../../core/browse/types';
import type { Store } from '../../core/store';

type Phase =
  | { kind: 'idle' }
  | { kind: 'planning' }
  | { kind: 'confirm'; plan: DeletePlan }
  | { kind: 'deleting'; plan: DeletePlan }
  | { kind: 'error'; text: string };

/**
 * 删除入口 + 悬浮确认面板。
 *
 * 入口按钮摆在详情栏顶部（关闭按钮左侧），常驻可见——原先挂在详情栏底部，
 * 评论一多就要滚到底才看得见。确认面板不占正文流：用 position: absolute
 * 浮在按钮下方，展开、收起都不会推挤评论区的内容。
 *
 * 不用 modal：浏览页已经有两处抢 Escape（App 关详情栏、Lightbox 关看图器），
 * 再塞一个就是三方打架，得引入一套焦点与优先级管理，为一个确认框不值。
 * 也不用 window.confirm——它显示不了清单，而清单正是这个确认框存在的理由。
 */
export function DeleteBlock({
  store, noteRef, disabled = false, onBusyChange = () => undefined, onDeleted,
}: {
  store: Store;
  noteRef: NoteRef;
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
  onDeleted(): void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function open() {
    setPhase({ kind: 'planning' });
    try {
      // 传 here：当前这份目录可能根本没有指针（孤儿副本），光查指针找不到它
      setPhase({ kind: 'confirm', plan: await planDelete(store, noteRef.noteId, noteKeyOf(noteRef)) });
    } catch (e) {
      setPhase({ kind: 'error', text: `读取索引失败：${message(e)}` });
    }
  }

  async function confirm(plan: DeletePlan) {
    setPhase({ kind: 'deleting', plan });
    onBusyChange(true);
    try {
      await deleteNote(store, plan);
    } catch (e) {
      // 权限在扩展 origin 的最后一个标签页关闭时会被回收。浏览页手里没有句柄，
      // 恢复不了，只能让人重来一遍权限门。
      if (isPermissionError(e)) {
        setPhase({ kind: 'error', text: '授权已失效。请重新加载本页并重新授权后再试。' });
        return;
      }
      // 顺序保证了残留只会是孤儿目录，所以这句话永远成立
      setPhase({ kind: 'error', text: `删除失败：${message(e)}。索引指针可能已删除，数据目录可能有残留。` });
      return;
    } finally {
      onBusyChange(false);
    }
    setPhase({ kind: 'idle' });
    onDeleted();
  }

  const busy = phase.kind === 'deleting';

  return (
    <div className="bw-del-inline">
      <button
        className="bw-btn danger"
        disabled={phase.kind === 'planning' || busy || disabled}
        onClick={() => void open()}
      >
        删除这篇
      </button>

      {phase.kind === 'error' && (
        <div className="bw-del-panel">
          <p className="bw-note bad">{phase.text}</p>
          <button className="bw-btn" onClick={() => setPhase({ kind: 'idle' })}>知道了</button>
        </div>
      )}

      {(phase.kind === 'confirm' || phase.kind === 'deleting') && (
        <div className="bw-del-panel">
          <p className="bw-del-h">删除后不可撤销，恢复只能靠 git</p>
          <div className="bw-del-list">
            {phase.plan.dirs.length === 0 ? (
              <p className="bw-dim">没有数据目录，只清理索引指针</p>
            ) : (
              phase.plan.dirs.map((d) => <p key={d}>{d}/</p>)
            )}
            {phase.plan.pointers.length > 0 && (
              <p className="bw-dim">索引指针：{phase.plan.pointers.map((p) => p.collector).join('、')}</p>
            )}
          </div>
          <div className="bw-del-acts">
            <button className="bw-btn" onClick={() => setPhase({ kind: 'idle' })}>取消</button>
            <button className="bw-btn danger" disabled={busy || disabled} onClick={() => void confirm(phase.plan)}>
              {busy ? '删除中…' : '确认删除'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
