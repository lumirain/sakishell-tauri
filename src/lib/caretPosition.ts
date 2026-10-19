/**
 * 取 textarea 光标在**视口**里的位置（镜像 div 法：把文字原样排进一个同样式的隐藏 div，
 * 量光标处标记点的偏移）。纯功能，任何需要「在光标处弹点什么」的地方都能用。
 *
 * 量不出来（样式读取异常 / 环境不支持）时退回输入框左下角附近，调用方不必处理失败。
 */

const MIRRORED_STYLES = [
  'direction',
  'boxSizing',
  'width',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
] as const;

export interface CaretPoint {
  x: number;
  /** 光标所在行的垂直中心。 */
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fallbackPoint(el: HTMLTextAreaElement): CaretPoint {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + 16, y: rect.bottom - 16 };
}

export function getCaretViewportPoint(el: HTMLTextAreaElement): CaretPoint {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return fallbackPoint(el);
  }
  try {
    const computed = getComputedStyle(el);
    const mirror = document.createElement('div');
    const style = mirror.style;
    for (const prop of MIRRORED_STYLES) {
      (style as unknown as Record<string, string>)[prop] = computed[prop];
    }
    style.position = 'absolute';
    style.visibility = 'hidden';
    style.top = '0';
    style.left = '-9999px';
    style.height = 'auto';
    style.whiteSpace = 'pre-wrap';
    style.overflowWrap = 'break-word';
    style.overflow = 'hidden';

    const caret = el.selectionEnd ?? el.value.length;
    mirror.textContent = el.value.slice(0, caret);
    const marker = document.createElement('span');
    // 标记点不能是空的：空 span 在行尾会塌掉，量出来的是上一行的位置
    marker.textContent = '​';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const lineHeight =
      parseFloat(computed.lineHeight) || (parseFloat(computed.fontSize) || 14) * 1.4;
    const markerLeft = marker.offsetLeft;
    const markerTop = marker.offsetTop;
    mirror.remove();

    const rect = el.getBoundingClientRect();
    const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
    const borderTop = parseFloat(computed.borderTopWidth) || 0;
    // 输入框内部滚动过（长文本）：光标行相对可视区要减去滚动量
    const x = rect.left + borderLeft + markerLeft - el.scrollLeft;
    const y = rect.top + borderTop + markerTop - el.scrollTop + lineHeight / 2;
    return {
      x: clamp(x, rect.left, rect.right),
      y: clamp(y, rect.top, rect.bottom),
    };
  } catch {
    return fallbackPoint(el);
  }
}
