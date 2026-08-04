import { useState } from 'react';
import type { Store } from '../core/store';
import { PermissionGate } from './components/PermissionGate';

export function App() {
  const [rootName, setRootName] = useState('');

  return (
    <div className="bw">
      <PermissionGate onReady={(_store, name) => setRootName(name)}>
        <p style={{ padding: 16 }}>已连接数据仓库：{rootName}</p>
      </PermissionGate>
    </div>
  );
}
