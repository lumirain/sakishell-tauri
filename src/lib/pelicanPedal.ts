/**
 * 鹈鹕骑车的踩踏几何：曲柄绕五通匀速转，脚踩在踏板上，膝盖由两段骨头的 IK 求出。
 * 纯数学、不碰 DOM —— 输出 SVG path 与 CSS keyframes 文本，由 PelicanCyclist 注入。
 *
 * 为什么把腿写成 CSS `d: path()` 关键帧而不是 JS 逐帧驱动：整个仪式只有几秒，
 * 腿/曲柄的运动完全由相位决定，生成一次关键帧就能交给合成线程跑，主线程零开销；
 * 浏览器不支持 `d` 动画时腿只是静止，不影响其余画面。
 */

export interface Point {
  x: number;
  y: number;
}

/** 画布几何：整幅图上沿在 y=-10，车轮着地线在 y=140。 */
export const PELICAN_VIEWBOX = { width: 220, height: 160, minY: -10 } as const;
/** 着地线在整幅图高度中的位置比例（0=顶，1=底），用来把车轮对齐到地面线。 */
export const PELICAN_GROUND_RATIO = (140 - PELICAN_VIEWBOX.minY) / PELICAN_VIEWBOX.height;

/** 髋（腿从身体伸出的位置）与五通（曲柄转轴），单位是 SVG viewBox 坐标。 */
export const HIP: Point = { x: 124, y: 62 };
export const BOTTOM_BRACKET: Point = { x: 108, y: 110 };
export const CRANK_LENGTH = 13;
const THIGH = 33;
const SHIN = 33;

/** 曲柄角 theta 时脚（踏板）的位置。屏幕坐标 y 向下，theta 增大 = 顺时针。 */
export function footAt(theta: number): Point {
  return {
    x: BOTTOM_BRACKET.x + CRANK_LENGTH * Math.cos(theta),
    y: BOTTOM_BRACKET.y + CRANK_LENGTH * Math.sin(theta),
  };
}

/** 两段骨头 IK：髋到脚的距离超过腿长时，脚被「拉直」到刚好够得着。膝盖朝前（x 更小的一侧）。 */
export function kneeFor(hip: Point, foot: Point): Point {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  const dist = Math.min(Math.hypot(dx, dy), THIGH + SHIN - 0.001);
  if (dist === 0) return { x: hip.x, y: hip.y + THIGH };
  const ux = dx / dist;
  const uy = dy / dist;
  const a = (THIGH * THIGH - SHIN * SHIN + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, THIGH * THIGH - a * a));
  const base = { x: hip.x + ux * a, y: hip.y + uy * a };
  const opt1 = { x: base.x - uy * h, y: base.y + ux * h };
  const opt2 = { x: base.x + uy * h, y: base.y - ux * h };
  return opt1.x <= opt2.x ? opt1 : opt2;
}

const f = (n: number) => n.toFixed(1);

export function legPath(theta: number): string {
  const foot = footAt(theta);
  const knee = kneeFor(HIP, foot);
  return `M${f(HIP.x)} ${f(HIP.y)} L${f(knee.x)} ${f(knee.y)} L${f(foot.x)} ${f(foot.y)}`;
}

export function crankPath(theta: number): string {
  const foot = footAt(theta);
  return `M${f(BOTTOM_BRACKET.x)} ${f(BOTTOM_BRACKET.y)} L${f(foot.x)} ${f(foot.y)}`;
}

const STEPS = 16;

/** 生成一条 `d` 关键帧：曲柄逆时针转一整圈（车头朝左，向左骑），`phase` 为起始相位。 */
function keyframes(name: string, phase: number, path: (theta: number) => string): string {
  const frames: string[] = [];
  for (let i = 0; i <= STEPS; i += 1) {
    const theta = phase - (i / STEPS) * Math.PI * 2;
    frames.push(`${((i / STEPS) * 100).toFixed(2)}%{d:path("${path(theta)}")}`);
  }
  return `@keyframes ${name}{${frames.join('')}}`;
}

/** 两条腿 + 两根曲柄（相差半圈）的全部关键帧。 */
export const PEDAL_KEYFRAMES_CSS = [
  keyframes('pelican-leg-a', 0, legPath),
  keyframes('pelican-leg-b', Math.PI, legPath),
  keyframes('pelican-crank-a', 0, crankPath),
  keyframes('pelican-crank-b', Math.PI, crankPath),
].join('\n');
