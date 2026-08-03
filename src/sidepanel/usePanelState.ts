import type { ExtractedNote, Pointer, RawNote } from '../types';
import type { Store } from '../core/store';
import { extract } from '../core/extractor';
import { checkNote } from '../core/archiver';
import { parseNoteUrl, type PageReadResult } from '../page/read-note';

export type PanelState =
  | { kind: 'need_root' }
  | { kind: 'need_collector' }
  | { kind: 'not_xhs' }
  | { kind: 'not_note' }
  | { kind: 'unreadable'; reason: 'no_state' | 'no_note' }
  | { kind: 'video_rejected' }
  | { kind: 'blocked_by_other'; pointers: Pointer[] }
  | { kind: 'mine'; note: ExtractedNote; pointer: Pointer; duplicates: Pointer[] }
  | { kind: 'ready'; note: ExtractedNote };

export interface ResolveInput {
  hasRoot: boolean;
  store: Store;
  collector: string | null;
  tabUrl: string;
  readNote(): Promise<PageReadResult>;
}

/** 顺序即优先级，与设计文档第 8 节的状态机一致。 */
export async function resolvePanelState(input: ResolveInput): Promise<PanelState> {
  if (!input.hasRoot) return { kind: 'need_root' };
  if (!input.collector) return { kind: 'need_collector' };

  if (!/^https:\/\/(?:www\.)?xiaohongshu\.com\//.test(input.tabUrl)) return { kind: 'not_xhs' };
  if (parseNoteUrl(input.tabUrl) === null) return { kind: 'not_note' };

  const read = await input.readNote();
  if (!read.ok) return { kind: 'unreadable', reason: read.reason };

  const ext = extract(read.raw as RawNote);
  if (!ext.ok) {
    return ext.reason === 'unsupported_video'
      ? { kind: 'video_rejected' }
      : { kind: 'unreadable', reason: 'no_note' };
  }

  const check = await checkNote(input.store, ext.note.noteId, input.collector);
  if (check.state === 'others') return { kind: 'blocked_by_other', pointers: check.pointers };
  if (check.state === 'mine') {
    return { kind: 'mine', note: ext.note, pointer: check.pointer, duplicates: check.duplicates };
  }
  return { kind: 'ready', note: ext.note };
}
