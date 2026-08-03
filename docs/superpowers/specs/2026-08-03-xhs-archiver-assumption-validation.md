# 小红书笔记归档插件：第 9 节假设验证报告

日期：2026-08-03

对应设计文档：`2026-08-03-xhs-archiver-design.md`

## 1. 结论摘要

本次针对设计文档第 9 节的四项假设进行了真实页面探测。结果如下：

| 假设 | 验证状态 | 结论 |
|---|---|---|
| 点击采集时可读取 `window.__INITIAL_STATE__.note.noteDetailMap[noteId]` | 不成立 | 独立页包含完整的内嵌状态脚本，但页面 hydration 完成后 `window.__INITIAL_STATE__` 已被删除，点击时再注入无法读取 |
| 可从 `imageList[].infoList[]` 选出原图 | 不成立 | `WB_PRV` 和 `WB_DFT` 均为 1080 宽派生图；原图可通过 `fileId` 构造地址获取 |
| 图片 CDN 校验 `Referer` | 当前样本不校验 | 不带 Referer 请求派生图和原图均返回 HTTP 200，且响应包含 `Access-Control-Allow-Origin: *` |
| 视频与实况图可通过预期字段判断 | 部分成立 | 视频可由 `note.type === "video"` 稳定判断；实况图尚缺真实样本，不能最终定案 |
| 首页和搜索页 modal 均能得到完整数据 | 未完成验证 | 当前测试会话未登录，点击卡片会先出现登录框；但现有“点击采集时才拦截”的方案存在明确时序问题 |

其中有两项会直接改变当前技术方案：

1. “点击采集时才向 MAIN world 注入脚本”无法可靠取得页面状态，尤其无法覆盖已经加载完成的 modal。
2. “从 `infoList` 选择最高质量 URL”无法满足“归档原图”的产品目标。

## 2. 验证环境与方法

- 页面：小红书 Web 独立笔记页、发现首页、搜索结果页
- 页面状态：未登录，但公开独立笔记页可正常显示标题、正文、作者、图片和评论
- 样本：一篇 8 图普通笔记、一篇视频笔记
- 数据检查：读取页面内嵌状态脚本文本并解析所需字段
- 图片检查：分别下载 `WB_PRV`、`WB_DFT` 和由 `fileId` 构造的原图，检查 HTTP 响应、Content-Type、文件大小和像素尺寸
- Referer 检查：使用不带 Referer 的独立 HTTP 请求访问 CDN

### 验证限制

- 未登录会话无法打开首页和搜索结果页中的笔记 modal，因此三种入口尚未全部形成完整 fixture。
- 未获得真实实况图笔记样本，因此实况图只能确认普通图片对象中相关字段的存在，不能确认所有版本的确切结构。
- CDN 结论来自当前样本和当前使用的域名，实施时仍应保留失败回退。

## 3. 假设一：页面状态数据源

### 3.1 独立页包含完整 note 数据

独立笔记页的 HTML 中存在如下内嵌脚本：

```js
window.__INITIAL_STATE__ = { /* 页面状态 */ }
```

其中包含：

```text
note.noteDetailMap[noteId].note
```

实测普通笔记对象包含以下关键字段：

```text
xsecToken
title
user
interactInfo
atUserList
lastUpdateTime
ipLocation
desc
imageList
tagList
time
shareInfo
noteId
type
```

标题、正文、作者、互动信息、标签和 8 张图片的数据均存在，独立页的数据完整性满足归档需要。

### 3.2 点击采集时已无法读取全局变量

页面完成加载后实测：

```js
window.__INITIAL_STATE__ === undefined
```

也就是说，虽然原始 `<script>` 文本仍留在 DOM 中，但应用 hydration 后已经删除了对应的全局变量。以下设计无法可靠工作：

```ts
chrome.scripting.executeScript({
  world: "MAIN",
  func: () => window.__INITIAL_STATE__,
});
```

因为这段代码在用户点击“采集”时才运行，执行时机远晚于 hydration。

### 3.3 内嵌状态不是严格 JSON

本次独立页的状态脚本中出现了 24 个 JavaScript `undefined` 字面量，因此截取赋值表达式后不能直接执行：

```ts
JSON.parse(rawState); // 会失败
```

不建议通过 `eval` 或 `new Function` 解析页面提供的字符串。若采用 DOM 中的内嵌脚本作为独立页兜底，应实现受控解析，或在赋值发生时直接捕获对象。

### 3.4 modal 场景的时序问题

首页初始状态只包含信息流卡片摘要，不包含已经点开的任意笔记详情。完整 modal 数据必然需要在点击卡片后动态取得。

因此，即使 `/api/sn/web/v1/feed` 响应包含完整数据，如果等用户再次点击侧边栏中的“采集”按钮后才开始拦截，请求也已经完成，无法回读历史响应体。

这是基于页面加载时序得出的架构结论；是否还存在可访问的应用内部 store，需要在登录态 modal 中继续验证。

### 3.5 建议调整

增加一个轻量、提前运行的数据桥接脚本：

```text
document_start，MAIN world
    ├── 捕获初始状态赋值
    ├── 提前监听目标 fetch/XHR 响应
    ├── 按 noteId 缓存原始 note
    └── 将数据安全地发送给扩展隔离世界

Side Panel
    └── 用户点击采集时，向桥接脚本请求当前 note
```

桥接脚本只负责捕获和短期缓存数据，不负责下载图片或写盘。Side Panel 仍是长任务协调者，因此第 3.3 节关于 Side Panel 生命周期的判断不需要改变。

建议将数据来源优先级改成：

```text
独立页：
预先捕获的初始状态
→ 受控解析内嵌状态脚本
→ DOM 解析

modal：
预先拦截并缓存的 /api/sn/web/v1/feed 响应
→ 页面应用内部状态（若后续验证可访问）
→ DOM 解析
```

## 4. 假设二：图片最高质量规则

### 4.1 `infoList` 实测结构

8 张普通图片的 `infoList` 均只有两种 scene：

```text
WB_PRV
WB_DFT
```

同时：

```text
image.urlPre     === WB_PRV.url
image.urlDefault === WB_DFT.url
image.url         为空
```

第一张图片实测结果：

| 来源 | 像素尺寸 | 文件大小 | Content-Type |
|---|---:|---:|---|
| `WB_PRV` | 1080 × 1655 | 23,496 B | `image/webp` |
| `WB_DFT` | 1080 × 1655 | 72,772 B | `image/webp` |
| `imageList` 声明尺寸 | 1780 × 2728 | — | — |

`WB_DFT` 与 `WB_PRV` 的像素尺寸完全相同，仅压缩质量更高。两者都不是原图。

### 4.2 通过 `fileId` 获取原图

图片对象包含：

```text
fileId: notes_pre_post/...
width: 1780
height: 2728
```

使用以下地址可以取得原图：

```text
https://sns-img-qc.xhscdn.com/{fileId}
```

第一张图片结果：

```text
Content-Type: image/jpeg
尺寸：1780 × 2728
大小：338,595 B
```

第二张图片复核结果：

```text
声明尺寸：1752 × 3620
下载尺寸：1752 × 3620
大小：1,069,029 B
```

`https://ci.xiaohongshu.com/{fileId}` 在本次第一张图片上也返回了相同尺寸和大小的资源。

### 4.3 建议的下载规则

建议不要在 `infoList` 内定义“最高质量”，而是使用如下顺序：

```text
1. 用 fileId 构造原图 URL
2. 下载并检查 HTTP 状态与 Content-Type
3. 解码图片并比较实际尺寸与 image.width / image.height
4. 尺寸一致则接受为原图
5. 原图请求失败或尺寸异常时回退 WB_DFT
6. WB_DFT 失败时再回退 WB_PRV
```

需要同时调整以下设计描述：

- 原图通常可能是 JPEG，不能假定为 WebP。
- 扩展名继续由响应的 `Content-Type` 决定是正确的。
- `source_url` 应记录最终实际下载的 URL。
- 可考虑额外记录 `source_kind: "original" | "WB_DFT" | "WB_PRV"`，方便以后审计是否发生过降级。
- 原图域名及其区域后缀可能变化，建议将构造逻辑与候选 host 集中封装，并保留 `infoList` 回退。

## 5. 假设三：CDN Referer 校验

以下资源均使用不带 Referer 的请求进行测试：

- `sns-webpic-qc.xhscdn.com` 的 `WB_PRV`
- `sns-webpic-qc.xhscdn.com` 的 `WB_DFT`
- `sns-img-qc.xhscdn.com/{fileId}` 原图
- `ci.xiaohongshu.com/{fileId}` 原图

结果均为 HTTP 200。响应中还包含：

```http
Access-Control-Allow-Origin: *
```

当前证据下，不需要为图片下载引入 `declarativeNetRequest` Referer 改写。扩展仍需声明相应 CDN 的 `host_permissions`。

建议实现阶段补充两类验证：

1. 覆盖真实页面中出现的其他 CDN 区域域名。
2. 在实际 `chrome-extension://` 上下文中执行一次完整 fetch，确认 manifest 权限配置正确。

如果后续某个 CDN 返回 403，应先尝试其他原图 host 和 `WB_DFT` 回退，再考虑 Referer 改写。

## 6. 假设四：视频与实况图判定

### 6.1 视频笔记已确认

视频样本的 note 结构为：

```text
note.type === "video"
note.video 存在
note.videoList 不存在
imageList.length === 1
```

`note.video` 内包含：

```text
mediaV2
media
image
capa
```

因此视频拒绝规则建议为：

```ts
if (note.type === "video") {
  return "unsupported_video";
}
```

`note.video` 可作为结构一致性检查，但不应依赖 `videoList`。

### 6.2 实况图尚未定案

普通图文样本的每个图片对象都包含：

```text
livePhoto: false
stream: {}
```

这说明当前数据结构中至少存在图片级 `livePhoto` 标记，首选判定很可能是：

```ts
image.livePhoto === true
```

但因为本次没有取得真实实况图样本，尚不能确认：

- 实况图笔记的 `note.type` 是否仍为 `normal`
- 动态部分是否位于 `image.stream`
- 是否存在 `image.livePhoto.media.stream` 等新旧版本差异
- 一篇笔记是否可能同时包含普通图片和实况图
- `livePhoto` 是否在所有入口和所有历史版本中都为布尔值

在获得真实样本前，不建议把实况图规则写死。

## 7. 对现有设计文档的具体修改建议

### 7.1 修改第 3.3 节“执行位置”

保留 Side Panel 作为归档协调者，同时增加：

> 页面侧存在一个从 `document_start` 运行的轻量数据桥接脚本，仅负责捕获初始状态和目标接口响应，并按 note ID 短期缓存。图片下载、文件系统权限和写盘流程仍全部由 Side Panel 执行。

### 7.2 修改第 5.3 节“图片”

将：

> 当同一张图有多种规格候选时，只下载最高质量的一个。

改为：

> 优先根据 `fileId` 请求原始图片，并以实际解码尺寸和 `imageList` 声明尺寸校验；失败时依次回退 `WB_DFT`、`WB_PRV`。扩展名由最终响应的 `Content-Type` 决定。

### 7.3 修改第 6 节“采集流程”

页面侧步骤建议改成：

```text
① 页面打开时，桥接脚本捕获初始状态或 feed 响应
② 用户点击采集时，Side Panel 请求当前 noteId 对应的缓存对象
③ 未命中时，独立页尝试受控解析内嵌状态脚本
④ 仍未命中时才进入 DOM 兜底或提示重新打开笔记
```

### 7.4 修改第 6.3 节“视频笔记”

明确：

> 视频笔记以 `note.type === "video"` 为主判据；`note.video` 作为辅助校验，不依赖 `videoList`。

### 7.5 修改第 9 节“必须先验证的假设”

可将未完成项收敛为：

1. 登录态下验证首页 modal 和搜索结果 modal 的实际 feed 响应、note ID 定位方式及缓存时序。
2. 获取至少一篇新发布和一篇历史实况图笔记，固定 `livePhoto`、`stream` 相关 fixture。
3. 用实际 MV3 扩展环境验证 MAIN-world 桥接、消息传递和 CDN host permissions。
4. 使用多个普通笔记样本验证 `fileId` 原图地址，并确认区域 host 的候选与回退顺序。

## 8. 建议的探针验收标准

进入正式功能开发前，探针至少应产出以下 fixture 和自动检查：

| Fixture | 必须验证 |
|---|---|
| 独立页普通图文 | 标题、正文、作者、互动、标签、全部图片、原图尺寸 |
| 首页 modal 普通图文 | modal 打开后能从预先缓存的数据中按 noteId 取回完整对象 |
| 搜索 modal 普通图文 | 与首页 modal 相同，并确认接口或字段差异 |
| 视频笔记 | `type === "video"`，归档流程在下载前拒绝 |
| 新实况图笔记 | `livePhoto` 判定字段及动态流位置 |
| 历史实况图笔记 | 新旧字段兼容性 |
| CDN 原图请求 | 无 Referer、扩展上下文、尺寸校验、Content-Type |
| 原图失败回退 | `fileId` 失败后能正确回退到 `WB_DFT` |

只有上述 fixture 固定后，`core/extractor.ts` 和图片 URL 选择逻辑才适合进入正式实现。
