#!/usr/bin/env bash
# zmzai Harness — macOS 打包脚本（Apple Silicon / arm64）
# 用法：bash scripts/build-mac.sh   （产物在 dist/）
# 前置：pnpm install（含 electron-builder）、.env 已就位（正式环境或本地）
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> [0/5] 清理历史打包产物（避免 dist 累积旧版本 dmg/zip）"
bash scripts/clean-dist.sh

echo "==> [1/5] next build（生产构建，含 standalone 输出）"
pnpm build

echo "==> [2/5] 组装 standalone 运行时（静态资源/页面资源拷入 standalone）"
# next build 不自动拷贝：standalone server 按相对路径找 .next/static 与 public
rm -rf .next/standalone/public
mkdir -p .next/standalone/.next
cp -R public .next/standalone/public 2>/dev/null || mkdir -p .next/standalone/public
cp -R .next/static .next/standalone/.next/static

echo "==> [3/5] 组装实体 node_modules（pnpm symlink / file: 依赖实体化）"
# pnpm 下 next standalone 的 trace 产出的 node_modules 只含指向 .pnpm 的断链
# symlink；electron-builder 复制 pnpm node_modules 也不完整（file: 依赖丢失）。
# 这里用 npm 从 tarball 安装一份完全实体的生产依赖整体替换。
rm -rf .package-build
node scripts/prepare-prod-package.mjs
(cd .package-build && npm install --omit=dev --no-audit --no-fund --loglevel=error)
rm -rf .next/standalone/node_modules
mv .package-build/node_modules .next/standalone/node_modules
rm -rf .package-build

echo "==> [4/5] electron-builder 打包 macOS（dmg + zip，arm64）"
# 无开发者签名证书：跳过 codesign / notarize（本机与自分发场景可直接运行）
ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}" \
CSC_IDENTITY_AUTO_DISCOVERY=false \
pnpm exec electron-builder --mac --arm64 --publish never

echo "==> [5/5] 产物"
ls -lh dist/*.dmg dist/*.zip
echo "完成。安装：双击 dist/*.dmg 拖入 Applications；或直接运行 dist/mac-arm64/zmzai Harness.app"
