export interface DirEntry {
  name: string;
  kind: 'file' | 'directory';
}

/**
 * 只读的存储视图。浏览页的所有模块都只认这个类型——
 * `queryPermission({mode:'read'})` 并不会把句柄降权，「只读」只能靠
 * 模块边界保证：类型里没有写方法，写操作就写不出来。
 */
export interface ReadStore {
  readText(path: string): Promise<string | null>;
  readFile(path: string): Promise<File | null>;
  exists(path: string): Promise<boolean>;
  listEntries(path: string): Promise<DirEntry[]>;
}
