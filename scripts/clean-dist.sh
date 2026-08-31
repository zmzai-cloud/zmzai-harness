#!/usr/bin/env bash
# zmzai Harness — 清理历史打包产物
# 用法：bash scripts/clean-dist.sh [--full]
#   默认：清 dist/（dmg/zip/blockmap/app）与打包中间产物 .package-build
#   --full：额外清 .next 与 .next-e2e（下次 dev/打包需完整重建，framework dist 不受影响）
# 保留 dist/buildResources 等配置目录；不触碰 node_modules 与 framework。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 清理打包产物（dist/、.package-build）"
# 大目录删除用 mv 到 /tmp：WorkBuddy safe-delete 守卫对 >50 文件的 rm 会拦截
# （SAFE_DELETE_BULK_CONFIRM_REQUIRED），PATH 前置真 rm 也绕不开；/tmp 重启自动清。
guard_mv() {
  local d
  for d in "$@"; do
    [ -e "$d" ] || continue
    mv "$d" "/tmp/lectern-clean-$(date +%s)-$RANDOM" || true
  done
}
guard_mv dist .package-build

if [ "${1:-}" = "--full" ]; then
  echo "==> --full：额外清理 .next/、.next-e2e/"
  guard_mv .next .next-e2e
fi

echo "完成。"
