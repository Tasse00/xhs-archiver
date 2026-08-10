import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../../src/browser/browser.css', import.meta.url)), 'utf8');

/** 取出某个选择器的声明块。只有精确匹配的单选择器规则，够用且不必引 CSS parser。 */
function ruleOf(selector: string): string {
  const m = css.match(new RegExp(`(^|\\n)\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  if (m === null) throw new Error(`browser.css 里找不到 ${selector} 的规则`);
  return m[2];
}

/*
 * 守的是浏览页那条竖向布局链：.bw → .bw-main → .bw-list → .bw-table → .bw-scroll。
 * 列表虚拟化，.bw-scroll 内部撑着 refs.length * 44px 的占位块，所以链子上任何一环
 * 只要能被内容撑开，滚动就落不到 .bw-scroll 身上。
 *
 * .bw-table 是 .bw-list（column flex）里的伸缩项，不写 min-height 就取默认的
 * auto——在主轴上 auto 会解析成「内容的最小尺寸」，也就是占位块那个高度，flex-shrink
 * 压不下去。实测（900px 视口 / 200 行）：.bw-list 高 894，.bw-table 被撑到 8859，
 * .bw-scroll 的 clientHeight 等于 scrollHeight 等于 8800 —— 没有溢出，自然没有滚动条，
 * 「共 N 篇」那行页脚被顶到 8865px 完全跑出视口。补上 min-height: 0 后 .bw-table 收回
 * 894，clientHeight 835 < scrollHeight 8800，滚动恢复，页脚也回到视口内。
 *
 * 行数少于一屏时表现正常，所以这个 bug 只在真实仓库上才看得见，单测又跑在 node 里
 * 没有排版引擎——只能守住这一行声明本身。
 */
describe('浏览页竖向布局链', () => {
  it('.bw-table 显式声明 min-height: 0，否则列表滚不动', () => {
    expect(ruleOf('.bw-table')).toMatch(/min-height:\s*0/);
  });

  it('.bw-scroll 仍是那个滚动容器', () => {
    const r = ruleOf('.bw-scroll');
    expect(r).toMatch(/overflow-y:\s*auto/);
    expect(r).toMatch(/min-height:\s*0/);
  });
});
