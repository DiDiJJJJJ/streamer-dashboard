# 看板 UI 交互灵动性优化方案

> 目标：在不改动信息架构与数据逻辑的前提下，通过统一的 hover 视觉反馈（放大 / 发光 / 位移 / 变色）提升后台操作灵动感；全部动效仅过渡 GPU 友好属性，适配数据密集表格、侧边导航与操作工具栏等桌面后台场景。
> 落地位置：`src/index.css`（动效系统）+ 各组件（挂载 `.fx-*` 工具类）。

---

## 一、布局结构规划

保持现有「左侧固定导航 + 顶部操作栏 + 主内容区」的后台框架不变，仅在**交互层**做增强：

| 区域 | 结构 | 本次增强 |
|------|------|----------|
| 侧边导航 | 固定深色栏（`fixed left-0`，深 slate 渐变） | 导航项 hover 右移 + 左侧指示条生长 |
| 顶栏 | 站点标题 + 导入/同步按钮 + 更新时间 | 主按钮光晕、导入按钮上浮 |
| 主内容区 | 卡片网格 + 表格 + 工具栏 | 卡片上浮、按钮/筛选 chip 缩放、表格行强调条 |
| 工具栏 | 日期筛选 / 搜索 / 下拉 / 分页 / 赛道筛选 | 控件聚焦光环、chip 放大 |
| 表格 | 数据密集行（可滚动） | 行 hover 左侧内嵌强调条（不缩放，防抖动） |

**设计原则**：大面积容器（整块面板）只做边框/光晕高亮、不位移；小组件（按钮、卡片、chip）才做位移与缩放，避免大面积跳动造成视觉疲劳。

---

## 二、配色风格定义

沿用并强化现有品牌蓝主色体系，动效中的发光与强调统一以品牌蓝 `#2563eb` 为基准，语义色仅用于其对应场景：

| 角色 | 色值 | 用途 |
|------|------|------|
| 品牌主色 | `#2563eb`（brand-600） | 导航高亮、按钮、光晕、强调条、聚焦光环 |
| 品牌浅色 | `#eff6ff`~`#bfdbfe`（brand-50~200） | 卡片底色、hover 浅底 |
| 成功 | `#10b981` | 达标/通过态、绿色卡片 |
| 警告 | `#f59e0b` | 保底金额、需关注项 |
| 危险 | `#ef4444` | 离职、清空、危险操作 |
| 表面/背景 | `#ffffff` / `#f4f7fb` | 卡片/页面底色 |
| 边框 | `#e6ecf4` | 分隔线、卡片描边 |

光晕变量（见 `@theme`/`:root`）：
- `--fx-glow-brand: 0 8px 24px -8px rgba(37,99,235,.45)`（主按钮）
- `--fx-glow-brand-sm: 0 4px 14px -6px rgba(37,99,235,.40)`（卡片/普通按钮）
- `--fx-glow-amber` / `--fx-glow-danger`：语义场景备用

---

## 三、组件层级划分

按「层级 → 动效强度」划分，强度自上而下递减：

1. **导航层（Sidebar）**：`fx-nav` — 位移 + 指示条，作为页面级锚点，动效最克制但持续可见。
2. **卡片层（StatCard / 指标卡 / 赛事卡 / KPI 卡 / TOP3）**：`fx-card` — 上浮 + 微缩放 + 边框高亮 + 光晕，是信息主载体。
3. **面板层（大块容器：主播数据概况、表格区、同步各分区）**：`fx-panel` — 仅边框/光晕，不位移。
4. **工具栏/筛选层（赛道筛选、tab、搜索框）**：`fx-chip`（筛选）+ 全局聚焦光环（输入框）。
5. **按钮层（CTA / 操作按钮）**：`fx-glow`（主行动）/ `fx-lift`（次级）/ `fx-pop`（图标/危险小按钮）。
6. **表格层（数据行）**：全局 `tbody tr` 左侧强调条 + 已有 hover 底色，无缩放。
7. **表头层（可排序 th）**：`fx-th` — 变色 + 轻微上移。

---

## 四、动效规范

### 4.1 时长与时长档位

| 变量 | 值 | 用途 |
|------|----|------|
| `--fx-dur-fast` | 140ms | 按下（:active）瞬时反馈 |
| `--fx-dur-base` | 200ms | 默认 hover 过渡（绝大多数交互） |
| `--fx-dur-slow` | 320ms | 预留给更复杂的展开/入场（当前未启用） |

### 4.2 缓动曲线

| 变量 | 曲线 | 适用 |
|------|------|------|
| `--fx-ease-out` | `cubic-bezier(.22,1,.36,1)` | 默认，平滑减速收尾 |
| `--fx-ease-spring` | `cubic-bezier(.34,1.4,.64,1)` | 回弹（图标按钮预留） |
| `--fx-ease-smooth` | `cubic-bezier(.4,0,.2,1)` | 标准对称过渡 |

### 4.3 过渡属性（统一基类）

所有 `.fx-*` 类共享：
```
transition-property: transform, box-shadow, background-color, border-color, color, filter;
transition-duration: var(--fx-dur-base);
transition-timing-function: var(--fx-ease-out);
```
> 仅过渡上述合成层属性，**不**动画 `width/height/margin/padding` 等触发布局的属性，保证数据密集表格与长列表滚动流畅。

### 4.4 工具类触发范围与效果明细

| 类 | 触发（hover 除非注明） | 效果 | 适用元素 |
|----|------|------|----------|
| `.fx-lift` | hover | `translateY(-1px) scale(1.02)` + 品牌光晕；`:active` `scale(.97)` | 次级按钮、导入、查询、分页、弹窗按钮 |
| `.fx-glow` | hover | `translateY(-1px) scale(1.025)` + 强品牌光晕 + `saturate(1.08)` | 主行动按钮（同步、添加活动、添加房间） |
| `.fx-pop` | hover | `scale(1.08)` + 光晕；`:active` `scale(.92)` | 图标/圆形按钮（菜单、折叠、移除、删除、进入、查看） |
| `.fx-iconbtn` | hover | `scale(1.12)` + 变色为品牌蓝 | 小图标按钮（预留） |
| `.fx-card` | hover | `translateY(-3px) scale(1.006)` + 光晕 + 边框高亮 | 指标卡、赛事卡、TOP3、周面板、KPI 卡、StatCard |
| `.fx-panel` | hover | 仅边框高亮 + 柔光（不位移） | 大块容器面板 |
| `.fx-chip` | hover | `scale(1.035)` + 光晕 | 赛道筛选、tab 切换 |
| `.fx-nav` | hover | `translateX(4px)` + 浅底 + 左侧指示条生长；激活项 `is-active` 常驻指示条 | 侧边导航项 |
| `.fx-th` | hover | 变色为品牌蓝 + `translateY(-1px)` | 可排序表头 |
| 全局 `tbody tr` | hover | 首列内嵌强调条 `inset 3px 0 0 品牌蓝` + 已有底色 | 所有数据表格行 |
| 全局 `input/select/textarea` | focus | 叠加 `0 0 0 3px rgba(37,99,235,.18)` 聚焦光环 | 所有输入控件 |

### 4.5 性能与可访问性

- **GPU 加速**：动效全部走 `transform` / `box-shadow` / `background` / `color` / `filter`，由合成器处理，避免主线程布局重排。
- **减弱动效**：`@media (prefers-reduced-motion: reduce)` 下关闭位移与过渡时长（保留可用性），尊重系统级无障碍设置。
- **桌面优先**：针对鼠标 hover 设计；触屏无 hover 时退化为静态（点击仍可用），不依赖动效传达功能。

---

## 五、已应用范围（本次改动文件）

- `src/index.css`：新增「交互灵动性动效系统」整段（令牌 + 工具类 + 全局表格/输入规则 + 减弱动效守卫）。
- `Sidebar.jsx`：导航项 `fx-nav` + 激活指示条、折叠按钮 `fx-pop`。
- `Header.jsx`：导入 `fx-lift`、同步 `fx-glow`、菜单 `fx-pop`。
- `Dashboard.jsx`：概览卡 `fx-card`、面板 `fx-panel`、表头 `fx-th`、分页 `fx-lift`。
- `StreamersList.jsx`：6 张指标卡 `fx-card`、面板 `fx-panel`、tab `fx-chip`、添加 `fx-glow`、查询/导入/粘贴 `fx-lift`、移除 `fx-pop`。
- `ChallengePage.jsx`：赛事卡/概览卡/TOP3/周面板/内卡 `fx-card`、添加活动 `fx-glow`、进入 `fx-lift`、删除 `fx-pop`、赛道筛选 `fx-chip`。
- `SyncPage.jsx`：`btn` 常量统一 `fx-lift`（约 12 个按钮）、StatCard `fx-card`、分区面板 `fx-panel`、确认弹窗 `fx-card` + 按钮 `fx-lift`。
- `AgentDashboard.jsx`：顶部卡 `fx-card`、饼图/数据面板 `fx-panel`、KPI 卡 `fx-card`、图例行 `fx-lift`、查看 `fx-pop`。

刷新看板（建议 **Ctrl+Shift+R**）即可体验统一后的 hover 灵动反馈。
