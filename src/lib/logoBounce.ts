/**
 * 关于页应用图标的「按下收缩、松开弹跳」：一对弹簧（缩放 + 竖向位移），rAF 驱动。
 *
 * 为什么不用 CSS keyframes：连点十次时，上一次的弹跳往往还没落地。keyframes 每次都
 * 从固定起点重播，会在图标身上造成肉眼可见的跳变；弹簧始终从**当前**位置与速度出发，
 * 新的一下只是改目标/加一份冲量，运动始终连续（apple-design §3、§5）。
 */

export interface SpringAxis {
  pos: number;
  vel: number;
  target: number;
  /** 角频率 ω = 2π / response（rad/s）。 */
  omega: number;
  /** 阻尼比 ζ：1 = 临界阻尼无回弹，< 1 越小越弹。 */
  zeta: number;
}

/** 用 Apple 的「响应时间 + 阻尼比」两个参数建一根弹簧轴（质量取 1）。 */
export function makeAxis(rest: number, response: number, zeta: number): SpringAxis {
  return { pos: rest, vel: 0, target: rest, omega: (2 * Math.PI) / response, zeta };
}

export function tune(axis: SpringAxis, response: number, zeta: number): void {
  axis.omega = (2 * Math.PI) / response;
  axis.zeta = zeta;
}

/** 半隐式欧拉，按 ≤ 1/240s 切片：弹簧够硬时单步 16ms 会发散。 */
export function stepAxis(axis: SpringAxis, dt: number): void {
  const slices = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / slices;
  const k = axis.omega * axis.omega;
  const c = 2 * axis.zeta * axis.omega;
  for (let i = 0; i < slices; i += 1) {
    const accel = -k * (axis.pos - axis.target) - c * axis.vel;
    axis.vel += accel * h;
    axis.pos += axis.vel * h;
  }
}

export function isSettled(axis: SpringAxis, posEps: number, velEps: number): boolean {
  return Math.abs(axis.pos - axis.target) < posEps && Math.abs(axis.vel) < velEps;
}

/** 按下时缩到多小；开了减少动态效果就只轻轻压一下。 */
const PRESS_SCALE = 0.84;
const PRESS_SCALE_REDUCED = 0.95;
/** 起跳初速 = 图标高度 × 此系数 × 能量（px/s）。 */
const JUMP_VELOCITY_PER_HEIGHT = 2.1;
const MAX_FRAME_DT = 1 / 30;

export interface LogoBounce {
  /** 指针按下：立刻收缩（响应在按下而不是抬起）。 */
  press(): void;
  /**
   * 松开：回弹并起跳。`energy` 是起跳力度倍率（0 = 只松手不跳，用于拖出去取消的情形；
   * 1 = 常规；连点越多越大）。
   */
  release(energy: number): void;
  dispose(): void;
}

export function createLogoBounce(el: HTMLElement, reducedMotion: () => boolean): LogoBounce {
  const scale = makeAxis(1, 0.2, 1);
  const lift = makeAxis(0, 0.55, 0.5);
  let raf = 0;
  let last = 0;
  let disposed = false;

  const render = () => {
    el.style.transform = `translate3d(0, ${lift.pos.toFixed(2)}px, 0) scale(${scale.pos.toFixed(4)})`;
  };

  const tick = (now: number) => {
    raf = 0;
    if (disposed) return;
    const dt = last === 0 ? 1 / 60 : Math.min(MAX_FRAME_DT, (now - last) / 1000);
    last = now;
    stepAxis(scale, dt);
    stepAxis(lift, dt);
    if (isSettled(scale, 0.0005, 0.01) && isSettled(lift, 0.05, 1)) {
      scale.pos = scale.target;
      lift.pos = lift.target;
      scale.vel = 0;
      lift.vel = 0;
      el.style.transform = '';
      el.style.willChange = '';
      last = 0;
      return;
    }
    render();
    raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    el.style.willChange = 'transform';
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  return {
    press() {
      scale.target = reducedMotion() ? PRESS_SCALE_REDUCED : PRESS_SCALE;
      tune(scale, 0.18, 1);
      wake();
    },
    release(energy) {
      const reduced = reducedMotion();
      scale.target = 1;
      // 减少动态效果：临界阻尼，只回到原位，不过冲不起跳
      tune(scale, reduced ? 0.2 : 0.36, reduced ? 1 : 0.42);
      if (!reduced && energy > 0) {
        const height = el.getBoundingClientRect().height || 96;
        // 连点时冲量会叠加（还没落地又起跳），但封顶，别把图标甩出屏幕
        lift.vel = Math.max(
          lift.vel - height * JUMP_VELOCITY_PER_HEIGHT * energy,
          -height * JUMP_VELOCITY_PER_HEIGHT * 2.4,
        );
        tune(lift, 0.55, 0.5);
      }
      wake();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      el.style.transform = '';
      el.style.willChange = '';
    },
  };
}

/** 第 n 下连点的起跳力度：从 1 渐强到第 10 下的 ~1.9 倍，让用户感到「快了快了」。 */
export function jumpEnergy(clickIndex: number): number {
  const n = Math.max(1, Math.min(10, clickIndex));
  return 1 + (n - 1) * 0.1;
}
