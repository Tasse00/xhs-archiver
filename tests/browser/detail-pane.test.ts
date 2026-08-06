import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthorBlock, CommentCard } from '../../src/browser/components/DetailPane';
import type { ArchivedAuthor, CommentRecord } from '../../src/types';

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

const base: ArchivedAuthor = {
  user_id: 'u1', nickname: '小红', avatar_url: '',
  profile_url: 'https://www.xiaohongshu.com/user/profile/u1',
};

describe('AuthorBlock', () => {
  it('有卡片字段时显示简介与三个计数', () => {
    const html = renderToStaticMarkup(createElement(AuthorBlock, {
      author: {
        ...base, desc: '学术废物', follows: 6, fans: 82, interaction: 6046,
        counts_raw: { follows: '6', fans: '82', interaction: '6046' },
        approximate: false, card_fetched_at: '2026-08-06T14:32:10+08:00',
      },
      noteUrl: 'https://www.xiaohongshu.com/explore/n1',
      shareUrl: '',
    }));
    expect(html).toContain('学术废物');
    expect(html).toContain('82');
    expect(html).toContain('6,046');
  });

  // 老数据没有卡片字段，不能显示 0
  it('没有卡片字段时只显示昵称，不显示 0', () => {
    const html = renderToStaticMarkup(createElement(AuthorBlock, {
      author: base, noteUrl: 'https://www.xiaohongshu.com/explore/n1', shareUrl: '',
    }));
    expect(html).toContain('小红');
    expect(html).not.toContain('粉丝');
  });

  it('原文与主页都是新标签页打开的链接', () => {
    const html = renderToStaticMarkup(createElement(AuthorBlock, {
      author: base, noteUrl: 'https://www.xiaohongshu.com/explore/n1', shareUrl: '',
    }));
    expect(html).toContain('href="https://www.xiaohongshu.com/explore/n1"');
    expect(html).toContain('href="https://www.xiaohongshu.com/user/profile/u1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  // 不带 xsec_token 的 /explore/{id} 实测已经 404，有分享链接就该用它
  it('有分享链接时原文指向分享链接', () => {
    const share = 'https://www.xiaohongshu.com/discovery/item/n1?source=webshare&xsec_token=T';
    const html = renderToStaticMarkup(createElement(AuthorBlock, {
      author: base,
      noteUrl: 'https://www.xiaohongshu.com/explore/n1',
      shareUrl: share,
    }));
    // renderToStaticMarkup 会把属性值里的 & 转义成 &amp;，字面比较要跟着转义
    expect(html).toContain(`href="${share.replace(/&/g, '&amp;')}"`);
    expect(html).not.toContain('href="https://www.xiaohongshu.com/explore/n1"');
  });

  // 老数据没有 share_url，回退到旧地址总比没有链接强
  it('没有分享链接时回退到 url', () => {
    const html = renderToStaticMarkup(createElement(AuthorBlock, {
      author: base,
      noteUrl: 'https://www.xiaohongshu.com/explore/n1',
      shareUrl: '',
    }));
    expect(html).toContain('href="https://www.xiaohongshu.com/explore/n1"');
  });
});
