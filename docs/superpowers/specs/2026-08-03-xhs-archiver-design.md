# 小红书笔记归档插件 — 设计文档

日期：2026-08-03

## 1. 目标

一个 Chrome 扩展（MV3，Side Panel 形式）。用户在浏览一篇小红书图文笔记时，点击侧边栏按钮，即把该笔记的正文、标题、话题标签、互动数据、作者信息与全部图片原图，结构化归档到本地文件系统的指定目录。

多名采集者共用一个 Git 仓库作为数据仓库，需要支持跨人去重与无冲突合并。

## 2. 范围

### 做

- 单篇图文笔记的完整归档
- 随笔记一并采集**页面上已加载的**评论（含回复与配图），见第 13 节
- 采集前的全局去重检查，并显示上次采集时间与采集者
- 视频笔记识别并拒绝采集，给出明确提示
- 采集者身份与写入路径的配置与引导
- 部分失败的重试

### 不做

- 视频笔记的采集
- **评论区的全量采集**：不滚动页面、不点「展开 N 条回复」、不构造评论 API 请求。理由见 13.1
- 作者主页扩展信息（粉丝数等）采集
- 批量／自动化采集（本插件为「看到一篇、采一篇」的手动工具）
- 由插件执行任何 git 命令（commit/push 由使用者自行完成）

## 3. 关键约束

### 3.1 数据仓库独立于插件代码仓库

插件代码是一个 Git 仓库；采集数据是**另一个**独立的 Git 仓库。两者永不相交。插件通过 File System Access API 由用户手动选定数据仓库根目录（下称 `<root>`）。

数据仓库托管于**自建 Git 服务**（Gitea/GitLab 自托管或内网 NAS 裸仓库），因此 LFS 无额度限制。这是必要的：改存原图后每篇约 4.2 MB，1000 篇约 4.2 GB，远超 GitHub LFS 免费额度（1 GB）。插件本身不感知托管方式。

### 3.2 文件系统访问

采用 File System Access API（`showDirectoryPicker`）。目录句柄持久化在 IndexedDB，打开面板时自动恢复；权限失效时侧边栏显示「重新授权」按钮，由用户手势触发 `requestPermission()`。顶部常驻显示当前 `<root>` 路径，旁边提供「切换」入口。

**权限随时会被回收，不只是浏览器重启。** 实测：扩展 origin 的最后一个标签页关闭时（典型路径是从侧边栏打开浏览页、看完又关掉），Chrome 就把该 origin 上所有句柄的权限降回 `prompt`——侧边栏还开着也一样，它不算标签页。因此：

- **每个判定周期都要查一遍权限**（`hasPermission`），不能只在挂载时查一次。`queryPermission` 不需要用户手势，代价可以忽略。
- **权限没了不等于目录没选。** 句柄仍在 IndexedDB 里，只差一次用户手势，界面必须给「恢复授权」而不是把人打回重选目录（`need_permission` 状态）。退回 `need_root` 是错的——那让人以为设置丢了。
- **采集按钮本身就是用户手势**，所以 `doArchive` 一进来就 `ensurePermission()`：权限刚被回收的常见情况下，使用者点一次「允许」就继续采，不必被打回授权页。这一步必须排在其他 `await` 之前，手势的有效期只有几秒。
- **`NotAllowedError` 要单独识别**（`isPermissionError`），不能混进 `panel_error`。后者的提示是「跟页面无关，展开日志看现场」，对着一句 `NotAllowedError` 谁也不知道该干什么。

选择 FSA 而非 `chrome.downloads` 的决定性理由：只有 FSA 能**读回目录内容**，这是「速查某篇是否已采集」的前提。

### 3.3 执行位置

Side Panel 是协调者兼执行者：持有目录句柄、发起图片 fetch、写盘、渲染进度。Service Worker 仅保留一个职责——响应扩展图标点击以打开侧边栏。

理由：

- MV3 的 Service Worker 空闲 30 秒即被终止，一篇 8 张图的下载可能中途被打断，需额外做 keepalive
- FSA 权限恢复需要用户手势，Service Worker 中没有 UI 可供点击
- Side Panel 只要开着就持续存活，天然适合长任务

### 3.5 数据源

**登录态下**，`window.__INITIAL_STATE__` 是一个持续存在的 Vue 响应式 store，三种入口均可在用户点击采集时直接读取：

```ts
chrome.scripting.executeScript({
  world: "MAIN",
  func: () => {
    const s = window.__INITIAL_STATE__.note;
    const id = /\/explore\/([0-9a-f]+)/.exec(location.pathname)[1];
    return structuredClone(s.noteDetailMap[id].note);
  },
});
```

`world: "MAIN"` 是必需的——隔离世界读不到页面的全局变量。

四条经实测确认的硬性细节：

1. **用页面自己的 `location.pathname` 里的 note id 定位。** 另外两个候选都不可靠：
   - `note.currentNoteId._value`（Vue ref）会在 modal 关闭后被重置为空字符串，而此时 `noteDetailMap` 里的数据仍然完好——照它取就会误报「读不到笔记」。
   - 侧边栏拿到的 `tab.url` 会**滞后于 SPA 的实际地址**。modal 开关只改 history，关掉 modal 后 `tab.url` 可能还带着上一篇的 id，据此判定就会去取一篇根本没在看的笔记。

   `currentNoteId` 只在 URL 上没有 id 时作兜底。`tab.url` 只用来判断域名（SPA 导航不改域名）。
2. **不能遍历 `noteDetailMap` 取首个非空 key**：其中存在 `""` 与 `"undefined"` 等脏 key，会拿到错误数据。必须用精确 id 索引。
3. **用 `JSON.parse(JSON.stringify(...))` 而不是 `structuredClone`。** 只取 `noteDetailMap[id].note` 子对象——其父层含 `dep`/`computed` 循环引用，不可整体序列化。取子对象后 JSON round-trip 的产物是纯 JSON，既能穿透 Vue 的响应式包装，也保证一定能跨扩展边界；`structuredClone` 的产物不一定能，实测出现过结果在传回时丢失、调用方只拿到 `undefined` 的情况。落盘本来就是 JSON，没有信息损失。
4. **注入函数必须全程 try/catch 且始终返回值。** 抛出去会让 `executeScript` 的 `result` 变成 `undefined`，调用方只能看到「无返回值」，现场信息全丢。Chrome 会把页面内的异常放在 `InjectionResult.error` 里，调用方要读它。

失败必须分类上报，不能都归成一个错误码——它们的排查方向完全相反：

| 错误码 | 含义 | 方向 |
|---|---|---|
| `inject_failed` | 注入没跑成：权限被拒、没命中 frame、脚本被拦 | 扩展侧 |
| `page_error` | 注入跑起来了但页面内抛异常 | 看错误原文 |
| `no_state` | 页面上没有 `__INITIAL_STATE__` | 登录态 / 页面没加载完 |
| `no_note` | 有全局数据但取不到这篇 | 页面状态或时序 |
| `incomplete_data` | 取到了但 note 只填了一半 | 等一下重试 |
| `panel_error` | 侧边栏自己抛异常，与页面无关 | 扩展代码 |

最后两个都不能省。侧边栏顶层的 try/catch 如果把自身异常也标成 `inject_failed`，就会把排查方向指到扩展权限上——实测踩过：一处 `RangeError: Invalid time value` 被显示成「注入页面脚本失败，重新加载扩展后再试」。

#### 数据是异步填充的

`noteDetailMap[id]` 从无到有、从半份到完整都需要时间，实测点开 modal 的瞬间 entry 可能还不存在。因此：

- **归一化必须校验必需字段**（`noteId`、`time`、`user.userId`、`imageList`），缺任何一个都返回 `missing_data`，绝不带着坏值往下走——落盘的 `note.json` 是要进 Git 的。尤其 `time`：缺失时 `toBeijingIso` 会抛 `RangeError`，而不是产出一个显眼的坏值。
- **`no_note` 与 `incomplete_data` 自动重读**（300 / 700 / 1500 ms 三次）。它们是可能自愈的；其余错误码重试多少次都一样，只会刷屏。
- **重试期间显示「正在读取页面数据…」，不显示错误。** SPA 一改 URL 就触发重读，而笔记数据往往还没填进 store，这时把错误摆出来纯属吓人——它多半几百毫秒后自己就好了。用户看到的「先报读不到、再跳出笔记」就是这个中间态泄漏。真错误只在重试用尽后才显示。
- **工作日志只记一次判定的最终结论，重读次数记在条目的 `attempts` 上。** 中间态不单独成条：它几百毫秒后就被最终结论取代，逐条记录会让打开一篇笔记刷出四条，把真正有用的历史挤出上限。排查所需的「重试过几次」由 `attempts` 保留。

每次读取都回传一份现场快照（`pathname`、`urlId`、`currentNoteId`、`mapKeys`、是否命中、异常原文），侧边栏据此显示工作日志。这几个量一起看才能判断问题出在哪一层，尤其是 `tab.url` 与 `pathname` 的差异——它俩对不上就是 SPA 导航后 tab 地址滞后。

#### 登录态是前提

首轮探针在**未登录会话**下观察到「hydration 后 `__INITIAL_STATE__` 被删除」，据此一度设计了 `document_start` 常驻脚本劫持赋值、patch fetch/XHR、经三段链路传递数据。登录态复验表明该前提不成立——两种会话的渲染路径不同。

插件的使用前提本就是登录态，故不实现任何桥接机制。若登录态失效导致读不到全局变量，按 6. 的规则降级到 DOM 解析并在侧边栏提示。

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
            ├── comments.json         ← 只在读到评论数据时生成，见第 13 节
            └── images/
                ├── 01.jpg            ← 扩展名由响应 Content-Type 定：原图 jpg，降级后 webp
                ├── 02.webp
                └── comments/         ← 评论配图，文件名为 {评论id}-{序号}.{ext}
                    └── 6a61e88a00000000090162b7-01.webp
```

### 4.1 数据集路径

笔记写入路径为 `<root>/<dataset_path>/<note_id>/`。`dataset_path` 默认固定为 `collected`，不随当天日期自动变化。使用者可手动添加二级路径进行分类，例如按日期使用 `collected/2026-08-04`，或按主题使用 `collected/outfit`。保存后记住该值，直到使用者再次修改。

**默认路径不按采集者分目录。** 一篇笔记在仓库里只有一份，谁采的记在指针文件名与 `note.json` 的 `archive.collector` 里，不需要目录再表达一遍。而且路径里带采集者名会在接管（见 6.3）之后失真：数据归了 zach，目录却还叫 `lily/`。改采集者 ID 也不再改动写入路径。

**默认值要经使用者确认一次**（状态机里的 `need_path`，见第 8 节）。选完目录、设完 ID 之后单独出一屏，说明二级路径可用于日期或主题分类，并把完整的落盘路径 `<仓库>/<写入路径>/{笔记ID}/` 摆出来，确认后才进入正常流程。理由：路径决定整个仓库的组织方式，「有默认值」不等于「使用者知道数据会落在哪」。

确认之后写入路径常驻侧边栏底部（没打开笔记时也在），以「写入路径　当前值　· 修改」的只读行展示。点「修改」进入独立设置页；编辑使用临时草稿，只有点「保存修改」才持久化，「取消」不改变原路径。采集进行中禁用修改入口。

### 4.2 索引：分桶指针目录

```
_index/68/68a1b2c3d4e5f6/
└── zach.json
```

即 `_index/{note_id 前两位}/{note_id}/{采集者ID}.json`，内容：

```json
{
  "note_id": "68a1b2c3d4e5f6",
  "path": "collected/2026-08-03/68a1b2c3d4e5f6",
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

两条配套规则，同为 diff 稳定性服务：

- **`raw` 字段递归按 key 排序。** 实测 note 的字段顺序在独立页、首页 modal、搜索 modal 三种入口下并不一致，不排序则同一篇笔记换个入口重采就会整块重写。
- **时间戳固定 `+08:00` 偏移，不使用机器本地时区，不含毫秒。** 否则不同时区的协作者会为同一时刻生成不同字符串。

`content` 是剔除话题标签后的正文：原始 `desc` 会把话题重复一遍（`#名字[话题]#`），而 `tags` 已从 `tagList` 单独取过，正文再留一份既冗余又影响阅读。只剔除带 `[话题]#` 的完整形态，作者手写的普通 `#` 保留。未经处理的原文始终在 `raw.desc` 里。

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
  "last_edited_at": "2026-07-30T09:10:00+08:00",
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

**探针推翻了「从 `infoList` 选最高质量」的原方案。** 实测 `infoList` 只含 `WB_PRV` 与 `WB_DFT` 两种 scene，两者像素尺寸完全相同（均为 1080 宽，仅压缩率不同），**都不是原图**。原图须由 `image.fileId` 构造地址取得，且**不需要任何 token**：

| 来源 | 尺寸 | 大小 | Content-Type |
|---|---|---:|---|
| `WB_PRV` | 1080 宽 | 23 KB | `image/webp` |
| `WB_DFT` | 1080 宽 | 73 KB | `image/webp` |
| `{host}/{fileId}`，前缀 `notes_pre_post/` | 3106 × 4096 | 997 KB | `image/jpeg` |
| `{host}/{fileId}`，前缀 `note_pre_post_uhdr/` | 声明 3024 × 4032 | 1.36 MB | **`image/heic`** |

候选 host：`https://sns-img-qc.xhscdn.com/` 与 `https://ci.xiaohongshu.com/`，实测返回字节数完全一致，互为镜像。

获取顺序：

1. 由 `fileId` 构造原图 URL 并下载
2. 校验 HTTP 状态与 `Content-Type`
3. **可解码格式（jpeg/png/webp）**：解码并比对实际尺寸与 `image.width` / `image.height`，一致则接受，`source_kind: "original"`
4. **HEIC**：放弃原图，降级 `WB_DFT`（见下）
5. 请求失败或尺寸不符时同样降级 `WB_DFT`，再降级 `WB_PRV`，`source_kind` 记录实际来源

#### HEIC 处理

部分笔记（`fileId` 前缀含 `uhdr`，即 Ultra HDR）的原图为 HEIC。Chrome 无法解码，`createImageBitmap` 直接失败，故「解码校验尺寸」这道检查对它不适用；下游兼容性也差（Windows 默认不支持，多数图像库需额外依赖）。

**决定：遇到 HEIC 即降级为 `WB_DFT`**，使全库图片格式统一可用。

**代价可控，前提是 `file_id` 必须始终写入 `note.json`。** 原图地址不依赖 `xsec_token`、CDN 不校验 `Referer`，凭 `file_id` 随时可批量重取原图——降级只是没有落盘，不是永久失去。配合 `source_kind` 可精确筛出这批图。

其他规则：

- 编号与 `imageList` 顺序严格一致，从 `01` 起，两位补零
- 扩展名由响应的 `Content-Type` 决定——**不可假定为 WebP**
- `file` 记录实际文件名，保证 json 与磁盘一一对应
- 原图 host 及其区域后缀可能变化，构造逻辑与候选 host 集中封装于 `core/image-source.ts`

实况图（Live Photo）只保存静态帧，不视为视频笔记。判定采用 `image.livePhoto === true`，字段缺失时按 `false` 处理，**任何情况下都不阻断采集**——判错的唯一后果是 `is_live` 标记不准，不影响归档正确性。取得真实样本后再校准。

## 6. 采集流程

```
[小红书页面]                    [Side Panel]                      [磁盘]
     │                              │
     │ ① 用户点击采集
     │   executeScript({ world: 'MAIN' })
     │←─────────────────────────────│
     │ ② 返回 noteDetailMap[URL 里的 note id] 下的 note 与 comments
     │─────────────────────────────→│
                                    │ ③ 归一化 → NoteRecord + CommentsFile
                                    │ ④ 查 _index ────────────────→ 已采过？谁采的？
                                    │ ⑤ 按 fileId 取原图（HEIC 则降级），下载到内存
                                    │ ⑥ 取评论配图（失败只跳过该张，见 13.4）
                                    │ ⑦ 写盘 ──────────────────────→ note.json + comments.json + images/
                                    │ ⑧ 写指针 ────────────────────→ _index/xx/{id}/{采集者}.json
```

三种入口（独立页、首页 modal、搜索页 modal）在登录态下走完全相同的路径，实测均可读到完整数据（见 3.5）。

② 未命中时降级到 DOM 解析，并在侧边栏提示数据可能不完整。不实现「解析 DOM 中残留的内嵌状态脚本」这一层——该脚本文本含 JavaScript `undefined` 字面量、非严格 JSON，而登录态下全局变量本就可读，为一个不会发生的场景写解析器不划算。**任何情况下都不使用 `eval` / `new Function` 执行页面提供的字符串。**

### 6.1 原子性

保证 **指针存在 ⟹ 数据完整**，使查重永不产生假阳性。

1. 全部图片先 fetch 到内存（一篇 6–10 张，数 MB，可接受）
2. 全部成功后才开始写盘，最后写 `_index` 指针
3. 任一图片失败则重试 2 次；仍失败则整篇标记 `status: "partial"`，**不写指针文件**，目录保留供人工检查，侧边栏提供重试按钮

**评论配图不参与这条不变量**：它取不到只跳过该张，不影响 `status`、不阻止写指针。评论是附属数据，让一张配图把主干拖成 `partial` 是本末倒置。见 13.4。

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

查重命中且指针的 `collector` 不是当前采集者时，**可以接管**：动作与 6.2 完全相同（原位更新 / 迁移到当前路径），只是会把这篇转到自己名下。侧边栏显示对方的采集者 ID、采集时间与路径，并在按钮上方明确写出「接管后这篇归到你名下，{对方} 的采集记录会被替换」。

不做「另存一份」。数据仓库中每篇笔记始终全局唯一一份——接管改变的是归属，不是份数。

**接管必须作废对方的指针。** 指针是「一个采集者一个文件」（`_index/{bucket}/{note_id}/{采集者}.json`），只写自己的而不删对方的，`lookup` 就会返回两条指向同一份数据的指针，下次打开这篇会被误判成 6.4 的并发竞态。因此 `archive()` 接受 `supersede: Pointer[]`，在**写入自己的指针之后**逐个删除其中 `collector` 不是自己的那些。

顺序不能反：先删后写，中途出错就会一条指针都不剩，这篇凭空变回「没人采过」；先写后删，最坏留下两条指针，看得出来需要清理。

`lookup` 返回多条时（并发竞态遗留），全部传入 `supersede` 一并收拢，不能只处理第一条。

早先的设计是「阻止采集、逃生口是手动删除对方的指针文件」。改掉的原因：接管是正常协作动作（对方图片残缺、人员离职、临时代采），不该要求使用者去翻 `_index` 目录；而 UI 里的一句说明加一次点击，已经足够让它成为有意为之的操作。

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
| `core/extractor.ts` | 原始对象 → `NoteRecord`；互动数字符串转数字；判定视频笔记与实况图 | 喂 fixture JSON |
| `core/image-source.ts` | 由 `fileId` 构造原图 URL、候选 host、格式判定、尺寸校验、降级顺序 | 单测 |
| `core/store.ts` | FSA 封装：授权、建目录、原子写、读、递归删除 | OPFS 模拟 |
| `core/index-store.ts` | 指针文件读写、查重、全量遍历聚合 | OPFS 模拟 |
| `core/archiver.ts` | 流程编排：查重 → 下图 → 写盘 → 写指针；发布进度事件 | 注入 mock |
| `core/settings.ts` | 采集者 ID、数据集路径、目录句柄持久化与校验 | 单测 |
| `ui/*` | React 组件，订阅 archiver 状态机 | — |

分层高于框架选择：分层做对，UI 框架可随时替换；分层做错，任何框架都会腐化。

## 8. 侧边栏状态机

```
未授权 root 目录
  → 目录还在但权限被回收（一键恢复，不用重选目录）
  → 未设采集者 ID
    → 未确认写入路径（给出默认值，可改，确认后才继续）
    → 当前 tab 非小红书
      → 非笔记页 / 读取中（数据未就绪，自动重读）
        → 视频笔记（拒绝，说明原因）
          → 他人已采集（可接管：更新原处 or 迁移到当前数据集）
            → 自己已采集（更新原处 or 迁移到当前数据集）
              → 就绪 → 采集中 (3/8) → 完成 / 部分失败（可重试）
```

这些状态的交叉组合正是选择 React 而非手写 DOM 的原因。

「非笔记页」的判定依据是**页面自己报的 pathname**，不是 `tab.url`（理由见 3.5）。页面说当前地址上没有笔记 id，那就是用户没打开笔记，而不是读取失败——这两者给用户的指引完全不同。

侧边栏底部常驻一个可折叠的**工作日志**，记录判定结果与现场快照。归档工具出问题时，用户能给出的信息通常只有一句「读不到」，日志是唯一能把问题定位到层的手段。日志里的 `tab.url` 去掉 query（`xsec_token` 会过期，留着既没用又是多余的泄露面）。

日志的价值取决于信噪比，因此有三条硬约束——缺任何一条，打开一篇笔记都会刷出十几条一模一样的记录，把有用的历史挤出上限：

1. **只在笔记页上记。** `not_xhs`、`not_note`、未配置仓库/采集者、待恢复授权这些状态一律不产生条目（`shouldLog`）。例外是 `panel_error`：侧边栏自己抛异常时无从判断当时在不在笔记页，丢掉它就丢掉了唯一线索。
2. **结论相同就地合并**（`recordLog`），累加 `repeats`、更新为最新的时间与现场，不新增条目。评论条数与重读次数不参与「是否同一判定」的比较：它们会变，但结论没变。
3. **一次判定周期只在尘埃落定时记一条。** 重试中的中间态不记，重读次数进 `attempts`。

配套的两项在实现侧：判定周期带序号，被新触发取代的旧周期直接作废（否则几个并发周期各写各的）；`chrome.tabs.onUpdated` 必须过滤——它在一次导航里会触发好几次（`loading`、title、favicon、`complete`），且**别的标签页更新也会触发**，不过滤就会跑起好几个判定周期，日志刷屏、注入也白做好几遍。

**「本次刚采完」必须与「以前采过」区分显示。** 两者在数据上都是「自己已采集」，但用户点完按钮需要的是本次操作的确认，看到一段历史记录会以为没生效。因此采集结果单独作为一次性提示呈现，并在切换标签页或切换笔记时清除——它一旦不再对应当前笔记就是误导。

## 9. 假设验证状态

两轮真实页面验证：首轮为未登录会话，次轮为登录态实测复验。**两轮结论在数据源一节上相反，以登录态为准**——插件的使用前提就是登录态。下表为最终结论。

### 9.1 已验证并已并入设计

| 结论 | 影响 |
|---|---|
| **登录态下三种入口均可读 `__INITIAL_STATE__.note.noteDetailMap`**，`readyState: complete` 时依然存在 | 推翻未登录会话的「已被删除」结论，撤销整套桥接脚本，回到 3.5 的 `executeScript` |
| **`currentNoteId._value` 会在 modal 关闭后被重置为 `""`**，而 `noteDetailMap` 里的数据仍完好 | 改用页面 `location` 里的 note id 定位，见 3.5 |
| **侧边栏拿到的 `tab.url` 会滞后于 SPA 实际地址**：关掉 modal 后仍带着上一篇的 id | 「是不是在看笔记」只能由页面自己回答，`tab.url` 仅用于判域名 |
| 页面上很多笔记的 `title` 为空，正文首行才是页面上看到的那句话 | 侧边栏标题为空时取正文首行并标注，否则会被误认为读错了笔记 |
| **`noteDetailMap[id]` 是异步填充的**，点开 modal 瞬间 entry 可能不存在或只有半份字段 | 归一化校验必需字段；`no_note`/`incomplete_data` 自动重试一次 |
| `noteDetailMap` 含 `""`/`"undefined"` 脏 key，不能遍历取首个非空 key | 写入 3.5 |
| `desc` 末尾（有时中间）重复一遍话题标签，形如 `#名字[话题]#`，可连写；平台截断时会剩一个孤立 `#` | 落盘前从正文剔除，`tags` 仍取自 `tagList` |
| `lastUpdateTime` 为毫秒时间戳，即页面上「编辑于 …」所示时间；未编辑过的笔记它与 `time` 也可能差几百毫秒 | 归档为 `last_edited_at` |
| `noteDetailMap[id].note` 可 `structuredClone`（约 4.4 KB）；但其父层含 `dep`/`computed` 循环引用 | 只取 `.note` 子对象作为返回值 |
| `interactInfo` 各字段为字符串；`time` 为毫秒时间戳；`tagList[].type === "topic"` | 归一化规则，写入 `core/extractor.ts` |
| note 字段顺序在不同入口下不一致 | 印证 5. 的固定 key 顺序要求 |
| `infoList` 只有 `WB_PRV`/`WB_DFT`，均 1080 宽，都不是原图；原图由 `fileId` 构造且不需 token | 重写 5.3 |
| `fileId` 前缀有 `notes_pre_post/` 与 `note_pre_post_uhdr/` 等多种；后者原图为 **HEIC** | 5.3 的 HEIC 降级规则 |
| 两个原图 host 返回字节数完全一致，互为镜像 | 回退有效 |
| CDN 不校验 `Referer`，返回 `Access-Control-Allow-Origin: *` | 无需 `declarativeNetRequest`；仍需声明 `host_permissions` |
| 视频判据为 `note.type === "video"`，`videoList` 不存在 | 写入 6.5 |
| **评论在 `noteDetailMap[id].comments`**，与 `note` 同级，结构 `{list, cursor, hasMore, loading, firstRequestFinish}` | 与 note 同一次注入取回，见 13.2 |
| **首屏只有 10 条主评论，每条有回复的只预载 1 条回复** | 「只采已加载的」意味着默认约 10~20 条，必须在 UI 上标出差额，见 13.5 |
| **裸 fetch 评论 API 返回 406**；用页面的 `_webmsxyw` 加签后过签，但被风控挡回 `300011 当前账号存在异常` | 否决构造 API 请求这条路，见 13.1 |
| 滚动 `.note-scroller` 到底可加载全部主评论，反复点 `.show-more` 可展开全部回复；实测 96 条评论 4 轮滚动 + 3 轮点击可全部取到 | 技术可行但会操作用户正在看的页面，故不采用，见 13.1 |
| **`主评论数 + Σ子评论数` 恰等于 `interactInfo.commentCount`**（实测 96/96 精确吻合） | 可直接作为完整性判据，即 `complete` 字段 |
| **`subCommentHasMore` 在回复加载完后不会重置为 false** | 它不可作为「是否已加载完」的判据 |
| **评论图无 `fileId`**，按笔记原图规则构造的地址一律 404；只有 `WB_DFT`/`WB_PRV` 可用，且 url 是 `http://` | 评论图单独一套候选，见 13.4 |
| **评论图的声明尺寸是展示尺寸**，实测 284×367 的图实际为 556×717 | 评论图不做尺寸校验，否则全数失败 |

### 9.2 不阻塞开工，实现中校准

- **实况图 fixture。** 按 `image.livePhoto === true` 实现，字段缺失按 `false`，不阻断采集（理由见 5.3）。取得样本后校准。
- **互动数的极端取值。** 已确认为字符串（`"1236"`）。需确认是否存在 `"1.2万"`、`"10万+"` 一类非纯数字形式，并在归一化时处理。
- **在真实 `chrome-extension://` 上下文中完整跑一次 fetch**，确认 manifest 权限配置正确。
- **覆盖其他 CDN 区域域名。** 若出现 403，先尝试另一原图 host 与 `WB_DFT` 回退，再考虑 Referer 改写。
- **未登录 / 登录态失效时的行为。** 此时全局变量可能不可读，应给出明确提示而非静默失败。

## 10. 技术栈

Vite + CRXJS + TypeScript + React（MV3 Side Panel）。

选择带构建链而非免构建原生 JS 的理由：侧边栏需同时反映授权状态、采集者配置、页面类型、查重结果、视频拒绝、逐张进度、失败重试等多个状态源，且后续要扩展为历史列表、查重、统计、导出四个视图。手写 DOM 同步这些状态在第二次需求变更时即难以维护。

图片跨域 fetch 依赖 `host_permissions` 声明；扩展页面在已声明权限的情况下发起的 fetch 不受 CORS 限制。需声明的 host 至少包括 `*.xhscdn.com` 与 `ci.xiaohongshu.com`。

**不需要注册任何常驻 content script。** 数据读取通过 `chrome.scripting.executeScript` 按需注入，因此需要 `scripting` 权限与 `*.xiaohongshu.com` 的 host 权限。

## 11. 迭代切分

**v1（可用）**
设置引导（选 root 目录 + 采集者 ID + 确认写入路径）→ 页面识别 → 查重（自己的可更新/迁移，他人的可接管）→ 单篇采集 → 视频笔记拒绝 → 部分失败重试 → 重复采集就地提示 → 复制临时链接

**v2**
数据集浏览页（独立标签页，只读浏览全仓库内容，见 [`2026-08-04-dataset-browser-design.md`](2026-08-04-dataset-browser-design.md)）、手动查重（支持批量粘贴链接去重）

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

12.1 的场景表、12.3 的全部命令，以及 6.3 的接管语义（指针为何只该有一个），均写入插件生成的 `<root>/README.md`，使接手仓库的人无需询问即可处理。

## 13. 评论采集

### 13.1 只采页面上已加载的评论

**采集范围就是「打开侧边栏那一刻，页面自己已经填进 `noteDetailMap[id].comments` 的那些」。** 插件不滚动页面、不点击任何按钮、不构造评论 API 请求。

这条边界是从三个被否决的方案里剩下来的：

| 方案 | 否决理由 |
|---|---|
| 构造评论 API 请求 | 裸 fetch 直接 406。借页面的 `_webmsxyw` 加签能过签名校验，但服务端返回 `300011 当前账号存在异常`——还缺风控头。继续往下就是与平台风控对抗：签名函数名随时会变，且拿使用者的账号去撞风控 |
| 自动滚动 + 点「展开 N 条回复」 | 技术上可行且已实测跑通（96 条评论 4 轮滚动 + 3 轮点击全取）。但它会让用户正在看的页面自己动起来，耗时随评论数增长到数十秒，本质上仍是模拟操作 |
| 手动「加载全部评论」按钮 | 同上，只是把发起时机交给用户，并未消除对页面的操作 |

代价是明确的：一篇 96 条评论的笔记默认只采到约 20 条。**这个差额必须显示在界面上**（见 13.5），并如实写进 `comments.json` 的 `declared_total` / `collected_count` / `complete`，否则数据使用者会误以为评论是全的。想多采就自己往下翻几屏再点采集——这是唯一的「加载更多」方式。

### 13.2 数据来源

评论与 `note` 是 `noteDetailMap[id]` 下的兄弟字段，**同一次 `executeScript` 一并取回**。分两次注入会引入「两次读取之间页面已经换了笔记」的竞态，而这个竞态没有便宜的消除办法。

`comments` 缺失不是错误：modal 刚打开时它往往还没填。此时 `rawComments` 为 `null`，笔记照常可采，只是不写 `comments.json`。「没读到评论」与「读到了、就是 0 条」是两回事，前者不该留下一个空文件。

### 13.3 comments.json 契约

与 `note.json` 同目录、同样固定 key 顺序、2 空格缩进、末尾换行。

```json
{
  "schema_version": 1,
  "note_id": "68a1b2c3d4e5f6",
  "declared_total": 96,
  "collected_count": 20,
  "complete": false,
  "has_more": true,
  "comments": [
    {
      "id": "6a6356e8000000002902e848",
      "content": "…",
      "published_at": "2026-07-24T20:13:29+08:00",
      "ip_location": "安徽",
      "liked_count": 8,
      "author": { "user_id": "…", "nickname": "…", "avatar_url": "…", "profile_url": "…" },
      "at_users": [{ "user_id": "…", "nickname": "…" }],
      "tags": ["is_author", "user_top"],
      "images": [
        {
          "index": 1,
          "file": "images/comments/6a6356e8000000002902e848-01.webp",
          "width": 556, "height": 717,
          "declared_width": 284, "declared_height": 367,
          "bytes": 26074, "sha256": "…",
          "source_kind": "WB_DFT", "source_url": "https://…"
        }
      ],
      "sub_comment_count": 14,
      "sub_comments": [ { "…同上，但没有 sub_comment_count / sub_comments" } ]
    }
  ]
}
```

几个刻意的决定：

- **`declared_total` 取自笔记的 `interactInfo.commentCount`**，`collected_count` 是主评论 + 已加载回复的条数，`complete` 即两者是否相等。实测这个等式在评论全部加载时精确成立（96/96），可以放心作为判据。
- **不保留 `raw`。** 与 `note.json` 的做法相反，理由是评论字段少而稳、已被归一化完整覆盖；而 raw 里的 `xsecToken` 会过期、`liked`（当前账号点没点赞）与采集者绑定——两个采集者采同一篇会得到不同的值，只会让 diff 变脏。
- **回复不再向下嵌套。** 小红书的回复只有一层，给子评论也带上 `sub_comments: []` 纯属噪音。
- 一条评论只要缺 `id`、`userInfo.userId`，或 `createTime` 无效，就整条丢弃。与 note 同理：`toBeijingIso` 遇到无效时间戳会抛 `RangeError`。

### 13.4 评论配图

写入 `images/comments/{评论id}-{序号}.{ext}`。评论 id 全局唯一，不需要再按主/子评论分目录。

与笔记图的两点不同都是实测出来的：

1. **没有原图。** 评论图不带 `fileId`，url 路径里那串形似 fileId 的 ID 拿去构造 `sns-img-qc` / `ci.xiaohongshu` 地址一律 404。候选只有 `WB_DFT` → `WB_PRV`，且原始 url 是 `http://`，需升到 `https://` 才能在扩展页面里 fetch。
2. **不做尺寸校验。** 声明尺寸是页面上的展示尺寸（284×367 的图实际是 556×717），拿它校验会让每张评论图都判为「尺寸不符」而全数失败。`declared_*` 照记，但只作参考。

**取不到的配图整条从 `comments.json` 里省略**，不留半截记录——否则读者会照着 `file` 字段去找一个不存在的文件。失败原因通过 `ArchiveResult.commentImageFailures` 报到 UI，但不影响 `status`，不阻止写指针（见 6.1）。

重采时**先清空 `images/comments/` 再写**：评论会增删，残留的旧文件会造成「`comments.json` 没提到这张图，目录里却躺着一张」的不一致。笔记图不需要这步，因为它按固定序号覆盖。

### 13.5 界面

侧边栏在笔记信息里显示 `评论 20/96`，未采全时补一句「只采页面已加载的，往下翻可加载更多」。采集完成的提示里同样带上这个比例。评论配图有失败时单列一行橙色提示，措辞要明确「其余数据完整」，避免被误读成采集失败。
