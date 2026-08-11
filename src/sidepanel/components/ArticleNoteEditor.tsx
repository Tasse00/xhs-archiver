export interface ArticleNoteEditorProps {
  archived: boolean;
  value: string;
  saved: string;
  loading: boolean;
  saving: boolean;
  loaded: boolean;
  disabled: boolean;
  error: string | null;
  notice: string | null;
  onChange(value: string): void;
  onSave(): void;
  onCancel(): void;
}

export function ArticleNoteEditor(props: ArticleNoteEditorProps) {
  const dirty = props.value !== props.saved;
  const busy = props.loading || props.saving || props.disabled || (props.archived && !props.loaded);
  return (
    <section className="article-note">
      <div className="sect-h">Note <span>可选</span></div>
      <textarea
        aria-label="Note（可选）"
        value={props.value}
        disabled={busy}
        placeholder={props.loading ? '正在读取 Note…' : '记录对这篇文章的判断或补充信息'}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {!props.archived && <p className="hint">将在采集文章时一并保存</p>}
      {props.error && <p className="field-err">{props.error}</p>}
      {props.notice && <p className="hint">{props.notice}</p>}
      {props.archived && dirty && (
        <div className="article-note-actions">
          <button className="btn btn-sm" disabled={busy} onClick={props.onCancel}>取消</button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={props.onSave}>
            {props.saving ? '保存中…' : '保存修改'}
          </button>
        </div>
      )}
    </section>
  );
}
