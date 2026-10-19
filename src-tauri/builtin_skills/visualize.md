---
name: Visualize
description: 当用户想“看”结果、要求画图/图表/可视化/模拟/演示/对比/可调参数/UI mockup，或任何内容用视觉呈现会更直观时主动调用。数据、趋势、流程、算法、关系图、方案比较、布局设计和交互概念都应优先考虑；首次使用 render_html 前必须调用。仅纯文字已足够或用户明确要求真实项目交付物时跳过。
---

用 `render_html` 在对话中构建用户可直接操作的小型可视化界面。

## 一条原则

**一切服务于你想表达的内容。** 先把“要让人看到什么、理解什么、能动手试什么”想清楚，再决定形式——形式可以是数据图、示意图、算法动画、可玩的模拟、界面草图，也可以只是排得好看的一段文字，没有哪种是默认答案。不要因为常见就把内容塞进同一个形状，也不要把任何内容都掰成“滑块 + 一张图”。

## 什么时候使用

- 采用高召回策略：只要可视化能让用户更快理解、比较、探索或做决定，就主动使用，不必等到文字完全无法表达。
- 用户说“给我看看”“画出来”“做个图”“模拟一下”“对比一下”“让我调参数”“做个界面看看”“mockup”“dashboard”“chart”“visualize”等意图时，默认应调用。
- 遇到数据、趋势、比例、时间变化、空间关系、算法过程、多个方案、参数影响、状态流转、UI/产品设计时，应主动判断是否用交互可视化补充答案。
- 用户没有明确要求也可以主动使用，只要可视化确实能提高理解；不要先询问“要不要做图”。
- 用户要真实网站、项目页面、组件或独立文件时，修改项目文件，不要用对话可视化代替交付物。
- 非常简单、两三句话就能说清的内容不必调用。关系图、流程图、架构图同样使用 render_html；项目没有 Mermaid 展示能力，不要输出 Mermaid 代码块代替可视化。

## 调用工具

将真实 HTML markup 直接放进 `fragment`，可选 `title` 和 `mode`。模型输出 fragment 时页面会在该工具调用所在的对话位置实时长出，完成后原位保留。

- 页面始终占满对话消息区可用宽度；`mode` 只表达内容意图和高度上限，不应通过固定宽度收窄页面。
- 默认 `mode: "inline"`；需要更宽画面时用 `mode: "wide"`。
- 只写 fragment，绝不输出 `<!doctype>`、`<html>`、`<head>`、`<body>`。
- `fragment` 的值就是页面源码本身：用真实换行，引号就是普通的 `"`，不要预先转义。工具调用的 JSON 编码由系统负责，多转义一层的话，字面的 `\n`、`\"` 会原样显示在页面上，脚本也会因此报语法错误。
- 根元素必须有唯一 ID；脚本用 `document.getElementById` 获取根，不依赖 `document.currentScript`。
- 用户可见的标签、控件、提示、图注使用当前对话主要语言。

## 安全与资源

- Inline `<style>` 和 `<script>` 可用。
- `fetch`、XHR、WebSocket、表单提交和嵌套页面被 CSP 禁止。
- 外部静态资源只允许固定并带版本的 CDN：`cdnjs.cloudflare.com`、`cdn.jsdelivr.net`、`esm.sh`、`unpkg.com`、`fonts.googleapis.com`、`fonts.gstatic.com`、`fonts.bunny.net`。
- Fragment 上限 1 MB。大数据先降采样：减少行数、分桶、降低小数精度、删除无用字段。

## 设计规范

- 采用 8px 间距节奏；留白是设计的一部分。
- 一个可视化只有一个焦点：先让信息量最大的东西最大、最清楚，其余退到背景里。
- 数值大、标签弱：数值是主角，标签用小字号和弱色退到背景；颜色只用于含义和当前状态，不做装饰。
- 排版跟着阅读顺序走：先说清“这是什么、怎么操作”，再呈现画面；读数和标注放在它解释的东西旁边。
- 宁可少一个面板，不要挤四个。
- 初始状态必须已经展示答案：合理默认值、已绘制、已填充，不给空画布等待用户输入。
- 动态数字使用 `font-variant-numeric: tabular-nums`，带单位、千位分隔和稳定小数位。
- 控件只在能改变理解时出现；一个状态只给一个控制机制。
- 内容占满可用宽度并在窄屏重排；避免固定外宽、`position: fixed`、视口高度和内部滚动条。
- 使用语义元素和原生可访问控件，不破坏键盘焦点。
- 不承载信息的装饰——没有含义的边框、网格线、图例、重复卡片——直接删掉。

## 与宿主融合

界面已经提供主题变量和基础样式，直接使用，视觉上就像应用自己长出来的。

颜色只用以下变量或 `light-dark(light, dark)`；不要自行声明 `color-scheme`：

- 表面/文字：`--background`、`--foreground`、`--card`、`--card-foreground`、`--muted-foreground`、`--border`
- 强调：`--primary`、`--primary-foreground`
- 数据序列：`--viz-series-1` 到 `--viz-series-6`；单指标与当前状态使用 `--viz-series-1`

基础类：`.card`（有必要时使用的单个局部容器；fragment 根与画面主体保持透明无框，卡片不能嵌套卡片）、`.viz-row` / `.viz-grid` / `.viz-controls`（排布）、`.viz-stat` / `.viz-stat-value`（数字）、`.viz-badge`（只读标签）、`.btn` / `.btn-primary` / `.btn-ghost`、`.form-label` / `.form-control` / `.form-select` / `.form-check`、`.text-small`、`.table-responsive`（只用于确实无法自适应的表格）。

控件与文字要长得像应用自己的——尺寸、字重、间距、状态都跟着主题走，不要另发明一套视觉语言：

```html
<div class="viz-controls">
  <button class="btn btn-primary" id="recompute">重新计算</button>
  <button class="btn btn-ghost" id="reset">复位</button>
  <label class="form-check"><input type="checkbox" id="show-raw" checked> 显示原始值</label>
  <span class="text-small">与基线相差 <span class="viz-badge">+12%</span></span>
</div>
```

## 动效是硬性验收项

每个可视化都必须有完整、连续、可中断、符合因果关系的动效；静默跳变、只给一次淡入、参数变化时整块重绘闪烁，都算未完成。动效与交互、视觉同时设计，不是最后贴上去的装饰。动效只解释变化（150–400ms ease-out），不做装饰性循环动画。

必须覆盖：首次出现（主内容按视觉层级进入，先结构后数据，总响应 300–500ms，不要所有元素从四面八方飞入）、按下反馈（`pointerdown` / `:active` 立即响应，不等 click，缩放到 0.97–0.985，80–120ms ease-out）、参数变化（操作过程中连续更新，改数据后原地过渡，禁止销毁重建）、状态切换（进入与退出走对称路径，从当前呈现值继续，不跳回逻辑起点）、完成/错误反馈（真实发生时才给，短促克制）。

运动原则：

- 响应优先：输入发生时立即反馈，绝不因动画锁住输入。
- 直接操控：拖动与指针 1:1 跟随，使用 Pointer Events 和 `setPointerCapture`，保留抓取偏移。
- **可中断性最重要**：动画中途再次操作，从当前呈现值继续；手势驱动用 `requestAnimationFrame` 或可重定向弹簧，不用无法接手当前速度的长 `@keyframes`。
- 默认临界阻尼：普通 UI 用无过冲弹簧（damping ≈ 1.0、response 0.3–0.4s）；只有真实携带动量的交互（拖拽释放、轻扫）允许轻微弹跳。
- 速度交接、空间一致性、柔性边界：释放后继承速度并按预测落点吸附；元素从哪来就沿同一路径回去；拖过边界逐渐加阻力。
- 动画尽量只修改 `transform` 和 `opacity`，避免布局抖动和大面积重排。

普通状态反馈：

```css
.interactive {
  transition: transform 120ms ease-out, opacity 180ms ease-out,
              background-color 180ms ease-out, color 180ms ease-out;
  transform-origin: center;
}
.interactive:active { transform: scale(0.975); }
.viz-enter { animation: viz-enter 380ms cubic-bezier(.2,.7,.3,1) both; }
@keyframes viz-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
```

连续、可中断的数值或位置变化用弹簧推进器；新输入只更新 `state.target`，现有动画自然转向，不要开第二条互相争抢的动画：

```js
function springTo(state, target, render) {
  state.target = target;
  if (state.running) return;
  state.running = true;
  var last = performance.now();
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.032);
    last = now;
    var acceleration = 240 * (state.target - state.value) - 30 * state.velocity;
    state.velocity += acceleration * dt;
    state.value += state.velocity * dt;
    render(state.value);
    if (Math.abs(state.target - state.value) < 0.1 && Math.abs(state.velocity) < 0.1) {
      state.value = state.target;
      state.velocity = 0;
      state.running = false;
      render(state.value);
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
```

## 图表是选项之一，不是默认

先看内容在回答什么问题——随时间变化、比较若干对象、看分布、看关系、看构成——形式跟着问题走。能用直接标注、位置、大小、颜色说清的，就不必上坐标轴；只有确实需要刻度、多系列或交互探查时才用图表库，用完即走。

- 标准折线、柱状、散点、环形可以用固定版本的 Chart.js：`https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js`。
- Canvas 读不到 CSS 变量，先解析再交给库：

```js
function themeColor(token) {
  var probe = document.createElement('span');
  probe.style.color = 'var(' + token + ')';
  document.body.appendChild(probe);
  var resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}
Chart.defaults.color = themeColor('--muted-foreground');
Chart.defaults.borderColor = themeColor('--border');
Chart.defaults.font.family = 'inherit';
```

- 图表容器给明确高度，用 `responsive: true, maintainAspectRatio: false`；数值变化时改 `chart.data` 后 `chart.update()` 原地过渡，不重建图表。
- 单指标面积图使用系列色约 0.25 alpha 到透明的垂直渐变，端点按容器实际高度计算，不写字面量；多系列或精确比较不填充；单系列隐藏 legend。
- 自己画 SVG 时：数据域由数据计算；从容器宽度绘制并随 `ResizeObserver` 重绘；检查标签不重叠；入场动画只播放一次，重绘不重复。
- 直接标注优先于图例和浮层 tooltip；单位落在刻度或轴上，不要只写在读数里；小数位数保持稳定。

## 示例：反比例函数 y = k/x

下面是一个把本文档所有契约合在一起的完整示例：形式由内容决定（讲“反比例函数”就画一条能上手拖的曲线，而不是报表），排版只服务阅读，颜色与控件全部来自宿主，五类动效各就各位。从它学判断和手感，不是照抄的骨架——换一个内容，形式就该跟着换。

```html
<div id="ivp-root" class="ivp-intro">
<style>
#ivp-root{display:flex;flex-direction:column;gap:12px;color:var(--foreground)}
#ivp-root .ivp-in{animation:ivp-in 360ms cubic-bezier(.2,.7,.3,1) both}
#ivp-root .ivp-hint{animation-delay:40ms}
#ivp-root .ivp-ctrl{animation-delay:120ms}
@keyframes ivp-in{from{opacity:0;transform:translateY(8px)}}
@keyframes ivp-fade{from{opacity:0}}
#ivp-root .ivp-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px}
#ivp-root .ivp-formula{display:flex;align-items:center;gap:10px;font-size:30px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
#ivp-root .ivp-formula i{font-family:"Times New Roman",Georgia,serif;font-weight:500}
#ivp-root .ivp-frac{display:inline-flex;flex-direction:column;align-items:center;font-size:24px}
#ivp-root .ivp-num{color:var(--viz-series-1);min-width:4ch;text-align:center}
#ivp-root .ivp-bar{align-self:stretch;height:2px;border-radius:1px;background:currentColor;margin:5px 0}
#ivp-root .ivp-swap{display:grid;flex:1 1 240px;min-width:0;font-size:14px;line-height:1.5;color:var(--muted-foreground)}
#ivp-root .ivp-swap>span{grid-area:1/1;transition:opacity 220ms ease-out,transform 220ms ease-out}
#ivp-root .ivp-swap>span.enter{opacity:0;transform:translateY(6px)}
#ivp-root .ivp-swap>span.leave{opacity:0;transform:translateY(-6px)}
#ivp-root .ivp-hint{margin:0;color:var(--muted-foreground)}
#ivp-root .ivp-stage{width:100%}
#ivp-root svg{display:block;width:100%;overflow:hidden;user-select:none;-webkit-user-select:none;font-variant-numeric:tabular-nums}
#ivp-root .ivp-gm{stroke:var(--border);stroke-width:1;stroke-opacity:.5}
#ivp-root .ivp-gM{stroke:var(--border);stroke-width:1}
#ivp-root .ivp-axis{stroke:var(--muted-foreground);stroke-width:1.25;transform-box:view-box}
#ivp-root .ivp-arrow{fill:var(--muted-foreground)}
#ivp-root .ivp-tick{fill:var(--muted-foreground);font-size:11px;paint-order:stroke;stroke:var(--background);stroke-width:3px;stroke-linejoin:round}
#ivp-root .ivp-axname{fill:var(--muted-foreground);font-family:"Times New Roman",Georgia,serif;font-style:italic;font-size:15px}
#ivp-root .ivp-halo{fill:none;stroke:var(--viz-series-1);stroke-width:9;stroke-opacity:.13;stroke-linecap:round;stroke-linejoin:round}
#ivp-root .ivp-curve{fill:none;stroke:var(--viz-series-1);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
#ivp-root .ivp-rect{fill:var(--viz-series-1);fill-opacity:.14;stroke:var(--viz-series-1);stroke-opacity:.6;stroke-width:1.25;stroke-dasharray:5 4;transform-box:view-box}
#ivp-root .ivp-ghost{fill:none;stroke:var(--viz-series-1);stroke-width:1;pointer-events:none;animation:ivp-ghost 800ms ease-out forwards}
@keyframes ivp-ghost{from{opacity:.5}to{opacity:0}}
#ivp-root .ivp-sym{stroke:var(--muted-foreground);stroke-width:1;stroke-opacity:.35}
#ivp-root .ivp-mirror{fill:var(--background);stroke:var(--viz-series-1);stroke-width:2}
#ivp-root .ivp-rlabel{font-size:12px;font-weight:600;fill:var(--viz-series-1);paint-order:stroke;stroke:var(--background);stroke-width:4px;stroke-linejoin:round}
#ivp-root .ivp-chip rect{fill:var(--viz-series-1)}
#ivp-root .ivp-chip text{fill:var(--background);font-size:11px;font-weight:600}
#ivp-root .ivp-drag{fill:var(--muted-foreground);font-size:12px;paint-order:stroke;stroke:var(--background);stroke-width:4px;stroke-linejoin:round;transition:opacity 300ms ease-out}
#ivp-root .ivp-drag.gone{opacity:0}
#ivp-root .ivp-glow{fill:var(--viz-series-1);opacity:0;transform-box:fill-box;transform-origin:center;transform:scale(.5);transition:opacity 160ms ease-out,transform 160ms ease-out}
#ivp-root .ivp-pt:hover .ivp-glow{opacity:.16;transform:scale(1)}
#ivp-root .ivp-pt.is-grab .ivp-glow{opacity:.24;transform:scale(1.3)}
#ivp-root .ivp-dot{fill:var(--viz-series-1);stroke:var(--background);stroke-width:2;transform-box:fill-box;transform-origin:center;transition:transform 110ms ease-out}
#ivp-root .ivp-pt:hover .ivp-dot{transform:scale(1.12)}
#ivp-root .ivp-pt.is-grab .ivp-dot{transform:scale(1.28)}
#ivp-root .ivp-ring{fill:none;stroke:var(--primary);stroke-width:2;opacity:0;transition:opacity 150ms ease-out}
#ivp-root .ivp-pt.is-focus .ivp-ring{opacity:1}
#ivp-root .ivp-hit{fill:transparent;cursor:grab;touch-action:none;outline:none}
#ivp-root.is-dragging,#ivp-root.is-dragging .ivp-hit{cursor:grabbing}
#ivp-root .ivp-ptin{transform-box:fill-box;transform-origin:center}
#ivp-root.ivp-intro .ivp-gl{animation:ivp-fade 240ms ease-out both}
#ivp-root.ivp-intro .ivp-ax{animation:ivp-gx 300ms cubic-bezier(.2,.7,.3,1) both}
#ivp-root.ivp-intro .ivp-ay{animation:ivp-gy 300ms cubic-bezier(.2,.7,.3,1) both}
@keyframes ivp-gx{from{transform:scaleX(0)}}
@keyframes ivp-gy{from{transform:scaleY(0)}}
#ivp-root.ivp-intro .ivp-ticks{animation:ivp-fade 220ms ease-out 140ms both}
#ivp-root.ivp-intro .ivp-curve,#ivp-root.ivp-intro .ivp-halo{stroke-dasharray:1 1;animation:ivp-draw 360ms cubic-bezier(.3,.7,.3,1) 120ms both}
@keyframes ivp-draw{from{stroke-dashoffset:1}}
#ivp-root.ivp-intro .ivp-rect{animation:ivp-grow 260ms cubic-bezier(.2,.7,.3,1) 300ms both}
@keyframes ivp-grow{from{transform:scale(0);opacity:0}}
#ivp-root.ivp-intro .ivp-ptin{animation:ivp-pop 240ms cubic-bezier(.2,.7,.3,1) 320ms both}
@keyframes ivp-pop{from{transform:scale(0)}}
#ivp-root.ivp-intro .ivp-late{animation:ivp-fade 200ms ease-out 340ms both}
#ivp-root .ivp-ctrl{display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px;padding-top:4px}
#ivp-root .ivp-kread{display:flex;flex-direction:column;gap:2px;min-width:5.5em}
#ivp-root .ivp-klabel{font-size:12px;color:var(--muted-foreground)}
#ivp-root .ivp-kval{font-size:22px;font-weight:600;line-height:1.1;color:var(--viz-series-1);font-variant-numeric:tabular-nums}
#ivp-root .ivp-rangewrap{flex:1 1 240px;min-width:200px}
#ivp-root .btn{transition:transform 100ms ease-out,background-color 180ms ease-out,color 180ms ease-out}
#ivp-root .btn:active{transform:scale(.97)}
#ivp-root .ivp-range{-webkit-appearance:none;appearance:none;display:block;width:100%;height:28px;margin:0;background:transparent;cursor:pointer;touch-action:pan-y}
#ivp-root .ivp-range::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:var(--ivp-track,var(--border))}
#ivp-root .ivp-range::-moz-range-track{height:6px;border-radius:3px;background:var(--ivp-track,var(--border))}
#ivp-root .ivp-range::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-8px;border-radius:50%;background:var(--primary);border:3px solid var(--background);box-shadow:0 0 0 1px var(--border);transition:transform 100ms ease-out}
#ivp-root .ivp-range::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--primary);border:3px solid var(--background);box-shadow:0 0 0 1px var(--border);transition:transform 100ms ease-out}
#ivp-root .ivp-range:active::-webkit-slider-thumb{transform:scale(1.15)}
#ivp-root .ivp-range:active::-moz-range-thumb{transform:scale(1.15)}
#ivp-root .ivp-range:focus{outline:none}
#ivp-root .ivp-range:focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:6px}
#ivp-root .ivp-scale{position:relative;height:20px;font-size:11px;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
#ivp-root .ivp-scale span{position:absolute;top:7px;left:calc(11px + (100% - 22px) * var(--f));transform:translateX(-50%);line-height:1}
#ivp-root .ivp-scale span::before{content:"";position:absolute;left:50%;top:-7px;width:1px;height:4px;background:var(--border)}
#ivp-root .ivp-scale .zero{color:var(--foreground)}
@media (prefers-reduced-motion:reduce){#ivp-root *{animation-duration:1ms!important;animation-delay:0ms!important}}
</style>

<div class="ivp-head ivp-in">
  <div class="ivp-formula" aria-label="反比例函数 y 等于 k 除以 x"><i>y</i><span>=</span><span class="ivp-frac"><span class="ivp-num" id="ivp-knum">2.0</span><span class="ivp-bar"></span><i>x</i></span></div>
  <div class="ivp-swap" id="ivp-desc" aria-live="polite"></div>
</div>

<p class="text-small ivp-hint ivp-in">沿曲线拖动实心点：拖过的矩形形状各异，面积却都等于 |k|。</p>

<div class="ivp-stage" id="ivp-stage"><svg id="ivp-svg" role="group" aria-label="反比例函数图像，带坐标网格"></svg></div>

<div class="ivp-ctrl ivp-in">
  <div class="ivp-kread"><span class="ivp-klabel">比例系数 k</span><output id="ivp-kval" for="ivp-k" class="ivp-kval">2.0</output></div>
  <div class="ivp-rangewrap">
    <input type="range" id="ivp-k" class="ivp-range" min="-8" max="8" step="any" value="2" aria-label="比例系数 k">
    <div class="ivp-scale" aria-hidden="true"><span style="--f:0">−8</span><span style="--f:.25">−4</span><span class="zero" style="--f:.5">0</span><span style="--f:.75">4</span><span style="--f:1">8</span></div>
  </div>
  <button class="btn btn-ghost" id="ivp-reset" type="button">复位</button>
</div>

<script>
(function(){
var root=document.getElementById('ivp-root');
var NS='http://www.w3.org/2000/svg';
function q(id){return root.querySelector('#'+id);}
var svg=q('ivp-svg'),stage=q('ivp-stage'),input=q('ivp-k'),kval=q('ivp-kval'),knum=q('ivp-knum'),descEl=q('ivp-desc'),resetBtn=q('ivp-reset');
var R=8,K0=2,P0=2,ST=600,DA=2*Math.sqrt(600),CHW=46;
var W=640,H=400,U=W/(2*R),YR=H/(2*U),lastW=-1,curX=0;
var kS={value:K0,target:K0,velocity:0},pS={value:P0,target:P0,velocity:0},tS={value:K0,target:K0,velocity:0};
var dragging=false,grabOff=0,thumbAnim=false,running=false,last=0,hinted=false;
var vx=0,lastMoveT=0,lastMoveV=0,ghostX=-1e9;
var xTicks=[],yTicks=[],oLabel=null;
var TEXT={pos:'k > 0：两支位于第一、三象限；在每一支上，y 随 x 增大而减小。',neg:'k < 0：两支位于第二、四象限；在每一支上，y 随 x 增大而增大。',zero:'k = 0 时 y = 0，不再是反比例函数（要求 k ≠ 0）。'};

function el(tag,attrs,parent){var e=document.createElementNS(NS,tag);for(var a in attrs)e.setAttribute(a,attrs[a]);if(parent)parent.appendChild(e);return e;}
function clamp(v,a,b){return Math.min(b,Math.max(a,v));}
function fmt(v,d){var p=Math.pow(10,d),r=Math.round(v*p)/p;if(r===0)r=0;return (r<0?'−':'')+Math.abs(r).toFixed(d);}
function sx(x){return W/2+x*U;}
function sy(y){return H/2-y*U;}
function dataX(e){var r=svg.getBoundingClientRect();return ((e.clientX-r.left)*(W/r.width)-W/2)/U;}
function lo(k){return Math.max(0.3,Math.abs(k)/(YR*0.88));}
function hi(){return R*0.95;}
function disp(v,k){var l=lo(k),h=hi(),m;
  if(v<l){m=l*0.08;return l-m*(1-Math.exp(-(l-v)/m));}
  if(v>h){m=0.4;return h+m*(1-Math.exp(-(v-h)/m));}
  return v;}

var clipId='ivp-clip-'+Math.random().toString(36).slice(2,8);
var defs=el('defs',{},svg),clipRect=el('rect',{x:0,y:0},el('clipPath',{id:clipId},defs));
var gGrid=el('g',{},svg),gAxes=el('g',{},svg),gTicks=el('g',{'class':'ivp-ticks'},svg);
var gPlot=el('g',{'clip-path':'url(#'+clipId+')'},svg);
var gGhost=el('g',{},gPlot);
var rect=el('path',{'class':'ivp-rect'},gPlot);
var haloL=el('path',{'class':'ivp-halo',pathLength:1},gPlot),haloR=el('path',{'class':'ivp-halo',pathLength:1},gPlot);
var curveL=el('path',{'class':'ivp-curve',pathLength:1},gPlot),curveR=el('path',{'class':'ivp-curve',pathLength:1},gPlot);
var gLate=el('g',{'class':'ivp-late'},svg);
var sym=el('line',{'class':'ivp-sym'},gLate);
var mirror=el('circle',{'class':'ivp-mirror',r:5},gLate);
var rectLabel=el('text',{'class':'ivp-rlabel','text-anchor':'middle','dominant-baseline':'central'},gLate);
function chip(p){var g=el('g',{'class':'ivp-chip'},p);return {r:el('rect',{rx:5,ry:5,width:CHW,height:18},g),t:el('text',{'text-anchor':'middle','dominant-baseline':'central'},g)};}
function placeChip(c,txt,left,mid){c.r.setAttribute('x',left.toFixed(1));c.r.setAttribute('y',(mid-9).toFixed(1));c.t.setAttribute('x',(left+CHW/2).toFixed(1));c.t.setAttribute('y',mid.toFixed(1));c.t.textContent=txt;}
var chipX=chip(gLate),chipY=chip(gLate);
var dragHint=el('text',{'class':'ivp-drag'},gLate);dragHint.textContent='拖动';
var pt=el('g',{'class':'ivp-pt'},svg),ptin=el('g',{'class':'ivp-ptin'},pt);
el('circle',{'class':'ivp-glow',r:17},ptin);el('circle',{'class':'ivp-ring',r:12},ptin);el('circle',{'class':'ivp-dot',r:7},ptin);
var hit=el('circle',{'class':'ivp-hit',r:22,tabindex:0,role:'slider','aria-label':'曲线上实心点的横坐标 x','aria-valuemin':0,'aria-valuemax':R},ptin);

function build(){
  [gGrid,gAxes,gTicks,gGhost].forEach(function(g){while(g.firstChild)g.removeChild(g.firstChild);});
  xTicks=[];yTicks=[];
  var cx=W/2,cy=H/2,i,ln,t,ymax=Math.floor(YR-0.01);
  for(i=-R+1;i<R;i++){if(i===0)continue;
    ln=el('line',{x1:sx(i),x2:sx(i),y1:0,y2:H,'class':'ivp-gl '+(i%2?'ivp-gm':'ivp-gM')},gGrid);
    ln.style.animationDelay=Math.round(Math.abs(i)/R*120)+'ms';}
  for(i=-ymax;i<=ymax;i++){if(i===0)continue;
    ln=el('line',{x1:0,x2:W,y1:sy(i),y2:sy(i),'class':'ivp-gl '+(i%2?'ivp-gm':'ivp-gM')},gGrid);
    ln.style.animationDelay=Math.round(Math.abs(i)/YR*120)+'ms';}
  var ax=el('line',{x1:0,x2:W-4,y1:cy,y2:cy,'class':'ivp-axis ivp-ax'},gAxes);ax.style.transformOrigin=cx+'px '+cy+'px';
  var ay=el('line',{x1:cx,x2:cx,y1:H,y2:4,'class':'ivp-axis ivp-ay'},gAxes);ay.style.transformOrigin=cx+'px '+cy+'px';
  el('path',{d:'M'+W+' '+cy+'l-9 -4.5v9z','class':'ivp-arrow'},gTicks);
  el('path',{d:'M'+cx+' 0l-4.5 9h9z','class':'ivp-arrow'},gTicks);
  el('text',{x:W-12,y:cy-10,'class':'ivp-axname','text-anchor':'end'},gTicks).textContent='x';
  el('text',{x:cx+10,y:15,'class':'ivp-axname'},gTicks).textContent='y';
  var ls=U>=44?1:(U>=24?2:4);
  for(i=-R+ls;i<R;i+=ls){if(i===0||Math.abs(i)>R-0.6)continue;
    t=el('text',{x:sx(i),y:cy+17,'class':'ivp-tick','text-anchor':'middle'},gTicks);t.textContent=fmt(i,0);xTicks.push({t:t,p:sx(i)});}
  var ym=Math.floor((YR-0.5)/ls)*ls;
  for(i=-ym;i<=ym;i+=ls){if(i===0)continue;
    t=el('text',{x:cx-8,y:sy(i),'class':'ivp-tick','text-anchor':'end','dominant-baseline':'central'},gTicks);t.textContent=fmt(i,0);yTicks.push({t:t,p:sy(i)});}
  oLabel=el('text',{x:cx-7,y:cy+17,'class':'ivp-tick','text-anchor':'end'},gTicks);oLabel.textContent='O';
  rect.style.transformOrigin=cx+'px '+cy+'px';
}

function branch(k,s){
  var a=Math.max(Math.abs(k)/(YR*1.3),0.002),b=R*1.05,n=150,d='';
  for(var i=0;i<n;i++){var x=a*Math.pow(b/a,i/(n-1)),X=s*x;d+=(i?'L':'M')+sx(X).toFixed(1)+' '+sy(k/X).toFixed(1);}
  return d;}

var swapCur=null,swapKey=null;
function swap(key){
  if(key===swapKey)return;swapKey=key;
  var n=document.createElement('span');n.className='enter';n.textContent=TEXT[key];descEl.appendChild(n);
  if(swapCur){var o=swapCur;o.classList.add('leave');o.addEventListener('transitionend',function(){if(o.parentNode)o.remove();},{once:true});setTimeout(function(){if(o.parentNode)o.remove();},320);}
  void n.offsetWidth;n.classList.remove('enter');swapCur=n;}

function cp(v){return 'calc(11px + (100% - 22px) * '+v.toFixed(4)+')';}

function render(){
  var k=kS.value,cx=W/2,cy=H/2;
  var dR=branch(k,1),dL=branch(k,-1);
  curveR.setAttribute('d',dR);haloR.setAttribute('d',dR);curveL.setAttribute('d',dL);haloL.setAttribute('d',dL);
  var x=disp(pS.value,k),y=k/x,X=sx(x),Y=sy(y);curX=X;
  rect.setAttribute('d','M'+cx+' '+cy+'H'+X.toFixed(1)+'V'+Y.toFixed(1)+'H'+cx+'Z');
  pt.setAttribute('transform','translate('+X.toFixed(1)+' '+Y.toFixed(1)+')');
  var MX=sx(-x),MY=sy(-y);
  mirror.setAttribute('cx',MX.toFixed(1));mirror.setAttribute('cy',MY.toFixed(1));
  sym.setAttribute('x1',X.toFixed(1));sym.setAttribute('y1',Y.toFixed(1));sym.setAttribute('x2',MX.toFixed(1));sym.setAttribute('y2',MY.toFixed(1));
  var s=clamp(0.5+(Y-cy)/36,0,1),dist=Math.abs(Y-cy);
  rectLabel.setAttribute('x',Math.max((cx+X)/2,cx+47).toFixed(1));rectLabel.setAttribute('y',((cy+Y)/2).toFixed(1));
  rectLabel.textContent='x·y = '+fmt(x*y,2);
  rectLabel.style.opacity=clamp((dist-6)/14,0,1).toFixed(3);
  placeChip(chipX,fmt(x,2),clamp(X-CHW/2,2,W-CHW-2),cy+15*(1-2*s));
  placeChip(chipY,fmt(y,2),cx-6-CHW,clamp(Y,10,H-10));
  var hw=CHW/2+4,i,o,near;
  for(i=0;i<xTicks.length;i++){o=xTicks[i];near=clamp((Math.abs(o.p-X)-hw)/10,0,1);o.t.style.opacity=(1-(1-s)*(1-near)).toFixed(3);}
  for(i=0;i<yTicks.length;i++){o=yTicks[i];o.t.style.opacity=clamp((Math.abs(o.p-Y)-13)/8,0,1).toFixed(3);}
  if(oLabel){var nx=1-(1-s)*(1-clamp((Math.abs(cx-12-X)-hw)/10,0,1)),ny=clamp((Math.abs(cy+12-Y)-13)/8,0,1);oLabel.style.opacity=Math.min(nx,ny).toFixed(3);}
  dragHint.setAttribute('x',Math.min(X+16,W-40).toFixed(1));dragHint.setAttribute('y',Math.max(Y-16,16).toFixed(1));
  hit.setAttribute('aria-valuenow',x.toFixed(2));hit.setAttribute('aria-valuetext','x = '+fmt(x,2)+'，y = '+fmt(y,2));
  var ks=fmt(k,1);knum.textContent=ks;kval.textContent=ks;
  swap(k>=0.05?'pos':(k<=-0.05?'neg':'zero'));
  var tv=parseFloat(input.value),f=clamp((tv+8)/16,0,1),a=Math.min(.5,f),b=Math.max(.5,f);
  input.style.setProperty('--ivp-track','linear-gradient(90deg,var(--border) '+cp(a)+',var(--primary) '+cp(a)+',var(--primary) '+cp(b)+',var(--border) '+cp(b)+')');
  input.setAttribute('aria-valuetext','k = '+fmt(tv,1));
  if(!dragging){var tg=clamp(pS.target,lo(k),hi());if(tg!==pS.target){pS.target=tg;kick();}}
}

function spr(st,dt){var acc=ST*(st.target-st.value)-DA*st.velocity;st.velocity+=acc*dt;st.value+=st.velocity*dt;}
function still(st){return Math.abs(st.target-st.value)<4e-4&&Math.abs(st.velocity)<4e-3;}
function kick(){if(running)return;running=true;last=performance.now();requestAnimationFrame(tick);}
function tick(now){
  var dt=Math.min((now-last)/1000,0.032)/2;last=now;
  for(var i=0;i<2;i++){spr(kS,dt);if(!dragging)spr(pS,dt);if(thumbAnim)spr(tS,dt);}
  if(thumbAnim)input.value=tS.value;
  if(still(kS)&&(dragging||still(pS))&&(!thumbAnim||still(tS))){
    kS.value=kS.target;kS.velocity=0;
    if(!dragging){pS.value=pS.target;pS.velocity=0;}
    if(thumbAnim){thumbAnim=false;input.value=tS.target;}
    running=false;render();return;}
  render();requestAnimationFrame(tick);
}

function hideHint(){if(!hinted){hinted=true;dragHint.classList.add('gone');}}
function addGhost(){
  var g=el('path',{'class':'ivp-ghost',d:rect.getAttribute('d')},gGhost);
  g.addEventListener('animationend',function(){if(g.parentNode)g.remove();});
  while(gGhost.childNodes.length>14)gGhost.removeChild(gGhost.firstChild);}

hit.addEventListener('pointerdown',function(e){
  if(e.button>0)return;
  e.preventDefault();try{hit.setPointerCapture(e.pointerId);}catch(_){}
  dragging=true;pS.velocity=0;pS.target=pS.value;grabOff=dataX(e)-pS.value;
  vx=0;lastMoveT=performance.now();lastMoveV=pS.value;ghostX=curX;
  pt.classList.add('is-grab');root.classList.add('is-dragging');hideHint();
  try{hit.focus({preventScroll:true});}catch(_){}
});
hit.addEventListener('pointermove',function(e){
  if(!dragging)return;
  var l=lo(kS.value),v=clamp(dataX(e)-grabOff,l*0.6,hi()+2),now=performance.now(),dt=(now-lastMoveT)/1000;
  if(dt>0.001){vx=vx*0.6+((v-lastMoveV)/dt)*0.4;lastMoveT=now;lastMoveV=v;}
  pS.value=v;pS.target=v;render();
  if(Math.abs(curX-ghostX)>22){ghostX=curX;addGhost();}
});
function endDrag(){
  if(!dragging)return;dragging=false;
  pt.classList.remove('is-grab');root.classList.remove('is-dragging');
  var v=(performance.now()-lastMoveT<90)?clamp(vx,-25,25):0;
  pS.velocity=v;pS.target=clamp(pS.value+v*0.12,lo(kS.value),hi());kick();}
hit.addEventListener('pointerup',endDrag);hit.addEventListener('pointercancel',endDrag);
hit.addEventListener('keydown',function(e){
  var st=e.shiftKey?1:0.25,d;
  if(e.key==='ArrowRight'||e.key==='ArrowUp')d=st;else if(e.key==='ArrowLeft'||e.key==='ArrowDown')d=-st;else return;
  e.preventDefault();hideHint();pS.target=clamp(pS.target+d,lo(kS.value),hi());kick();});
hit.addEventListener('focus',function(){var fv=true;try{fv=hit.matches(':focus-visible');}catch(_){}pt.classList.toggle('is-focus',fv);});
hit.addEventListener('blur',function(){pt.classList.remove('is-focus');});

input.addEventListener('pointerdown',function(){thumbAnim=false;});
input.addEventListener('input',function(){thumbAnim=false;kS.target=parseFloat(input.value);kick();render();});
input.addEventListener('change',function(){
  if(thumbAnim)return;var v=parseFloat(input.value),r=Math.round(v*10)/10;
  if(r!==v){input.value=r;kS.target=r;kick();render();}});
input.addEventListener('keydown',function(e){
  var v=parseFloat(input.value),d,big=e.shiftKey?1:0.1;
  switch(e.key){case 'ArrowRight':case 'ArrowUp':d=v+big;break;case 'ArrowLeft':case 'ArrowDown':d=v-big;break;
    case 'PageUp':d=v+1;break;case 'PageDown':d=v-1;break;case 'Home':d=-8;break;case 'End':d=8;break;default:return;}
  e.preventDefault();thumbAnim=false;d=clamp(Math.round(d*10)/10,-8,8);input.value=d;kS.target=d;kick();render();});

resetBtn.addEventListener('click',function(){
  tS.value=parseFloat(input.value);tS.velocity=0;tS.target=K0;thumbAnim=Math.abs(tS.value-K0)>1e-6;
  kS.target=K0;pS.target=P0;kick();});

function layout(){
  var w=Math.round(stage.clientWidth)||640;lastW=w;
  W=w;H=Math.round(clamp(w*0.62,280,480));U=W/(2*R);YR=H/(2*U);
  svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.style.height=H+'px';
  clipRect.setAttribute('width',W);clipRect.setAttribute('height',H);
  build();render();}
if(window.ResizeObserver){new ResizeObserver(function(){var w=Math.round(stage.clientWidth);if(w&&w!==lastW)layout();}).observe(stage);}
layout();
setTimeout(function(){root.classList.remove('ivp-intro');},800);
})();
</script>
</div>
```

值得注意的细节：

- 排版按阅读顺序：公式与结论（公式用真分数排版）→ 操作提示 → 画面 → 控件；控件在画面**下方**，读数紧挨着它解释的对象。
- 颜色全部来自主题变量（`--viz-series-1`、`--border`、`--muted-foreground`、`--primary`），网格、曲线、控件跟着深浅主题走。
- 五个动效点：分层入场（网格按离原点距离依次淡入、坐标轴从原点展开、曲线描边生长、矩形缩放出现、点弹出）、拖点 1:1 跟随并保留抓取偏移、k 与拖动点都走临界阻尼弹簧、快速拖动留下矩形拖影并在松手时继承速度、完成/状态切换用短促过渡。
- 拖过的虚线矩形面积恒等于 |k|，是内容本身在说话，不是装饰。
- 原生 `<input type=range>` + 命中圈 `role="slider"` + 方向键步进，键盘可达；`prefers-reduced-motion` 全局降级。

## 完成前检查

- 形式是从内容推出来的，不是从习惯推出来的。
- 脚本查询的每个元素真实存在，变量都已定义。
- 主交互会明显改变输出。
- 初始状态已可读、窄屏可用、颜色随主题变化。
- 首次进入、按下、参数连续变化、状态切换和完成/错误都有因果明确的流畅动效；动画可被再次操作中断，不锁输入、不闪烁、不整块重建。
- 可视化前后最多写一两句帮助用户阅读或操作的说明；不提工具、fragment、文件或实现机制，也不要再次粘贴 markup。
