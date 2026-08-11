import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readArticleNote, writeArticleNote } from '../core/article-note';
import type { Store } from '../core/store';

interface Entry {
  path: string | null;
  saved: string;
  value: string;
  loading: boolean;
  saving: boolean;
  loaded: boolean;
  error: string | null;
  notice: string | null;
}

const emptyEntry = (path: string | null): Entry => ({
  path, saved: '', value: '', loading: path !== null,
  saving: false, loaded: path === null, error: null, notice: null,
});

export interface ArticleNoteController extends Entry {
  dirty: boolean;
  archiveValue: string | undefined;
  setValue(value: string): void;
  cancel(): void;
  save(): Promise<boolean>;
  markArchived(path: string): void;
  reload(): void;
}

export function useArticleNote(
  store: Store | null,
  noteId: string | null,
  existingPath: string | null,
): ArticleNoteController {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [reloadToken, setReloadToken] = useState(0);
  const handledReload = useRef(0);
  const key = noteId ?? '';
  const current = entries[key] ?? emptyEntry(existingPath);

  useEffect(() => {
    if (!noteId) return;
    const hit = entries[noteId];
    const forced = reloadToken !== handledReload.current;
    if (forced) handledReload.current = reloadToken;
    if (existingPath === null) {
      if (!hit) setEntries((all) => ({ ...all, [noteId]: emptyEntry(null) }));
      return;
    }
    if (hit?.loaded && hit.path === existingPath && !forced) return;
    let alive = true;
    setEntries((all) => ({ ...all, [noteId]: emptyEntry(existingPath) }));
    if (!store) return () => { alive = false; };
    void readArticleNote(store, existingPath).then(
      (text) => {
        if (!alive) return;
        setEntries((all) => ({ ...all, [noteId]: {
          path: existingPath, saved: text, value: text,
          loading: false, saving: false, loaded: true, error: null, notice: null,
        } }));
      },
      (error) => {
        if (!alive) return;
        setEntries((all) => ({ ...all, [noteId]: {
          ...emptyEntry(existingPath), loading: false, loaded: false,
          error: `Note 读取失败：${error instanceof Error ? error.message : String(error)}`,
        } }));
      },
    );
    return () => { alive = false; };
  }, [store, noteId, existingPath, reloadToken]);

  const patch = useCallback((fn: (entry: Entry) => Entry) => {
    if (!noteId) return;
    setEntries((all) => ({ ...all, [noteId]: fn(all[noteId] ?? emptyEntry(existingPath)) }));
  }, [noteId, existingPath]);

  const setValue = useCallback((value: string) => patch((e) => ({ ...e, value, error: null, notice: null })), [patch]);
  const cancel = useCallback(() => patch((e) => ({ ...e, value: e.saved, error: null, notice: null })), [patch]);
  const save = useCallback(async () => {
    if (!store || !noteId || current.path === null || current.loading || !current.loaded) return false;
    patch((e) => ({ ...e, saving: true, error: null, notice: null }));
    try {
      await writeArticleNote(store, current.path, current.value);
      patch((e) => ({ ...e, saved: e.value, saving: false, error: null, notice: 'Note 已保存' }));
      return true;
    } catch (error) {
      patch((e) => ({ ...e, saving: false, error: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }, [store, noteId, current.path, current.value, current.loading, current.loaded, patch]);
  const markArchived = useCallback((path: string) => patch((e) => ({
    ...e, path, saved: e.value, loading: false, saving: false, loaded: true, error: null, notice: null,
  })), [patch]);
  const reload = useCallback(() => {
    if (current.path !== null) setReloadToken((n) => n + 1);
  }, [current.path]);

  return useMemo(() => ({
    ...current,
    dirty: current.value !== current.saved,
    archiveValue: current.path === null || current.value !== current.saved ? current.value : undefined,
    setValue, cancel, save, markArchived, reload,
  }), [current, setValue, cancel, save, markArchived, reload]);
}
