import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EngineRuntime, expandPlaceholders, collectMcpEntries } from "./engine.js";

function makeRuntime() {
  const dataDir = mkdtempSync(join(tmpdir(), "harness-test-data-"));
  const ws = mkdtempSync(join(tmpdir(), "harness-test-ws-"));
  writeFileSync(join(ws, "hello.txt"), "hi");
  mkdirSync(join(ws, "sub"));
  writeFileSync(join(ws, "sub", "nested.txt"), "nested");
  return new EngineRuntime({ dataDir, workspaceRoot: ws });
}

describe("EngineRuntime 路径越界防护", () => {
  it("readFile 拒绝 ../ 逃逸与工作区外绝对路径", async () => {
    const rt = makeRuntime();
    await expect(rt.readFile("../escape.txt")).resolves.toBeNull();
    await expect(rt.readFile("sub/../../escape.txt")).resolves.toBeNull();
    const outside = join(tmpdir(), "outside-secret.txt");
    writeFileSync(outside, "secret");
    await expect(rt.readFile(outside)).resolves.toBeNull(); // 绝对路径直接逃出 workspace root
    await expect(rt.readFile("/etc/hosts")).resolves.toBeNull();
    await expect(rt.readFile("hello.txt")).resolves.toBe("hi");
  });

  it("listDir 对越界路径返回空数组，正常相对路径可用", async () => {
    const rt = makeRuntime();
    await expect(rt.listDir("../")).resolves.toEqual([]);
    await expect(rt.listDir("..")).resolves.toEqual([]);
    const root = await rt.listDir("");
    expect(root.map((e) => e.name).sort()).toEqual(["hello.txt", "sub"]);
    const sub = await rt.listDir("sub");
    expect(sub).toEqual([expect.objectContaining({ name: "nested.txt", isDirectory: false })]);
  });
});

describe("expandPlaceholders / collectMcpEntries", () => {
  it("展开 PLUGIN_ROOT/PLUGIN_DATA 并做 server 名限定", () => {
    expect(expandPlaceholders("a${PLUGIN_ROOT}b/${PLUGIN_DATA}", { "${PLUGIN_ROOT}": "/R", "${PLUGIN_DATA}": "/D" })).toBe(
      "a/Rb//D",
    );

    const pluginsRoot = "/ws/.zmzai/plugins";
    const dataRoot = "/data/plugins";
    const entries = collectMcpEntries({
      pluginsRoot,
      pluginDataRoot: dataRoot,
      parsed: [
        {
          manifest: { name: "demo" },
          mcpServers: {
            local: {
              type: "stdio",
              command: "${PLUGIN_ROOT}/bin/server.mjs",
              args: ["--data", "${PLUGIN_DATA}"],
              cwd: "${PLUGIN_ROOT}",
            },
            remote: { type: "sse", url: "https://mcp.example.com/sse" },
          },
        },
      ],
    });

    expect(entries.map((e) => e.name)).toEqual(["demo:local", "demo:remote"]);
    const [local, remote] = entries;
    if (local.spec.type !== "stdio") throw new Error("应为 stdio");
    expect(local.spec.command).toBe(join(pluginsRoot, "demo") + "/bin/server.mjs");
    expect(local.spec.args).toEqual(["--data", join(dataRoot, "demo")]);
    expect(local.spec.cwd).toBe(join(pluginsRoot, "demo"));
    if (remote.spec.type !== "sse") throw new Error("远端应原样透传");
    expect(remote.spec.url).toBe("https://mcp.example.com/sse");
  });

  it("initMcpServers 在无插件时返回空且不抛错", async () => {
    const rt = makeRuntime();
    await expect(rt.initMcpServers()).resolves.toEqual([]);
    rt.dispose();
  });
});
