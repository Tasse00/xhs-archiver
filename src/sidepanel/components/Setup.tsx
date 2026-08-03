import { useState } from 'react';
import { isValidSegment, randomCollectorId } from '../../core/settings';

export function RootSetup({ onPick }: { onPick(): void }) {
  return (
    <section>
      <h2>选择数据仓库目录</h2>
      <p>请选择采集数据要存放的根目录。它应当是一个独立的 Git 仓库，与插件代码分开。</p>
      <button onClick={onPick}>选择目录…</button>
    </section>
  );
}

export function CollectorSetup({ onSave }: { onSave(id: string): void }) {
  const [value, setValue] = useState(randomCollectorId());
  const valid = isValidSegment(value);
  return (
    <section>
      <h2>设置采集者 ID</h2>
      <p>它会成为目录名，建议改成方便辨认的名字。只能用小写字母、数字、连字符和下划线。</p>
      <input value={value} onChange={(e) => setValue(e.target.value)} />
      {!valid && <p style={{ color: 'crimson' }}>只能包含 a-z、0-9、-、_，且不超过 32 字符</p>}
      <button disabled={!valid} onClick={() => onSave(value)}>保存</button>
    </section>
  );
}
