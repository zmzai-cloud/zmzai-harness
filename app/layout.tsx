import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "agent harness · zmzai",
  description: "zmzai Agent Harness — Web / Desktop 同构的 Agent 工作台",
};

/** 首帧前同步主题：localStorage（system/light/dark），显式 ?theme= 可强制（分享/验证用），
 *  避免 React 水合前深色用户看到一闪而过的白屏。 */
const themeBootstrap = `
(function () {
  try {
    var q = new URLSearchParams(location.search).get("theme");
    var t = q === "dark" || q === "light" ? q : localStorage.getItem("zmzai-theme") || "system";
    if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
