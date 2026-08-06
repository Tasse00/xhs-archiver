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

## 8. 缩放交给 `react-zoom-pan-pinch`

自己写这套交互，锚点数学只是最容易的部分；真正费时的是手势状态机——pointer capture、
拖拽与 click 的竞争、触控板捏合（Chrome 转成带 `ctrlKey` 的 wheel）、缩放后的边界收敛、
连续滚轮的节流。这些不是本项目的价值所在，用成熟库。

选 **`react-zoom-pan-pinch@4`**。评估过的三个候选：

| | 结论 |
|---|---|
| **react-zoom-pan-pinch 4.0.4** | **选它。** 零运行时依赖，peer 只有 `react: "*"`（React 19 无碍），2026-08 仍在更新 |
| @panzoom/panzoom 4.6.2 | 零依赖、体积更小，但框架无关，ref 挂载／切图复位／百分比订阅这些 React 粘合层要自己写 |
| photoswipe 5.4.4 | **2024-05 之后没有更新**，且它是整套 lightbox，会替掉现有组件和翻图逻辑，改动面远超需要 |

代价要认下来：项目原本的运行时依赖只有 `react` / `react-dom`，非常干净，而这是个持有本地
文件系统读写权限的扩展，多一个第三方包就多一份供应链信任面（尽管 lightbox 库本身碰不到
FSA）。另外缩放逻辑进了库，就不再适用项目「核心层纯函数可测」那条约定，改为信任上游 ——
所以**不再有 `src/core/browse/zoom.ts`**。

`react-zoom-pan-pinch` 加进 `package.json` 的 `dependencies`。

## 9. 四个必须知道的库实现细节

这三条都是拆包看 `dist/` 源码确认的，不写下来实现时一定会踩。

### 9.1 `TransformComponent` 的 wrapper 与 content 默认是 `fit-content`

库注入的样式里：

```css
.transform-component-module_wrapper__… { position: relative; width: fit-content; height: fit-content; overflow: hidden; }
.transform-component-module_content__…  { display: flex; width: fit-content; height: fit-content; transform-origin: 0% 0%; }
```

**两层都按内容自然尺寸收缩，不会填满父容器。** 直接用的话，img 的 `max-height: 100%`
又没有了参照——跟 §7 那个 grid 循环是同一类毛病，等于换了个姿势重演。

所以必须显式撑开，库提供了 `wrapperStyle` / `contentStyle` 两个 prop：

```tsx
<TransformComponent
  wrapperStyle={{ width: '100%', height: '100%' }}
  contentStyle={{ width: '100%', height: '100%' }}
>
  <img src={url} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
</TransformComponent>
```

这样 **fit 由 CSS 的 `object-fit: contain` 负责，缩放由库负责**，两者不打架。

外层那个容器同时也要脱掉 §7 里坏掉的 grid：

```css
.bw-lb-img { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; }
```

`padding: 12px` 去掉——有了自由缩放，靠 padding 留白没有意义。

### 9.2 于是「scale = 1」意味着 fit，不是 1:1 原始像素

这是上一条的直接后果，也是与初版设计最大的语义差别。库的 `scale` 是**相对 fit 后尺寸**
的倍率。要在顶栏显示真实百分比，得自己换算：

```
真实百分比 = scale × (图片渲染宽度 / naturalWidth) × 100
```

**「必须用 `naturalWidth`」这条依然成立，只是用途变了**：不再用来算 fit 倍率（CSS 接管了），
而是用来把库的 scale 换算成使用者能理解的百分比。仍然**不能用 `ImageRecord.width/height`**
——同一个 Lightbox 被评论配图复用（`DetailPane` 的 `onOpenImages`），而项目已记着一条
实测事实：评论图的声明尺寸是**展示尺寸**，284×367 的图实际是 556×717。

顶栏那行元数据文字继续显示 `ImageRecord` 里的声明值，它是**归档记录**，不是渲染依据，
两者不要混。

### 9.3 库对 content 里的 `img` 设了 `pointer-events: none`

拖拽由 wrapper 接管，img 不再是 pointer 事件的目标。但**外层 `.bw-lightbox` 的
`onClick={onClose}` 仍然会收到冒泡**，所以 wrapper 那一层还是要 `stopPropagation`，
否则拖完松手就把看图器关了。点背景关闭这个行为要保留。

### 9.4 样式是 import 时运行时注入的

模块顶层调用 `styleInject()`，`document.createElement('style')` 塞进 `<head>`。MV3 的
默认 CSP 是 `script-src 'self'; object-src 'self'`，不含 `style-src`，所以注入 `<style>`
不受限制。**但这是验收时要第一个确认的东西**——浏览页打开看图器，图能正常缩放即说明
样式注入成功了；若整块布局塌掉，先去 console 看有没有 CSP 报错。

## 10. 组件配置

```tsx
<TransformWrapper
  minScale={1}          // 1 就是 fit，比 fit 还小没有意义
  maxScale={8}
  limitToBounds={true}  // 用库调好的边界收敛，不自己写
  centerOnInit={true}
  doubleClick={{ mode: 'toggle' }}
  wheel={{ step: 0.2 }}
>
```

- `minScale={1}`：因为 scale=1 已经是「完整显示」，再往下缩只会让图变成屏幕中间一小块。
  这跟初版设计的 `fit × 0.5` 下限不同，是 §9.2 语义变化带来的必然结果。
- `limitToBounds` 用默认的 `true`。初版设计写的是「不做边界约束，靠复位按钮兜底」——那是
  自己写时为了回避粘滞手感做的妥协；库的边界收敛是调过的，没有理由退回妥协方案。
- `doubleClick.mode: 'toggle'` 正好是要的「fit ↔ 放大」双击切换，不用自己实现。

**切图时复位**：`index` 变化后调 `resetTransform()`（来自 `useControls()`），否则上一张
放大到 400% 的状态会套到下一张身上。

**顶栏控件**：`⊖`（`zoomOut`）· 百分比 · `⊕`（`zoomIn`）· `⤢`（`resetTransform`），
四个 handler 全部来自 `useControls()`。百分比用 `useTransformComponent(s => s.scale)`
订阅，按 §9.2 换算后显示。注意这些 hook 必须在 `TransformWrapper` **内部**的组件里调用，
所以顶栏那一行要拆成一个子组件放进 wrapper 里，或者改用 `children` 的 render-prop 形式。

**键盘**：现有的 `Esc` / `←` / `→` 保留在外层 `useEffect` 里不动。

## 11. 不做的事

- **不做缩略图条、旋转、下载**。都超出「看清这张图」这个目标。
- **不用库自带的 `MiniMap`**。详情栏本来就窄，再挂一个缩略导航图只会挤掉看图空间。
- **不自己实现捏合手势**。库的 `pinch` 配置已经覆盖，触控板捏合走 Chrome 转出的
  `ctrlKey` wheel，同样由库处理。

## 12. 测试

缩放逻辑在库里，不为它写单测——那等于测上游。这块由验收清单覆盖：

- 一张竖长图（比如 1080×1920）打开后**整张完整可见**，这是本次要修的主问题
- 滚轮能放大、能拖拽、双击能切换、`⤢` 能复位
- 左右翻图后倍率回到 fit
- 评论配图（声明尺寸不准的那批）打开后同样完整可见，百分比数字合理

`tests/browser/detail-pane.test.ts` 已有的用例要确认不被组件结构调整弄挂。

---

## 13. 要同步改的文档

- `CLAUDE.md`：
  - 决策表加两条：**采集开关默认开、关掉只是跳过该步，既不阻断归档也不影响仓库里的旧
    数据**；**看图器的缩放交给 `react-zoom-pan-pinch`，不要自己实现手势**（附上
    photoswipe 已停更、@panzoom 要自己写粘合层这两条否决理由）。
  - 实测硬事实补两条：**`TransformComponent` 的 wrapper/content 默认 `fit-content`，
    不覆盖成 `100%` 就会重演「图片撑爆容器」**；**看图器的尺寸只能取 `naturalWidth`，
    `ImageRecord` 的声明尺寸对评论图不准**。
- `README.md`：如有对侧边栏顶栏或设置项的描述，跟着改。
- `package.json`：新增 `react-zoom-pan-pinch` 依赖。
