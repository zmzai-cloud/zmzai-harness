"use client";

import { useLayoutEffect } from "react";

/**
 * Next 水合会以 RootLayout 的服务端属性为准，可能移除首帧脚本写入的
 * `html.electron`。在水合完成前同步补回该标记，让 macOS 标题栏安全区稳定生效。
 */
export default function ElectronShellMarker() {
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("electron", Boolean(window.lecternNative));
  }, []);

  return null;
}
