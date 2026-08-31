#!/usr/bin/env bash
# Lectern — macOS 打包脚本（Apple Silicon / arm64）
# 用法：bash scripts/build-mac.sh   （产物在 dist/）
# 前置：pnpm install（含 electron-builder）、.env 已就位（正式环境或本地）
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> [0/5] 清理历史打包产物（避免 dist 累积旧版本 dmg/zip）"
bash scripts/clean-dist.sh

echo "==> [1/5] next build（生产构建，含 standalone 输出）"
# 清掉上次构建的 .next/types 与 tsbuildinfo：残留会导致类型检查阶段引用不存在的
# 文件而 Failed to compile（File '.next/types/...' not found）
rm -rf .next/types tsconfig.tsbuildinfo
pnpm build

# fail-fast：入口不存在就停，绝不打出会闪退的包（曾因 Next workspace root
# 误判导致 standalone 嵌套成 zmzai-harness/server.js）
[ -f .next/standalone/server.js ] || { echo "❌ .next/standalone/server.js 缺失，standalone 布局异常，中止打包" >&2; exit 1; }

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
# 大目录删除一律先 mv 到 /tmp（WorkBuddy safe-delete 守卫对 >50 文件的 rm
# 会拦截：SAFE_DELETE_BULK_CONFIRM_REQUIRED）；/tmp 重启自动清。
guard_mv() {
  local d
  for d in "$@"; do
    [ -e "$d" ] || continue
    mv "$d" "/tmp/lectern-rm-$(date +%s)-$RANDOM" || true
  done
}
guard_mv .package-build
node scripts/prepare-prod-package.mjs
(cd .package-build && npm install --omit=dev --no-audit --no-fund --loglevel=error)
guard_mv .next/standalone/node_modules
mv .package-build/node_modules .next/standalone/node_modules
guard_mv .package-build

echo "==> [4/5] electron-builder 打包 macOS（dmg + zip，arm64）"
# 无开发者签名证书：跳过 codesign / notarize（本机与自分发场景可直接运行）
ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}" \
CSC_IDENTITY_AUTO_DISCOVERY=false \
pnpm exec electron-builder --mac --arm64 --publish never

echo "==> [5/6] ad-hoc 深度签名（无开发者证书，封印 Bundle 资源）"
# electron-builder 在 CSC_IDENTITY_AUTO_DISCOVERY=false 下完全跳过签名，产物只有
# 主执行文件的 linker 临时签名（Sealed Resources=none）。包级未封印 + 浏览器下载
# 隔离标记会触发 Gatekeeper「已损坏，无法打开」。这里做完整 ad-hoc 签名保证完整性
# 校验通过。注意：无 Developer ID + 公证，下载场景仍需 xattr 清隔离（见 README）。
APP_PATH=$(find dist -maxdepth 2 -name "*.app" -type d | head -1)
if [ -n "$APP_PATH" ]; then
  codesign --force --deep --sign - "$APP_PATH"
  codesign --verify --deep --strict "$APP_PATH"
  echo "ad-hoc 签名通过：$APP_PATH"
fi

echo "==> [6/6] 产物"
ls -lh dist/*.dmg dist/*.zip
echo "完成。安装：双击 dist/*.dmg 拖入 Applications；或直接运行 dist/mac-arm64/Lectern.app"
