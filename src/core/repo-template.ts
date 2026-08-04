import type { Store } from './store';

const GITATTRIBUTES = `# 图片走 LFS
**/images/** filter=lfs diff=lfs merge=lfs -text

# 索引与笔记数据禁止逐行合并：语义上只能整份取一侧。
# 没有这一行，Git 会往 json 里插入 <<<<<<< 冲突标记，使文件变成非法 JSON。
_index/**/*.json -merge
**/note.json -merge
**/comments.json -merge
`;

const GITIGNORE = `.DS_Store
Thumbs.db
`;

const README = `# 小红书笔记归档数据仓库

由「小红书笔记归档」Chrome 扩展写入。本仓库只存数据，不含插件代码。

## 目录结构

\`\`\`
<root>/
├── _index/68/68a1b2c3d4e5f6/zach.json   指针：每篇每人一个文件
└── zach/2026-08-03/68a1b2c3d4e5f6/      数据：{采集者}/{数据集}/{笔记ID}
    ├── note.json
    ├── comments.json                    读到评论时才有，见下
    └── images/
        ├── 01.jpg
        └── comments/{评论id}-01.webp    评论配图
\`\`\`

指针文件的存在即代表数据完整——写盘顺序保证了「先有完整数据，才有指针」。
注意这个保证**不覆盖评论**：见下一节。

## 评论数据不是全量的

\`comments.json\` 里的评论是**采集当时页面上已经加载出来的那部分**，不是这篇笔记的全部评论。
小红书首屏只给 10 条主评论，每条有回复的只预载 1 条回复；采集者往下翻过几屏就会多一些。

因此每次分析前都要看这三个字段：

| 字段 | 含义 |
|---|---|
| \`declared_total\` | 笔记声明的评论总数（含未加载的），即页面上「共 N 条评论」 |
| \`collected_count\` | 本次实际采到的条数 = 主评论 + 已加载的回复 |
| \`complete\` | 两者是否相等。**通常是 \`false\`** |

\`complete: false\` 不是采集失败，是这个工具的既定边界（它不会去滚动页面或模拟点击）。
要更全的评论只能重新打开笔记、手动往下翻，再采一次。

评论配图取不到时会**整条从 \`images\` 数组里省略**，所以 \`images\` 里出现的每一项都对应一个真实存在的文件。

## 合并行为

| 场景 | 结果 |
|---|---|
| 不同人采不同笔记 | 自动合并 |
| 不同人同时采同一篇 | 自动合并，但仓库中该篇存在两份，需按下文清理 |
| 同一人在两台机器上采同一篇 | \`{采集者}.json\` 冲突 |
| 同一人在两台机器上重采同一篇 | \`note.json\` 冲突 |

## 处理 json 冲突

整份取一侧，不要手工编辑合并。

\`\`\`bash
# 比较两侧采集时间
git show :2:<path>/note.json | grep last_archived_at   # ours
git show :3:<path>/note.json | grep last_archived_at   # theirs

# 取较新的一侧
git checkout --theirs <path>/note.json
git add <path>/note.json
\`\`\`

若两侧指针的 \`path\` 不同，选定后须删除另一个数据目录，否则会留下无指针指向的孤儿目录。

LFS pointer 冲突同样 \`git checkout --theirs <图片路径>\`，随后 \`git lfs pull\`。

## 清理重复采集

\`\`\`bash
find _index -mindepth 2 -maxdepth 2 -type d \\
  -exec sh -c '[ $(ls -1 "$1" | wc -l) -gt 1 ] && echo "$1"' _ {} \\;
\`\`\`

保留 \`first_archived_at\` 较早的一份，删除另一份的**数据目录与指针文件**两处。

## 解除「他人已采集」的阻止

插件在发现某篇已被他人采集时会阻止重复采集。若对方数据确实有问题，
删除对应的指针文件即可解除：

\`\`\`bash
rm _index/68/68a1b2c3d4e5f6/alice.json
\`\`\`

## 重新获取原图

\`note.json\` 中每张图都记录了 \`file_id\`。原图地址不需要任何 token：

\`\`\`
https://sns-img-qc.xhscdn.com/{file_id}
\`\`\`

\`source_kind\` 不是 \`original\` 的图片即为降级保存（多因原图为 HEIC），
可凭 \`file_id\` 批量重取。
`;

const FILES: Record<string, string> = {
  '.gitattributes': GITATTRIBUTES,
  '.gitignore': GITIGNORE,
  'README.md': README,
};

/** 只创建缺失的文件，绝不覆盖已有内容。返回本次实际创建的文件名。 */
export async function ensureRepoTemplates(store: Store): Promise<string[]> {
  const created: string[] = [];
  for (const [name, content] of Object.entries(FILES)) {
    if (await store.exists(name)) continue;
    await store.writeFile(name, content);
    created.push(name);
  }
  return created;
}
