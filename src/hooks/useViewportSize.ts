import { useEffect, useState } from "react";

export interface ViewportSize {
  width: number;
  height: number;
}

const read = (): ViewportSize => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

/** 窗口可视尺寸；旋转屏幕 / 分屏改变大小时更新。 */
export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState(read);
  useEffect(() => {
    const update = () =>
      setSize((previous) => {
        const next = read();
        return previous.width === next.width && previous.height === next.height
          ? previous
          : next;
      });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return size;
}
