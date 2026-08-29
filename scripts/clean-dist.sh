#!/usr/bin/env bash
# zmzai Harness — 清理历史打包产物
# 用法：bash scripts/clean-dist.sh [--full]
#   默认：清 dist/（dmg/zip/blockmap/app）与打包中间产物 .package-build
#   --full：额外清 .next 与 .next-e2e（下次 dev/打包需完整重建，framework dist 不受影响）
# 保留 dist/buildResources 等配置目录；不触碰 node_modules 与 framework。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 清理打包产物（dist/、.package-build）"
rm -rf dist .package-build

if [ "${1:-}" = "--full" ]; then
  echo "==> --full：额外清理 .next/、.next-e2e/"
  rm -rf .next .next-e2e
fi

echo "完成。"
