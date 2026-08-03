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

export interface Pointer {
  note_id: string;
  path: string;
  collector: string;
  title: string;
  first_archived_at: string;
  last_archived_at: string;
}
