#!/usr/bin/env bash
# node-pty@1.1.0 的 prebuilds 里 spawn-helper 丢失可执行位（pnpm 安装后
# posix_spawnp failed）。安装/重装后统一补齐；找不到文件则静默跳过。
set -u
for helper in "$(pwd)"/node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/*/spawn-helper; do
  [ -f "$helper" ] || continue
  if [ ! -x "$helper" ]; then
    chmod +x "$helper"
    echo "[fix-node-pty] restored exec bit: $helper"
  fi
done
exit 0
