/** @type {import('next').NextConfig} */
import { fileURLToPath } from "node:url";

// 注意：用 .mjs 而非 .ts——打包后的生产运行时（next start / standalone server）
// 加载 .ts 配置需要 typescript，缺失时会触发 next 自动 pnpm install（在安装目录
// 里乱装包）。纯 JS 配置无此依赖。
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // 固定 workspace root：上级 zmzai/ 目录存在多余 lockfile（package-lock.json）时
  // Next 会误判 root，standalone 输出嵌套成 .next/standalone/zmzai-harness/server.js，
  // electron 壳按 .next/standalone/server.js 找不到入口直接退出（app 闪退）。
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  // 桌面端打包：额外产出 .next/standalone（server.js + trace 出的运行时依赖，
  // 物理复制、无 symlink），Electron 壳直接 node server.js 起服务。
  output: "standalone",
  // 【安全】禁止把本机数据打进产物。
  // Next 的 standalone 文件追踪会把 `outputFileTracingRoot`（= 仓库根）下的
  // `data/**` 一并复制进 `.next/standalone/data/`。仓库根的 data/ 是历史遗留的
  // 老数据目录（已 gitignore），里面是**开发者的真实会话库与 .secret**，
  // 一旦混入就会随安装包公开发布——v0.2.0 至 v0.4.3 全部中招。
  // 显式排除，并在 scripts/check-standalone-clean.mjs 做构建后断言兜底。
  outputFileTracingExcludes: {
    "**": ["data/**", "**/data/**", "**/.secret", "**/*.db", "**/*.db-shm", "**/*.db-wal"],
  },
  // 私有 TS 包，需显式转译
  transpilePackages: ["@zmzai/theme"],
  // serverExternal：不能被 bundle——framework 内部定位 wasm 资源依赖真实
  // 模块路径；web-tree-sitter 的 emscripten 胶水内部也调 node:module 的
  // createRequire，被 bundle 后 shim 成空壳必炸（R1 repo_map）。
  serverExternalPackages: ["@zmzai/agent-framework", "web-tree-sitter"],
  // NodeNext 后缀映射：theme 源码直发（.ts/.tsx 以 .js 说明符互引）
  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    // Next 的 serverExternalPackages 对 pnpm symlink 包不生效，手动补：
    // framework 与 web-tree-sitter（emscripten 胶水内调 createRequire）
    // 一旦被 bundle，wasm 资源定位必炸（R1 repo_map）。
    if (isServer) {
      config.externals.push("web-tree-sitter");
    }
    return config;
  },
};

export default nextConfig;
