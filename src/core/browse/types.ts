import type { ImageRecord, NoteRecord } from '../../types';

/** 一篇笔记在磁盘上的位置。noteId 单独不足以定位——竞态时同一篇会在多个目录。 */
export interface NoteRef {
  noteId: string;
  datasetPath: string;
}

/** `${datasetPath}/${noteId}`。所有与磁盘内容对应的缓存都用它做键。 */
export type NoteKey = string;

export interface DatasetNode {
  /** 相对 root 的路径，如 collected/2026-08-03 */
  path: string;
  /** 路径末段，显示用 */
  name: string;
  isDataset: boolean;
  /** 候选笔记目录数：只按名字形态数出来的，没读文件验证过 */
  count: number;
  /** 仅叶子有。建树时得到，选范围时直接复用，不再列第二遍目录 */
  noteIds: string[];
  /** 仅叶子有。同层里名字不像 note id 的目录，用于质量警告 */
  ignoredDirs: string[];
  children: DatasetNode[];
}

/** 列表、搜索、排序要的字段。 */
export interface RowMeta {
  noteId: string;
  datasetPath: string;
  title: string;
  content: string;
  tags: string[];
  authorNickname: string;
  /** 采集时刻的作者粉丝数。null 表示这篇没采到作者信息（老数据或当时读取失败）。 */
  authorFans: number | null;
  /** 采集时刻的作者获赞与收藏数。null 的含义同上。 */
  authorInteraction: number | null;
  liked: number;
  collected: number;
  comment: number;
  share: number;
  imageCount: number;
  /** 相对笔记目录，如 images/01.jpg。没有图片时为 null */
  coverFile: string | null;
  collector: string;
  firstArchivedAt: string;
  lastArchivedAt: string;
  archiveCount: number;
  publishedAt: string;
  lastEditedAt: string;
}

/** 详情栏要的字段。与 RowMeta 来自同一次 note.json 读取。 */
export interface NoteDetail {
  url: string;
  /** 分享面板产出的地址，带 xsec_token。老数据没有这个字段，此时为空串。 */
  shareUrl: string;
  author: NoteRecord['author'];
  /** NoteRecord 没有顶层 IP 字段，只能从 raw.ipLocation 取。取完 raw 就丢 */
  ipLocation: string;
  images: ImageRecord[];
}

export type RowState =
  | { kind: 'pending' }
  | { kind: 'ready'; meta: RowMeta }
  | { kind: 'error'; reason: string };
