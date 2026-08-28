/** @type {import('next').NextConfig} */
// 注意：用 .mjs 而非 .ts——打包后的生产运行时（next start / standalone server）
// 加载 .ts 配置需要 typescript，缺失时会触发 next 自动 pnpm install（在安装目录
// 里乱装包）。纯 JS 配置无此依赖。
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // 桌面端打包：额外产出 .next/standalone（server.js + trace 出的运行时依赖，
  // 物理复制、无 symlink），Electron 壳直接 node server.js 起服务。
  output: "standalone",
  // 私有 TS 包，需显式转译
  transpilePackages: ["@zmzai/theme"],
  // NodeNext 后缀映射：theme 源码直发（.ts/.tsx 以 .js 说明符互引）
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
