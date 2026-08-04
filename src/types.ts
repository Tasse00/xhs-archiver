export interface RawImage {
  fileId: string;
  width: number;
  height: number;
  livePhoto?: boolean;
  url?: string;
  urlPre?: string;
  urlDefault?: string;
  stream?: Record<string, unknown>;
  infoList?: { imageScene: string; url: string }[];
}

export interface RawNote {
  noteId: string;
  type: string;
  title?: string;
  desc?: string;
  time: number;
  lastUpdateTime?: number;
  ipLocation?: string;
  xsecToken?: string;
  user: { userId: string; nickname: string; avatar: string; xsecToken?: string };
  interactInfo: {
    likedCount?: string;
    collectedCount?: string;
    commentCount?: string;
    shareCount?: string;
  };
  imageList: RawImage[];
  tagList?: { name: string; type: string }[];
  video?: unknown;
  [k: string]: unknown;
}

/** 评论图没有 fileId，拿不到原图，只有这两个派生地址。 */
export interface RawCommentPicture {
  width?: number;
  height?: number;
  urlPre?: string;
  urlDefault?: string;
  infoList?: { imageScene: string; url: string }[];
}

export interface RawComment {
  id: string;
  content?: string;
  createTime: number;
  ipLocation?: string;
  /** 与 interactInfo 同样是字符串，可能是「1.2万」。 */
  likeCount?: string;
  atUsers?: { userId: string; nickname: string }[];
  pictures?: RawCommentPicture[];
  /** 平台给的标记，如 is_author、user_top。 */
  showTags?: string[];
  subCommentCount?: string;
  subComments?: RawComment[];
  userInfo: { userId: string; nickname: string; image: string };
  [k: string]: unknown;
}

/** 页面上的 noteDetailMap[id].comments，与 note 同级。 */
export interface RawComments {
  list?: RawComment[];
  cursor?: string;
  hasMore?: boolean;
  firstRequestFinish?: boolean;
  [k: string]: unknown;
}

export interface ExtractedCommentImage {
  /** 在所属评论内的序号，从 1 起。 */
  index: number;
  declaredWidth: number;
  declaredHeight: number;
  urlDefault: string;
  urlPre: string;
}

export interface ExtractedComment {
  id: string;
  content: string;
  publishedAt: string;
  ipLocation: string;
  likedCount: number;
  author: ExtractedNote['author'];
  atUsers: { user_id: string; nickname: string }[];
  tags: string[];
  images: ExtractedCommentImage[];
  /** 页面声明这条有多少回复，未必都加载了。 */
  subCommentCount: number;
  /** 只有一层：小红书的回复不再往下嵌套。 */
  subComments?: ExtractedComment[];
}

export interface ExtractedComments {
  /** 笔记 interactInfo.commentCount，含未加载的部分。 */
  declaredTotal: number;
  /** 主评论 + 已加载子评论的条数。 */
  collectedCount: number;
  complete: boolean;
  /** 还有整页主评论没加载。 */
  hasMore: boolean;
  list: ExtractedComment[];
}

export interface ExtractedImage {
  index: number;
  fileId: string;
  declaredWidth: number;
  declaredHeight: number;
  isLive: boolean;
  urlDefault: string;
  urlPre: string;
}

export interface ExtractedNote {
  noteId: string;
  url: string;
  title: string;
  content: string;
  tags: string[];
  publishedAt: string;
  /** 作者最后一次编辑的时间；从未编辑过时与 publishedAt 相差不到一秒。 */
  lastEditedAt: string;
  author: { user_id: string; nickname: string; avatar_url: string; profile_url: string };
  interact: { liked: number; collected: number; comment: number; share: number };
  images: ExtractedImage[];
  raw: RawNote;
}

export type ExtractRejection = 'unsupported_video' | 'missing_data';

export type ExtractResult =
  | { ok: true; note: ExtractedNote }
  | { ok: false; reason: ExtractRejection };

export type SourceKind = 'original' | 'WB_DFT' | 'WB_PRV';

export interface ImageRecord {
  index: number;
  file: string;
  is_live: boolean;
  file_id: string;
  width: number;
  height: number;
  declared_width: number;
  declared_height: number;
  bytes: number;
  sha256: string;
  source_kind: SourceKind;
  source_url: string;
}

export interface NoteRecord {
  schema_version: 1;
  note_id: string;
  url: string;
  type: 'normal';
  title: string;
  content: string;
  tags: string[];
  published_at: string;
  last_edited_at: string;
  author: ExtractedNote['author'];
  interact: ExtractedNote['interact'];
  images: ImageRecord[];
  archive: {
    first_archived_at: string;
    last_archived_at: string;
    collector: string;
    archive_count: number;
    status: 'complete' | 'partial';
  };
  raw: RawNote;
}

export interface CommentImageRecord {
  index: number;
  file: string;
  width: number;
  height: number;
  declared_width: number;
  declared_height: number;
  bytes: number;
  sha256: string;
  source_kind: SourceKind;
  source_url: string;
}

export interface CommentRecord {
  id: string;
  content: string;
  published_at: string;
  ip_location: string;
  liked_count: number;
  author: ExtractedNote['author'];
  at_users: { user_id: string; nickname: string }[];
  tags: string[];
  images: CommentImageRecord[];
  /** 只有主评论有这两个字段：回复不会再有回复。 */
  sub_comment_count?: number;
  sub_comments?: CommentRecord[];
}

/** 与 note.json 同目录的 comments.json。 */
export interface CommentsFile {
  schema_version: 1;
  note_id: string;
  /** 笔记声明的评论总数，含未加载的部分。 */
  declared_total: number;
  collected_count: number;
  /** 采到的是不是全部。只取页面已加载的部分，通常为 false。 */
  complete: boolean;
  has_more: boolean;
  comments: CommentRecord[];
}

export interface Pointer {
  note_id: string;
  path: string;
  collector: string;
  title: string;
  first_archived_at: string;
  last_archived_at: string;
}
