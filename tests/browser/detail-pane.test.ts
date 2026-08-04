import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommentCard } from '../../src/browser/components/DetailPane';
import type { CommentRecord } from '../../src/types';

const comment: CommentRecord = {
  id: 'main',
  content: '主评论正文',
  published_at: '2026-08-04T10:30:00+08:00',
  ip_location: '上海',
  liked_count: 12,
  author: { user_id: 'u1', nickname: '小红', avatar_url: '', profile_url: '' },
  at_users: [],
  tags: ['is_author', 'user_top'],
  images: [{
    index: 1,
    file: 'images/comments/main-01.webp',
    width: 556,
    height: 717,
    declared_width: 284,
    declared_height: 367,
    bytes: 10,
    sha256: 'x',
    source_kind: 'WB_DFT',
    source_url: 'https://example.com/image.webp',
  }],
  sub_comment_count: 3,
  sub_comments: [{
    id: 'reply',
    content: '回复正文',
    published_at: '2026-08-04T10:35:00+08:00',
    ip_location: '北京',
    liked_count: 0,
    author: { user_id: 'u2', nickname: '小蓝', avatar_url: '', profile_url: '' },
    at_users: [],
    tags: [],
    images: [],
  }],
};

describe('CommentCard', () => {
  it('分开展示作者、正文、元信息、配图和回复采集进度', () => {
    const html = renderToStaticMarkup(createElement(CommentCard, {
      comment,
      noteRef: { noteId: 'note', datasetPath: 'collected/2026-08-04' },
      thumbUrl: () => 'blob:thumb',
      onOpenImages: () => undefined,
    }));

    expect(html).toContain('bw-comment-author');
    expect(html).toContain('主评论正文');
    expect(html).toContain('作者');
    expect(html).toContain('置顶');
    expect(html).toContain('08-04 10:30');
    expect(html).toContain('IP 上海');
    expect(html).toContain('bw-comment-image');
    expect(html).toContain('回复正文');
    expect(html).toContain('已收录 1 / 3 条回复');
  });
});
