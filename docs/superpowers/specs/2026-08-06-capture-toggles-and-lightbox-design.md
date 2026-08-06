# 采集开关与看图器缩放 —— 设计

日期：2026-08-06

本文是 `2026-08-03-xhs-archiver-design.md` 的补充，只覆盖两件互不相干的使用体验改进：

1. 侧边栏顶栏重排，并新增一个「设置」页，让使用者能关掉作者信息、分享链接这两步采集
2. 浏览页看图器修掉「大图显示不完整」，并加上缩放与平移

与主设计文档冲突时，本文在这两个范围内为准，其余一律以主设计文档为准。

---

# 第一部分：采集开关

## 1. 目标与动机

作者信息与分享链接这两步都靠**合成事件驱动页面自己走流程**（见
`2026-08-06-author-card-design.md`、`2026-08-06-share-link-design.md`）。这类实现对
页面 DOM 结构和交互时序有强依赖：小红书改一次前端，触发元素选不中、面板不弹、等待超时，
这两步就会各自空转数秒才失败。

现在没有任何办法绕开它们。虽然两步都不阻断归档（失败只是不写对应字段），但**每采一篇都要
白等一遍超时**，而且页面上会闪出卡片和分享面板，干扰使用者。

所以要给出一个开关：**平台改版把某一步弄坏时，使用者可以自己关掉它，采集立刻恢复顺畅**，
不必等插件发新版。

## 2. 顶栏重排

现在的顶栏是：`· 笔记归档`（品牌）→ 仓库 chip → 采集者 chip → 浏览 → 刷新。

改成：**仓库 chip → 采集者 chip → …… → 设置 → 浏览 → 刷新**。

- 删掉 `.pt-brand` 整块（含那个小圆点）。侧边栏只有一个，标题不承载信息。
- 两个 chip 用一个 `.pt-chips` 容器包住，由它接管原先挂在 `.pt-brand` 上的
  `margin-right: auto`。
- **`.pt-chips` 在未配置完成时也要渲染**（内容为空）。chip 只在 `configured` 时出现，
  如果容器跟着一起消失，撑开的 `margin-right: auto` 也没了，右侧三个图标会塌到左边——
  首次配置阶段的顶栏会看着像坏了。
- 设置按钮（齿轮图标，新增 `IconGear`）与浏览按钮一样，只在 `configured` 时出现。
  没选仓库、没设采集者的人先要走完配置，这时把采集选项摆出来只是干扰。

## 3. 设置页

新增组件 `CaptureSetup`，放进 `src/sidepanel/components/Setup.tsx`，与
`CollectorSetup`/`PathSetup` 并列，由 `App.tsx` 的 `editingCapture` 状态切换。

页面内容只有两个开关：

| 开关 | 关掉之后 |
|---|---|
| 采集作者信息 | 跳过作者卡片那一步。`note.json` 的 `author` 只剩 `AuthorBase`（身份四件套），`AuthorCardFields` 那些可选字段——简介、三个计数、`counts_raw`、`card_fetched_at`——一个都不写。这正是 `ArchivedAuthor = AuthorBase & Partial<AuthorCardFields>` 已经允许的形态，数据结构不用动 |
| 采集分享链接 | 跳过分享面板那一步。`note.json` 不写 `share_url` |

两个开关默认都开。

**这一页的开关一拨就立即落盘，页面上只有一个「返回」按钮**，没有「保存」。这跟同目录下
`CollectorSetup`/`PathSetup` 的「填完点保存」不一样，是刻意的：那两个页面有输入校验、
存在「填了一半不合法」的中间态，所以需要提交语义；布尔开关没有这回事，加一层保存只是让
使用者多点一次。

页面文案要写清三件事，缺一件使用者就会误解：

- 关掉之后这一步**整个跳过**，采集会更快
- **已经采过的笔记不受影响**，仓库里的旧数据不会被改动
- 这是给「平台改版把这一步弄坏了」准备的逃生口，正常情况下保持开启

## 4. 数据层

`src/core/settings.ts` 的 `Settings` 接口加两个字段：

```ts
export interface Settings {
  collector: string | null;
  datasetPath: string | null;
  captureAuthor: boolean;
  captureShare: boolean;
}
```

`KEYS` 相应加两项。`loadSettings` 里**缺 key 一律读成 `true`**：

```ts
captureAuthor: typeof raw.captureAuthor === 'boolean' ? raw.captureAuthor : true,
```

已经在用的人 storage 里没有这两个 key，读成 `false` 等于静默关掉他们本来就有的能力。

`saveSettings` 原样写入，不做校验（布尔值没什么可校验的）。注意它接收的是完整
`Settings` 对象，所以 `App.tsx` 里现有的两处调用（`saveCollector`、`savePath`）都要
带上这两个字段的当前值，否则一改采集者 ID 就会把开关重置掉。

## 5. 采集流程

`App.tsx` 的 `doArchive` 里，两段页面交互各自加一道前置判断：开关为 `false` 就整段跳过，
**连 `setPageStep` 都不调**——关掉了还闪一句「正在读取作者信息…」是错的。

结果类型从两态改三态。不要把「关掉了」塞进 `AuthorReadFailure` / `ShareReadFailure`
枚举：那两个枚举描述的是**页面交互怎么失败的**，而「使用者关掉了」根本没发生过交互，
混进去会让 `AUTHOR_FAIL` 这类文案表退化成一张什么都往里塞的字典。

```ts
export type AuthorOutcome =
  | { kind: 'ok'; fans: number; interaction: number; approximate: boolean }
  | { kind: 'skipped' }
  | { kind: 'fail'; reason: AuthorReadFailure };

export type ShareOutcome =
  | { kind: 'ok'; url: string }
  | { kind: 'skipped' }
  | { kind: 'fail'; reason: ShareReadFailure | ShareUrlFailure };
```

`NoteView.tsx` 的 `Result` 组件按三态渲染，`skipped` 显示成灰字「已在设置中关闭」——
它不是失败，不能带失败的颜色和「重采可以再试」那句话。

初值也要跟着改：现在两个变量的初值是 `{ ok: false, reason: 'inject_failed' }`，
改成 `{ kind: 'fail', reason: 'inject_failed' }`。初值必须是失败态而不是 skipped，
`tabId` 拿不到之类的岔路走的就是初值，那是真失败。

## 6. 测试

- `tests/core/settings.test.ts` 补三条：缺 key 时两个开关都读成 `true`；`false` 能存
  能读回；改采集者 ID 不会把开关冲掉（调用方传全量对象的行为）。
- 跳过逻辑落在 `App.tsx` 里，碰 `chrome.*`，按项目约定不进 Vitest。它由验收清单覆盖：
  关掉作者开关后采一篇，确认页面上不再闪卡片、结果卡显示「已在设置中关闭」、
  `note.json` 里没有卡片字段。

---

# 第二部分：看图器

## 7. 「显示不完整」的根因

`browser.css` 里：

```css
.bw-lb-img { flex: 1 1 auto; min-height: 0; display: grid; place-items: center; padding: 12px; }
.bw-lb-img img { max-width: 100%; max-height: 100%; object-fit: contain; }
```

看着像是能装下，实际不能。`place-items: center` 让 grid item 不再 stretch，于是那条
`auto` 行的高度按 item 的 max-content 算；而 item 的 `max-height: 100%` 又要反过来
参照行高——循环解析的结果是 `max-height` 退化成 `auto`，行高变成图片的**自然高度**。
竖长图（小红书大量 1080×1440 以上）就此撑爆容器，底部被 `.bw-lightbox` 裁掉。

所以这不是「要不要加缩放」的问题，**底层布局本身是坏的**，两件事一起修。

## 8. 布局改法

```css
.bw-lb-img { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; }
```

图片改 absolute 定位，用 transform 做居中、缩放与平移：

```css
.bw-lb-img img {
  position: absolute; left: 50%; top: 50%;
  transform-origin: center; will-change: transform;
}
```

```
transform: translate(-50%, -50%) translate(Xpx, Ypx) scale(S)
```

这样容器高度完全由 flex 链决定，图片不再参与撑高，循环解析的问题从根上没有了。
`padding: 12px` 去掉——有了自由缩放，靠 padding 留白没有意义，反而让 fit 倍率算起来
要多减一层。

## 9. 尺寸来源：必须用 `naturalWidth` / `naturalHeight`

**不能用 `ImageRecord.width/height`。** 同一个 Lightbox 也被评论配图复用
（`DetailPane` 的 `onOpenImages`），而项目里已经记着一条实测事实：评论图的声明尺寸是
**展示尺寸**，284×367 的图实际是 556×717。拿元数据算 fit 倍率，评论图会整批算错。

所以在 `<img onLoad>` 里读 `naturalWidth`/`naturalHeight` 存进 state，图片没加载完之前
不渲染缩放层（显示「正在解码…」）。顶栏那行元数据文字仍然显示 `ImageRecord` 里的声明值，
它是**归档记录**，不是渲染依据，两者不要混。

## 10. 缩放模型

状态三个数：`scale`、`tx`、`ty`（后两个是相对容器中心的像素偏移）。

- **fit 倍率** = `min(cw / nw, ch / nh, 1)`。带 `1` 这个上限是因为「完整显示」对小图
  就该是原始像素，把 200×200 的图铺满屏幕只会糊成一片。
- **范围**：下限 `fit × 0.5`，上限 `8`。下限跟着 fit 走而不是取固定值，是因为超长图的
  fit 本身就可能只有 0.15，固定下限会让它根本缩不小。
- **滚轮**：以光标为锚点。设光标相对容器中心为 `(mx, my)`，倍率从 `s1` 变到 `s2`，则
  `tx' = mx - (mx - tx) × s2 / s1`，`ty` 同理。不做锚点补偿的话，放大时目标会往外跑，
  手感完全不对。
- **拖拽**：`pointerdown/move/up` + `setPointerCapture`。
- **双击**：在 fit 与 `1.0`（1:1 原始像素）之间切换，切到哪一档都把 `tx/ty` 归零。
- **顶栏控件**：`⊖`、当前百分比、`⊕`、`⤢`（复位到 fit）。百分比是
  `Math.round(scale × 100)`，1:1 时正好显示 100%。
- **键盘**：现有的 `Esc` / `←` / `→` 保留，加 `+` `-` `0`（`0` = 复位）。
- **切图或换笔记时复位到 fit**：`index` 一变就重置三个数，否则上一张放大到 400% 的
  状态会套到下一张身上。
- **容器尺寸变化**（拖动详情栏分隔条、改窗口大小）用 `ResizeObserver` 跟踪。处于 fit
  状态时跟着重算 fit 倍率；已经手动缩放过就不动，使用者定的倍率不该被窗口变化改掉。

**平移不做边界约束。** 约束写不好就是「拖到边缘忽然拖不动」的粘滞手感，而这里有复位
按钮、双击和 `0` 键三条退路，把图拖飞了随时能拉回来。

## 11. 拖拽与关闭的冲突

`.bw-lightbox` 最外层挂着 `onClick={onClose}`，图片区靠 `stopPropagation` 挡住。加了
拖拽之后这条会出问题：**按住图片往外拖、在图片区之外松手，浏览器会把 click 派发到共同
祖先**，也就是外层，于是看图器直接关掉。

处理办法：拖拽过程中把「已经拖动过」记在 ref 上，在外层的 click 处理里消费掉一次并
直接返回。用 ref 而不是 state——click 紧跟 pointerup 同帧到达，state 更新赶不上。

单纯的 pointerdown/up 不算拖动（要有实际位移才算），否则点一下图片就再也关不掉了。

## 12. 缩放数学抽成纯函数

放到 `src/core/browse/zoom.ts`，不碰 DOM，按项目约定能在 Vitest 下跑：

```ts
export interface View { scale: number; tx: number; ty: number }

/** 完整装进容器的倍率，不放大小图 */
export function fitScale(container: Size, image: Size): number;

/** 把倍率夹进 [fit × 0.5, 8] */
export function clampScale(s: number, fit: number): number;

/** 以容器内某点为锚点缩放，返回新的 View */
export function zoomAt(view: View, point: Point, factor: number, fit: number): View;
```

React 组件只管事件绑定与渲染。测试 `tests/core/browse/zoom.test.ts` 覆盖：宽图/长图/
小图的 fit 倍率、上下限夹取、锚点补偿后锚点在屏幕上不动、fit 倍率变化时夹取跟着变。

## 13. 不做的事

- **不引入缩放库**（panzoom 之类）。要的只是三个数和两个公式，一个依赖不值得。
- **不做双指捏合手势**。浏览页跑在桌面上，触控板的捏合本来就会被浏览器转成带
  `ctrlKey` 的 wheel 事件，走滚轮那条路即可。
- **不做缩略图条、旋转、下载**。都超出「看清这张图」这个目标。

---

## 14. 要同步改的文档

- `CLAUDE.md`：决策表加两条（采集开关默认开、关掉不阻断归档也不影响旧数据；看图器平移
  不做边界约束）；实测硬事实里补一条「看图器的尺寸只能取 `naturalWidth`，`ImageRecord`
  的声明尺寸对评论图不准」。
- `README.md`：如有对侧边栏顶栏或设置项的描述，跟着改。
