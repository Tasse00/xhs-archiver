// File System Access 的权限 API 不在 TS 内置 lib 里，@types/chrome 也不提供，
// 但 handle-store / PermissionGate / App 都要用。这里只补项目实际调用的三个成员，
// 不整套引入 —— 多出来的声明没人验证，反而会让错误的用法通过编译。
//
// queryPermission/requestPermission 声明在 FileSystemHandle 上而非
// FileSystemDirectoryHandle 上：后者继承前者，声明一次两边都有。

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
  requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: FileSystemHandle | string;
  }): Promise<FileSystemDirectoryHandle>;
}
