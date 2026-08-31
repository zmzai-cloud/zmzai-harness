#!/usr/bin/env bash
# Lectern — macOS 一键发布：构建 → 上传 OSS → 直链清单
# 用法：bash scripts/release.sh [--skip-build] [--dry]
#   --skip-build   跳过构建，直接上传 dist/ 现有产物（补传/重跑用）
#   --dry          只列出上传清单，不实际上传
# 前置：cp scripts/.env.release.example .env.release 并填真实 OSS 配置。
set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_BUILD=0; DRY=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --dry) DRY=1 ;;
    *) echo "未知参数：$arg" >&2; exit 1 ;;
  esac
done

if [ ! -f .env.release ]; then
  echo "❌ 缺少 .env.release：cp scripts/.env.release.example .env.release 并填写 OSS 配置。" >&2
  exit 1
fi

if [ "$SKIP_BUILD" -ne 1 ]; then
  echo "==> 构建 macOS 产物（dmg + zip）"
  bash scripts/build-mac.sh
fi

echo "==> 上传产物到 OSS"
node scripts/upload-oss.mjs $( [ "$DRY" -eq 1 ] && echo --dry )

echo "==> 完成。GitHub Release 归档（可选）：gh release create v$(node -e "console.log(require('./package.json').version)") dist/*.dmg dist/*.zip dist/SHA256SUMS.txt --generate-notes"
