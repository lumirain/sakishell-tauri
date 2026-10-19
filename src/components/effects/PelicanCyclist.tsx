import { crankPath, legPath, PEDAL_KEYFRAMES_CSS, PELICAN_VIEWBOX } from '@/lib/pelicanPedal';

const OUTLINE = '#64748b';
const FRAME = '#f43f5e';
const WHEEL_CENTERS = [
  { x: 62, y: 110 },
  { x: 146, y: 110 },
] as const;

function Wheel({ cx, cy }: { cx: number; cy: number }) {
  const spokes = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5];
  return (
    <g>
      <circle cx={cx} cy={cy} r="28.5" fill="none" stroke="#27272a" strokeWidth="5" />
      <circle cx={cx} cy={cy} r="25" fill="none" stroke="#a1a1aa" strokeWidth="1.5" />
      <g className="pelican-wheel">
        {spokes.map((deg) => (
          <line
            key={deg}
            x1={cx}
            y1={cy - 25}
            x2={cx}
            y2={cy + 25}
            stroke="#d4d4d8"
            strokeWidth="1"
            transform={`rotate(${deg} ${cx} ${cy})`}
          />
        ))}
        {/* 一颗偏心的气门嘴：让车轮「在转」这件事看得见 */}
        <circle cx={cx} cy={cy - 21} r="2" fill="#fbbf24" />
      </g>
      <circle cx={cx} cy={cy} r="3.5" fill="#52525b" />
    </g>
  );
}

/**
 * 骑自行车的鹈鹕（车头朝左，向左骑）。纯展示：`riding=false` 时车轮与脚踏全部定格。
 * 腿与曲柄的运动由 `PEDAL_KEYFRAMES_CSS` 里的 CSS 关键帧驱动，样式见 globals.css 的 .pelican-*。
 */
export default function PelicanCyclist({ riding, className }: { riding: boolean; className?: string }) {
  const { width, height, minY } = PELICAN_VIEWBOX;
  return (
    <svg
      className={`${className ?? ''} ${riding ? '' : 'pelican-paused'}`}
      data-pelican="cyclist"
      viewBox={`0 ${minY} ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      style={{ overflow: 'visible' }}
    >
      <style>{PEDAL_KEYFRAMES_CSS}</style>

      <ellipse cx="104" cy="141" rx="76" ry="3.5" fill="rgba(0,0,0,0.28)" />

      <g className="pelican-bob">
        {/* 远侧的腿与曲柄（压暗，表示在车架另一边） */}
        <path className="pelican-crank-b" d={crankPath(Math.PI)} stroke="#475569" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        <path className="pelican-leg-b" d={legPath(Math.PI)} stroke="#c2410c" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />

        {WHEEL_CENTERS.map((c) => (
          <Wheel key={c.x} cx={c.x} cy={c.y} />
        ))}

        {/* 车架 */}
        <g stroke={FRAME} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M146 110 L108 110" />
          <path d="M146 110 L126 66" />
          <path d="M108 110 L126 66" />
          <path d="M126 66 L76 70" />
          <path d="M108 110 L78 76" />
          <path d="M76 66 L62 110" />
          <path d="M75 64 L78 78" strokeWidth="5.5" />
          <path d="M126 66 L126 60" />
        </g>
        {/* 车把：从立管向上再向前探 */}
        <path d="M75 64 L72 52 C66 48 60 50 58 55" stroke="#27272a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <rect x="114" y="58" width="28" height="7" rx="3.5" fill="#1e293b" />

        {/* 链轮 */}
        <circle cx="108" cy="110" r="7" fill="#71717a" stroke="#3f3f46" strokeWidth="1.5" />

        {/* 近侧的曲柄与腿 */}
        <path className="pelican-crank-a" d={crankPath(0)} stroke="#334155" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        <path className="pelican-leg-a" d={legPath(0)} stroke="#ea580c" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />

        {/* 尾羽 */}
        <path d="M150 38 L178 40 L180 47 L152 51 Z" fill="#cbd5e1" stroke={OUTLINE} strokeWidth="1.5" strokeLinejoin="round" />

        {/* 身体 */}
        <ellipse cx="130" cy="44" rx="27" ry="21" fill="#f8fafc" stroke={OUTLINE} strokeWidth="1.8" />

        {/* 脖子：先描边再填白，做出带轮廓的粗线 */}
        <path d="M110 40 C 96 37, 91 27, 97 17" fill="none" stroke={OUTLINE} strokeWidth="13" strokeLinecap="round" />
        <path d="M110 40 C 96 37, 91 27, 97 17" fill="none" stroke="#f8fafc" strokeWidth="10" strokeLinecap="round" />

        {/* 翅膀当手臂握把：翼尖是鹈鹕标志性的深色飞羽 */}
        <path d="M124 33 C 104 33, 86 41, 64 50 L60 57 C 84 55, 106 53, 126 50 Z" fill="#e2e8f0" stroke={OUTLINE} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M64 50 L55 52 L57 59 L60 57 Z" fill="#1e293b" />

        {/* 喉囊（下喙）在上喙后面，先画 */}
        <path d="M88 19 C 76 42, 52 38, 33 27 L 88 21 Z" fill="#fb923c" stroke="#c2410c" strokeWidth="1.4" strokeLinejoin="round" />
        {/* 头 */}
        <circle cx="95" cy="13" r="10.5" fill="#f8fafc" stroke={OUTLINE} strokeWidth="1.8" />
        {/* 上喙：细长，尖端带钩 */}
        <path d="M88 7 C 72 7 48 13 31 21 C 28 23 30 27 35 25 L 88 20 Z" fill="#fbbf24" stroke="#b45309" strokeWidth="1.4" strokeLinejoin="round" />
        {/* 头盔：安全第一 */}
        <path d="M84 11 C 83 -3 107 -3 106 11 Z" fill="#6366f1" stroke="#4338ca" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M95 -2 L95 11" stroke="#e0e7ff" strokeWidth="2.2" strokeLinecap="round" />
        {/* 眼睛 */}
        <circle cx="90.5" cy="14" r="2.3" fill="#0f172a" />
        <circle cx="91.2" cy="13.2" r="0.8" fill="#fff" />
      </g>
    </svg>
  );
}
