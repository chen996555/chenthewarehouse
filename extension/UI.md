# Side Panel 工作台 UI 实现笔记

求职星浏览器扩展（`extension/sidepanel.html` + `sidepanel.js`）的页面式工作台 UI 技巧整理。核心：**纯 CSS + 内联 SVG，零第三方 UI 库**。形态是 Chrome Side Panel（独立页面，无 Shadow DOM 隔离需求）。

## 1. 匹配度环 —— conic-gradient 扇形

不用 SVG，一个 `conic-gradient` 画出按分数填充的进度环。

```css
.ring { width: 46px; height: 46px; border-radius: 50%; position: relative; display: inline-flex; align-items: center; justify-content: center; }
.ring-in { position: absolute; inset: 4px; border-radius: 50%; background: #fff; }  /* 挖空成环形 */
.ring .val { position: relative; z-index: 1; font-size: 13px; font-weight: 700; }
```

JS 侧按分数生成背景（`sidepanel.js` 的 `workbenchCard()`）：

```js
const score = Math.max(0, Math.min(100, Number(j.score) || 0));
const ringColor = { A:'#22c55e', B:'#1456F0', C:'#f59e0b', D:'#ef4444' }[j.tier] || '#94a3b8';
`<div class="ring" style="background: conic-gradient(${ringColor} 0 ${score}%, #eef1f5 ${score}% 100%)">…`
```

原理：`conic-gradient(色 0 X%, 灰 X% 100%)` = 前 X% 扇形彩色、剩余浅灰。`score` 来自后端 `tracker/scorer.js` 的 `tierJob()`（0-100）。

## 2. 玻璃拟态（Glassmorphism）—— backdrop-filter

毛玻璃通透感，用于导航 pill 和强调卡片（`.glass-card` / `.nav-item` / `.foot`）：

```css
.glass-card {
  background: rgba(255,255,255,.72);
  backdrop-filter: blur(16px) saturate(160%);
  border: 1px solid rgba(255,255,255,.5);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,.08);
}
```

注意：半透明玻璃只用于「强调卡片」；**内容密集界面**（投递列表、漏斗）用高不透明度白卡片（`.apply-item` `rgba(255,255,255,.9)`）保证可读性。

## 3. 飞书配色（主色 + 灰阶）

对齐飞书（字节）官方设计规范：

| 角色 | 色值 |
|---|---|
| 主色（按钮/激活/链接）| `#1456F0` |
| 主色 hover | `#133D9A` |
| 顶部 head 渐变 | `#3470FF → #1456F0` |
| 主文字 | `#1F2329` |
| 次要文字 | `#646A73` |
| 弱文字/占位 | `#8F959E` |
| 背景 | `#f5f6f7` |

分档配色（匹配度环/状态标签，语义色）：

| 档位 | 语义 | 色值 |
|---|---|---|
| A 强推 | 绿 | `#22c55e` |
| B 建议投 | 蓝 | `#1456F0` |
| C 备选 | 橙 | `#f59e0b` |
| D 跳过 | 红 | `#ef4444` |
| 未知/环底 | 灰 | `#94a3b8` / `#eef1f5` |

## 4. SVG 线条图标（Lucide 风格）

emoji 换成内联 SVG 线条图标，`stroke="currentColor"` 跟随文字色：

```html
<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
</svg>
```

```css
.ico { width: 16px; height: 16px; flex-shrink: 0; }
```

图标定义集中在 `sidepanel.js` 的 `ICONS` 对象（search/file/image/download/star/list/chart），导航/按钮/标题里 `${ICONS.xxx}` 引用。容器用 flex + gap 让图标和文字居中。

## 5. 页面式布局（导航 + 视图）

```
┌─ head（头像 + 名字 + 状态，飞书蓝渐变）─┐
├─ nav（简历/推荐/投递/看板，GlassPill）─┤
├─ view（视图区，随导航切换）─────────────┤
├─ progress（进度）──────────────────────┤
└─ foot（推荐岗位 + 填表单）─────────────┘
```

视图切换 `switchView()`：清空 `#view` 重渲染对应视图。**推荐状态存全局 `recState`**（`idle/running/done/error` + liveJobs + result），切视图不丢进度/结果。

## 复用提示

- 换头像 → ①简历页「上传头像」（存 `chrome.storage.local.avatar`），或直接替换 `extension/avatar.svg`
- 改卡片布局 → `sidepanel.js` 的 `workbenchCard()` + `.wb-card` 系列 CSS
- 改配色 → 替换 `sidepanel.html` 里那组 hex，保持「飞书蓝主色 + 语义分档色」映射即可
- 加图标 → `sidepanel.js` 的 `ICONS` 对象加一条，参考 Lucide 图标库的 path
