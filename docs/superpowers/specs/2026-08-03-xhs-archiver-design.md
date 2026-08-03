# 小红书笔记归档插件 — 设计文档

日期：2026-08-03

## 1. 目标

一个 Chrome 扩展（MV3，Side Panel 形式）。用户在浏览一篇小红书图文笔记时，点击侧边栏按钮，即把该笔记的正文、标题、话题标签、互动数据、作者信息与全部图片原图，结构化归档到本地文件系统的指定目录。

多名采集者共用一个 Git 仓库作为数据仓库，需要支持跨人去重与无冲突合并。

## 2. 范围

### 做

- 单篇图文笔记的完整归档
- 采集前的全局去重检查，并显示上次采集时间与采集者
- 视频笔记识别并拒绝采集，给出明确提示
- 采集者身份与写入路径的配置与引导
- 部分失败的重试

### 不做

- 视频笔记的采集
- 评论区采集
- 作者主页扩展信息（粉丝数等）采集
- 批量／自动化采集（本插件为「看到一篇、采一篇」的手动工具）
- 由插件执行任何 git 命令（commit/push 由使用者自行完成）

## 3. 关键约束

### 3.1 数据仓库独立于插件代码仓库

插件代码是一个 Git 仓库；采集数据是**另一个**独立的 Git 仓库。两者永不相交。插件通过 File System Access API 由用户手动选定数据仓库根目录（下称 `<root>`）。

数据仓库托管于**自建 Git 服务**（Gitea/GitLab 自托管或内网 NAS 裸仓库），因此 LFS 无额度限制。这是必要的：改存原图后每篇约 4.2 MB，1000 篇约 4.2 GB，远超 GitHub LFS 免费额度（1 GB）。插件本身不感知托管方式。

### 3.2 文件系统访问

采用 File System Access API（`showDirectoryPicker`）。目录句柄持久化在 IndexedDB，打开面板时自动恢复；权限失效时侧边栏显示「重新授权」按钮，由用户手势触发 `requestPermission()`。顶部常驻显示当前 `<root>` 路径，旁边提供「切换」入口。

选择 FSA 而非 `chrome.downloads` 的决定性理由：只有 FSA 能**读回目录内容**，这是「速查某篇是否已采集」的前提。

### 3.3 执行位置

Side Panel 是协调者兼执行者：持有目录句柄、发起图片 fetch、写盘、渲染进度。Service Worker 仅保留一个职责——响应扩展图标点击以打开侧边栏。

理由：

- MV3 的 Service Worker 空闲 30 秒即被终止，一篇 8 张图的下载可能中途被打断，需额外做 keepalive
- FSA 权限恢复需要用户手势，Service Worker 中没有 UI 可供点击
- Side Panel 只要开着就持续存活，天然适合长任务

页面侧另有一个常驻的轻量**数据桥接脚本**，仅负责捕获与短期缓存，不下载图片、不接触文件系统。详见 3.5。

### 3.5 数据桥接脚本

**这是被探针验证推翻原方案后的必需设计**（验证报告见 `2026-08-03-xhs-archiver-assumption-validation.md`）。

实测：页面 hydration 完成后 `window.__INITIAL_STATE__ === undefined`，应用会删除该全局变量。因此原设计中「用户点击采集时才 `chrome.scripting.executeScript({world:'MAIN'})` 去读全局变量」的做法**不成立**——执行时机远晚于 hydration。同理，modal 场景下等用户点击才拦截 `/api/sn/web/v1/feed`，请求早已完成，响应体无法回读。

改为在 `document_start` 常驻捕获：

```
MAIN world 脚本（run_at: document_start）
  ├── Object.defineProperty 劫持 __INITIAL_STATE__ 的赋值，存闭包副本
  │   （页面此后 delete 该属性不影响副本）
  ├── patch fetch / XMLHttpRequest，按 noteId 缓存目标接口响应
  └── window.postMessage 向外传递
        ↓  接收方校验 event.source === window 且 nonce 匹配
ISOLATED world 脚本
  └── chrome.runtime.sendMessage
        ↓
Side Panel（用户点击采集时按 noteId 索取）
```

三段链路是必需的：**MAIN world 中没有 `chrome.runtime`**，无法直接与扩展通信；而 ISOLATED world 又读不到页面的全局变量。`window.postMessage` 对页面脚本可见，故须校验来源与 nonce——数据本就来自页面，此举防的是误收而非窃密。

桥接脚本不改变 3.3 的结论：图片下载、文件系统权限与写盘仍全部由 Side Panel 执行。

### 3.4 目录名字符集

采集者 ID 与自定义数据集路径**强制限定为 `[a-z0-9_-]`**。原因：macOS 使用 NFD 编码保存中文文件名，进入 Git 后在其他平台会显示为乱码或被识别为不同路径。

## 4. 目录结构

```
<root>/
├── .gitattributes                    ← 插件初始化时生成，LFS 追踪 **/images/**
├── .gitignore
├── README.md                         ← 说明目录约定与 note.json schema
├── _index/
│   └── 68/68a1b2c3d4e5f6/
│       └── zach.json                 ← 每个采集者一个文件，见 4.2
└── zach/                             ← 采集者
    └── 2026-08-03/                   ← 数据集，可自定义
        └── 68a1b2c3d4e5f6/           ← 笔记 ID
            ├── note.json
            └── images/
                ├── 01.jpg            ← 扩展名由响应 Content-Type 定，原图多为 JPEG
                └── 02.jpg
```

### 4.1 数据集路径

笔记写入路径为 `<root>/<dataset_path>/<note_id>/`。`dataset_path` 默认为 `{采集者ID}/{YYYY-MM-DD}`，在侧边栏顶部可就地编辑（例如改为 `zach/2026-08-03-outfit`），采集后记住上次使用的值作为下次默认。

### 4.2 索引：分桶指针目录

```
_index/68/68a1b2c3d4e5f6/
└── zach.json
```

即 `_index/{note_id 前两位}/{note_id}/{采集者ID}.json`，内容：

```json
{
  "note_id": "68a1b2c3d4e5f6",
  "path": "zach/2026-08-03/68a1b2c3d4e5f6",
  "collector": "zach",
  "title": "…",
  "first_archived_at": "2026-08-03T14:02:11+08:00",
  "last_archived_at": "2026-08-03T14:02:11+08:00"
}
```

设计理由：

1. **写入者唯一，因而永不冲突。** 每个指针文件只由一个采集者写入，在 Git 中永远是纯新增，自动合并。
2. **查重快。** 列一个通常只含一个文件的小目录即可判定，无需加载全量索引。
3. **无需本地缓存层。** 磁盘即唯一真相源，不存在缓存与磁盘对账的一整类 bug；`git pull` 后立刻能查到同事采过什么。
4. **是并发采集竞态的安全网。** 见 6.4。

前两位分桶（笔记 ID 为 hex，分布均匀，256 桶）是为避免单目录堆积数万条目拖慢文件管理器。

统计、导出等需要全量视图的低频操作，通过遍历 `_index/**` 现场聚合，结果永远最新。

#### 为什么不用单一 index.json

多人向同一个文件追加记录，在 Git 中必然产生 merge conflict，在同步盘中必然产生冲突副本。这是「让多个写入者争抢同一文件」的必然结果，只能靠数据模型消除，不能靠合并策略挽救。

## 5. note.json 契约

字段顺序固定、2 空格缩进、末尾保留换行符。这是硬要求——数据仓库在 Git 中，键顺序不稳定会让每次重采的 diff 充满噪音。

```jsonc
{
  "schema_version": 1,
  "note_id": "68a1b2c3d4e5f6",
  "url": "https://www.xiaohongshu.com/explore/68a1b2c3d4e5f6",
  "type": "normal",
  "title": "…",
  "content": "…",
  "tags": ["穿搭", "秋冬"],
  "published_at": "2026-07-28T10:22:00+08:00",
  "author": {
    "user_id": "5f8a…",
    "nickname": "…",
    "avatar_url": "…",
    "profile_url": "https://www.xiaohongshu.com/user/profile/5f8a…"
  },
  "interact": { "liked": 1024, "collected": 300, "comment": 56, "share": 12 },
  "images": [
    {
      "index": 1,
      "file": "images/01.jpg",
      "is_live": false,
      "file_id": "notes_pre_post/…",
      "width": 1780,
      "height": 2728,
      "declared_width": 1780,
      "declared_height": 2728,
      "bytes": 338595,
      "sha256": "…",
      "source_kind": "original",
      "source_url": "https://sns-img-qc.xhscdn.com/notes_pre_post/…"
    }
  ],
  "archive": {
    "first_archived_at": "2026-08-03T14:02:11+08:00",
    "last_archived_at": "2026-08-03T14:02:11+08:00",
    "collector": "zach",
    "archive_count": 1,
    "status": "complete"
  },
  "raw": { }
}
```

### 5.1 不存储 xsec_token

理由：xsec_token 具有时效性，落盘后数日内即失效，成为死数据，且会让每次重采的 diff 变脏。

已知代价：小红书目前对不带 token 的 `/explore/{id}` 链接返回「当前笔记暂时无法浏览」。因此 `url` 字段落盘后应被理解为**标识符而非可点击链接**。配套措施：

- `note.json` 保留 `note_id` 与 `author.profile_url`（作者主页链接长期有效），供日后人工回访
- 采集完成后，侧边栏提供「复制原帖链接（含临时 token）」按钮，仅存于内存，不落盘

### 5.2 保留 raw 字段

`raw` 存放来源对象中与本笔记相关的原始片段，使 `note.json` 体积增至约 20–50 KB。

理由：小红书的数据结构随时可能变化。当归一化逻辑被发现有误时，有原始数据即可离线重跑修复，无需重新爬取。Git 中为纯文本，压缩率高。

### 5.3 图片

采集时即下载到该笔记目录下。

**探针推翻了「从 `infoList` 选最高质量」的原方案。** 实测 `infoList` 只含 `WB_PRV` 与 `WB_DFT` 两种 scene，两者像素尺寸完全相同（样本中均为 1080×1655，仅压缩率不同），**都不是原图**。原图须由 `image.fileId` 构造地址取得：

| 来源 | 尺寸 | 大小 | Content-Type |
|---|---|---:|---|
| `WB_PRV` | 1080 × 1655 | 23 KB | `image/webp` |
| `WB_DFT` | 1080 × 1655 | 73 KB | `image/webp` |
| **`sns-img-qc.xhscdn.com/{fileId}`** | **1780 × 2728** | **339 KB** | `image/jpeg` |

获取顺序：

1. 由 `fileId` 构造原图 URL 并下载
2. 校验 HTTP 状态与 `Content-Type`
3. 解码并比对实际尺寸与 `image.width` / `image.height`
4. 一致则接受，`source_kind: "original"`
5. 失败或尺寸异常则回退 `WB_DFT`，再回退 `WB_PRV`，`source_kind` 记录实际来源

其他规则：

- 编号与 `imageList` 顺序严格一致，从 `01` 起，两位补零
- 扩展名由响应的 `Content-Type` 决定——**不可假定为 WebP，原图多为 JPEG**
- `file` 记录实际文件名，保证 json 与磁盘一一对应
- `source_kind` 使日后可审计哪些图发生过降级，便于批量重取
- 原图 host 及其区域后缀可能变化，构造逻辑与候选 host 集中封装于一处

实况图（Live Photo）只保存静态帧，不视为视频笔记。判定采用 `image.livePhoto === true`，字段缺失时按 `false` 处理，**任何情况下都不阻断采集**——判错的唯一后果是 `is_live` 标记不准，不影响归档正确性。取得真实样本后再校准。

## 6. 采集流程

```
[桥接脚本]                      [Side Panel]                      [磁盘]
     │
     │ ① 页面加载时即捕获初始状态 / feed 响应，按 noteId 缓存
     │
     │ ② 用户点击采集，Side Panel 按 noteId 索取
     │←─────────────────────────────│
     │ ③ 返回原始 note 对象
     │─────────────────────────────→│
                                    │ ④ 归一化 → NoteRecord
                                    │ ⑤ 查 _index ────────────────→ 已采过？谁采的？
                                    │ ⑥ 按 fileId 取原图，全部下载到内存
                                    │ ⑦ 写盘 ──────────────────────→ note.json + images/
                                    │ ⑧ 写指针 ────────────────────→ _index/xx/{id}/{采集者}.json
```

数据来源优先级（③ 未命中时逐级降级）：

**独立页**：预先捕获的初始状态 → 解析 DOM 中残留的内嵌状态脚本 → DOM 解析

**modal**：预先拦截缓存的 feed 响应 → DOM 解析

关于内嵌状态脚本兜底：实测该脚本文本含 24 处 JavaScript `undefined` 字面量，不能直接 `JSON.parse`。处理方式是先做 `replace(/:\s*undefined\b/g, ':null')` 再解析，失败即降级到 DOM。**不使用 `eval` / `new Function` 执行页面提供的字符串。** 不为此实现 JS 子集解析器——这是兜底的兜底，成本应与其地位相称。

### 6.1 原子性

保证 **指针存在 ⟹ 数据完整**，使查重永不产生假阳性。

1. 全部图片先 fetch 到内存（一篇 6–10 张，数 MB，可接受）
2. 全部成功后才开始写盘，最后写 `_index` 指针
3. 任一图片失败则重试 2 次；仍失败则整篇标记 `status: "partial"`，**不写指针文件**，目录保留供人工检查，侧边栏提供重试按钮

`partial` 的目录因无指针而不被查重发现，这是有意为之：它在语义上等同于「未采集」。重试按钮仅在当次面板会话内有效；若已关闭面板，重新采集该笔记会直接覆盖这个残缺目录，结果正确。代价是残缺目录若一直无人重采，会滞留在磁盘上——由使用者在 `git status` 中发现并处理。

### 6.2 重复采集（命中自己的记录）

查重命中且指针的 `collector` 是当前采集者时，侧边栏显示该笔记的已有路径、首次采集时间、上次采集时间，并提供两个选项：

- **更新原位置**：写回 `_index` 指向的原目录
- **迁移到当前数据集**：写入当前 `dataset_path`，随后删除原位置

两者均保留 `first_archived_at`，更新 `last_archived_at`，`archive_count` 递增。

迁移的执行顺序保证任何中断都不丢数据：

**写新位置 → 校验完整 → 更新指针 → 删除旧目录 → 清理因此变空的日期目录**

最坏情况（中断）是留下一个孤儿目录，绝不会出现「旧的已删、新的未写成」。删除前 UI 明确显示将被删除的完整路径并要求二次确认；清理只针对空的日期目录，不删采集者目录。

### 6.3 重复采集（命中他人的记录）

查重命中且指针的 `collector` 不是当前采集者时，**阻止采集**。侧边栏只显示对方的采集者 ID、采集时间与路径，不提供采集按钮。数据仓库中每篇笔记因此全局唯一一份。

不在 UI 中提供「强行接管」的逃生口。当对方的数据确实有问题（图片残缺、人员离职）时，绕过方式是手动删除 `_index/{bucket}/{note_id}/{对方}.json` 这一个文件，阻止即解除。该操作足够麻烦以致不会误触，又足够简单以致不会卡死流程。此指引写入 `<root>/README.md`。

### 6.4 并发采集竞态

两名采集者各自未 `git pull` 就同时采集了同一篇，是无法从源头消除的竞态。指针目录形态将其后果从「Git 合并冲突」降级为「无冲突合并，但仓库中该笔记存在两份」——后者可被程序检测，前者需人在 merge 时手工解决。

检测方式：某个 `_index/{bucket}/{note_id}/` 目录下存在多于一个指针文件。

- v1：查重时若发现命中目录含多个指针，侧边栏就地提示「这篇存在 N 份重复采集」并列出各自路径
- v3：统计面板提供全仓扫描，列出所有重复项供人工清理

各类合并场景的完整行为与处理步骤见第 12 节。

### 6.5 视频笔记

判定为视频笔记时不采集，侧边栏显示明确原因。实况图不属于此类（见 5.3）。

判据已由探针确认：

```ts
if (note.type === "video") return "unsupported_video";
```

`note.video` 可作结构一致性辅助校验。**不依赖 `videoList`**——实测视频样本中该字段并不存在。

## 7. 模块划分

核心层为 TypeScript，不接触 DOM，可脱离浏览器单测。UI 层只订阅核心层暴露的状态。

| 模块 | 职责 | 测试方式 |
|---|---|---|
| `bridge/main-world.ts` | `document_start` 注入：劫持 `__INITIAL_STATE__` 赋值、patch fetch/XHR、按 noteId 缓存、postMessage 外发 | 喂 fixture 驱动 |
| `bridge/isolated.ts` | postMessage ↔ chrome.runtime 中继，校验来源与 nonce | 单测 |
| `core/extractor.ts` | 原始对象 → `NoteRecord`；判定视频笔记与实况图 | 喂 fixture JSON |
| `core/image-source.ts` | 由 `fileId` 构造原图 URL、候选 host、尺寸校验、降级顺序 | 单测 |
| `core/store.ts` | FSA 封装：授权、建目录、原子写、读、递归删除 | OPFS 模拟 |
| `core/index-store.ts` | 指针文件读写、查重、全量遍历聚合 | OPFS 模拟 |
| `core/archiver.ts` | 流程编排：查重 → 下图 → 写盘 → 写指针；发布进度事件 | 注入 mock |
| `core/settings.ts` | 采集者 ID、数据集路径、目录句柄持久化与校验 | 单测 |
| `ui/*` | React 组件，订阅 archiver 状态机 | — |

分层高于框架选择：分层做对，UI 框架可随时替换；分层做错，任何框架都会腐化。

## 8. 侧边栏状态机

```
未授权 root 目录
  → 未设采集者 ID
    → 当前 tab 非小红书
      → 非笔记页
        → 视频笔记（拒绝，说明原因）
          → 他人已采集（阻止，显示对方 ID / 时间 / 路径）
            → 自己已采集（更新原处 or 迁移到当前数据集）
              → 就绪 → 采集中 (3/8) → 完成 / 部分失败（可重试）
```

这些状态的交叉组合正是选择 React 而非手写 DOM 的原因。

## 9. 假设验证状态

完整报告见 `2026-08-03-xhs-archiver-assumption-validation.md`。

### 9.1 已验证并已并入设计

| 结论 | 影响 |
|---|---|
| `__INITIAL_STATE__` 在 hydration 后被删除，点击时再注入读不到 | 推翻原方案，改为 3.5 的 `document_start` 桥接脚本 |
| `infoList` 只有 `WB_PRV`/`WB_DFT`，均为 1080 宽派生图，都不是原图；原图须由 `fileId` 构造 | 重写 5.3 的图片获取规则 |
| 原图为 JPEG 且体积约为 `WB_DFT` 的 4–5 倍 | 存储估算翻 5 倍，促成 3.1 的自建 Git 服务决策 |
| 独立页 CDN 不校验 `Referer`，且返回 `Access-Control-Allow-Origin: *` | 无需 `declarativeNetRequest` 改写；仍需声明 `host_permissions` |
| 视频判据为 `note.type === "video"`，`videoList` 不存在 | 写入 6.5 |
| 内嵌状态脚本含 `undefined` 字面量，非严格 JSON | 写入第 6 节的兜底解析规则 |

### 9.2 开工前必须完成

**modal 入口验证（阻塞项）。** 需登录态，确认首页与搜索结果页点开 modal 时：目标接口路径、响应是否含完整 note、noteId 的定位方式、桥接脚本的缓存时机是否足够早。若 feed 响应不含完整数据，采集触发方式需再次调整。

### 9.3 不阻塞开工，实现中校准

- **实况图 fixture。** 按 `image.livePhoto === true` 实现，字段缺失按 `false`，不阻断采集（理由见 5.3）。取得新版与历史样本后校准。
- **多样本验证 `fileId` 原图地址。** 确认区域 host 候选与回退顺序对老笔记同样成立。
- **在真实 `chrome-extension://` 上下文中完整跑一次 fetch**，确认 manifest 权限配置正确。
- **覆盖其他 CDN 区域域名。** 若出现 403，先尝试其他原图 host 与 `WB_DFT` 回退，再考虑 Referer 改写。

## 10. 技术栈

Vite + CRXJS + TypeScript + React（MV3 Side Panel）。

选择带构建链而非免构建原生 JS 的理由：侧边栏需同时反映授权状态、采集者配置、页面类型、查重结果、视频拒绝、逐张进度、失败重试等多个状态源，且后续要扩展为历史列表、查重、统计、导出四个视图。手写 DOM 同步这些状态在第二次需求变更时即难以维护。

图片跨域 fetch 依赖 `host_permissions` 声明；扩展页面在已声明权限的情况下发起的 fetch 不受 CORS 限制。需声明的 host 至少包括 `*.xhscdn.com` 与 `ci.xiaohongshu.com`。

manifest 需注册两个 content script，`matches` 限定 `*.xiaohongshu.com`：

| 脚本 | world | run_at |
|---|---|---|
| `bridge/main-world` | `MAIN` | `document_start` |
| `bridge/isolated` | `ISOLATED` | `document_start` |

`document_start` 是硬要求：晚于此则错过 `__INITIAL_STATE__` 的赋值与首批 feed 请求。

## 11. 迭代切分

**v0（开工前置）**
登录态下完成 9.2 的 modal 入口验证，产出三份 fixture：独立页图文、首页 modal 图文、搜索 modal 图文。

**v1（可用）**
设置引导（选 root 目录 + 采集者 ID）→ 页面识别 → 查重（自己的可更新/迁移，他人的阻止）→ 单篇采集 → 视频笔记拒绝 → 部分失败重试 → 重复采集就地提示 → 复制临时链接

**v2**
采集历史列表（缩略图 + 标题 + 时间 + 采集者，可点击回访）、手动查重（支持批量粘贴链接去重）

**v3**
统计面板（累计篇数、今日数、各采集者贡献、体积占用、全仓重复项扫描）、CSV/JSONL 导出

v2 与 v3 均只新增 UI 视图并调用 `index-store` 的遍历聚合能力，核心层不改动。

## 12. Git 合并行为与冲突处理

### 12.1 各场景行为

| 场景 | 结果 |
|---|---|
| 不同人采集不同笔记 | 自动合并 |
| 不同人同时采集同一篇（6.4 竞态） | **自动合并**——指针文件名不同、数据目录路径也不同。产生的是需事后清理的重复，不是冲突 |
| 同一人在两台机器上采集同一篇 | `{采集者}.json` add/add 冲突 |
| 同一人在两台机器上重采同一篇 | `note.json` 内容冲突；若重下的图片 sha256 变化，还会有 LFS pointer 冲突 |
| `.gitattributes` / `.gitignore` / `README.md` | 自动合并——插件只在 root 首次初始化时生成，已存在则不覆盖 |

需要人工处理的仅后两类，均为同一采集者跨机器，规则一致：**整份取一侧，绝不逐行合并**。

不为此引入自定义 merge driver——那要求每个协作者本地执行 `git config`，是新的失败点，而收益仅覆盖上述窄面。

### 12.2 禁止逐行合并（必需）

Git 默认对 json 做三方逐行合并，冲突时写入 `<<<<<<<` 标记，**会使 json 变为非法文件**，导致整条工具链无法读取。因此插件生成的 `.gitattributes` 必须包含：

```gitattributes
# 图片走 LFS
**/images/**      filter=lfs diff=lfs merge=lfs -text

# 索引与笔记数据禁止逐行合并：语义上只能整份取一侧
_index/**/*.json  -merge
**/note.json      -merge
```

`-merge` 使冲突时工作区保留本地那份完整可读的 json，仅标记冲突，等待显式选择。

### 12.3 处理步骤

**json 冲突**

```bash
# 比较两侧的采集时间
git show :2:<path>/note.json | grep last_archived_at   # ours
git show :3:<path>/note.json | grep last_archived_at   # theirs

# 整份取较新的一侧
git checkout --theirs <path>/note.json
git add <path>/note.json
```

若两侧指针的 `path` 不同（数据落在了两个数据集目录下），选定一份后须删除另一个数据目录，否则会留下无指针指向的孤儿目录。

**LFS pointer 冲突**：同样 `git checkout --theirs <图片路径>`，随后 `git lfs pull` 补齐实体文件。

**合并后清理重复采集**

```bash
find _index -mindepth 2 -maxdepth 2 -type d \
  -exec sh -c '[ $(ls -1 "$1" | wc -l) -gt 1 ] && echo "$1"' _ {} \;
```

保留 `first_archived_at` 较早的一份（先采者优先），删除另一份的**数据目录与指针文件**两处。v3 统计面板将此扫描做成 UI。

### 12.4 写入 README

12.1 的场景表、12.3 的全部命令，以及 6.3 的「删除他人指针以解除阻止」指引，均写入插件生成的 `<root>/README.md`，使接手仓库的人无需询问即可处理。
