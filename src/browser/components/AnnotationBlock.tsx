import { useCallback, useEffect, useState } from 'react';
import { readArticleNote, writeArticleNote } from '../../core/article-note';
import { noteKeyOf } from '../../core/browse/scope';
import type { NoteRef } from '../../core/browse/types';
import type { Store } from '../../core/store';

export function AnnotationBlock({
  store, noteRef, disabled, onSavingChange,
}: {
  store: Store;
  noteRef: NoteRef;
  disabled: boolean;
  onSavingChange(saving: boolean): void;
}) {
  const [saved, setSaved] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const key = noteKeyOf(noteRef);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setEditing(false);
    setLoadError(null);
    setSaveError(null);
    setNotice(null);
    void readArticleNote(store, key).then(
      (text) => {
        if (!alive) return;
        setSaved(text); setDraft(text); setLoading(false);
      },
      (reason) => {
        if (!alive) return;
        setLoadError(`Note 读取失败：${reason instanceof Error ? reason.message : String(reason)}`);
        setLoading(false);
      },
    );
    return () => { alive = false; };
  }, [store, key, retry]);

  const save = useCallback(async () => {
    setSaving(true); setSaveError(null); setNotice(null); onSavingChange(true);
    try {
      await writeArticleNote(store, key, draft);
      setSaved(draft); setEditing(false); setNotice('Note 已保存');
    } catch (reason) {
      setSaveError(`Note 保存失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setSaving(false); onSavingChange(false);
    }
  }, [store, key, draft, onSavingChange]);

  if (loading) return <section className="bw-annotation"><p className="bw-dim">正在读取 Note…</p></section>;
  if (loadError) return (
    <section className="bw-annotation">
      <p className="bw-note bad">{loadError}</p>
      <button className="bw-btn" onClick={() => setRetry((n) => n + 1)}>重试</button>
    </section>
  );
  if (editing) return (
    <section className="bw-annotation">
      <header><strong>Note</strong></header>
      <textarea aria-label="Note（可选）" value={draft} disabled={saving || disabled} onChange={(e) => setDraft(e.target.value)} />
      {saveError && <p className="bw-note bad">{saveError}</p>}
      <div className="bw-annotation-actions">
        <button className="bw-btn" disabled={saving} onClick={() => { setDraft(saved); setEditing(false); setSaveError(null); }}>取消</button>
        <button className="bw-btn primary" disabled={saving || disabled || draft === saved} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
      </div>
    </section>
  );
  return (
    <section className="bw-annotation">
      <header><strong>Note</strong></header>
      {saved ? <p className="bw-annotation-text">{saved}</p> : <p className="bw-dim">暂无 Note</p>}
      {notice && <p className="bw-dim">{notice}</p>}
      <button className="bw-btn" disabled={disabled} onClick={() => { setNotice(null); setEditing(true); }}>{saved ? '编辑' : '添加'}</button>
    </section>
  );
}
