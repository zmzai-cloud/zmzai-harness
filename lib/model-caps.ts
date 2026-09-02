/**
 * 模型能力缓存（进程级，跨请求共享）。
 *
 * 为什么需要这一层：relay `/models` 返回每个模型的真实上下文窗口
 * （maxInputTokens）与最大输出（maxOutputTokens），但 provider 的 `getModel`
 * 是同步契约、runtime 又是跨请求单例——不可能每次解析模型都去问一次 relay。
 * 这里让请求链路顺手把模型目录灌进进程内缓存，provider 同步查询。
 *
 * 未命中（目录尚未加载或不含该 id）返回 undefined，调用方回落默认常量，
 * 行为与改造前完全一致——所以「首次 prompt 早于 /api/models」只是少用一次
 * 真实值，不会退化成错误。
 */

/** 模型真实能力；字段缺失表示该模型目录未覆盖此维度。 */
export type ModelCaps = {
  contextWindow?: number;
  maxTokens?: number;
};

type CapsStore = { __lecternModelCaps?: Map<string, ModelCaps> };

function store(): Map<string, ModelCaps> {
  const g = globalThis as CapsStore;
  return (g.__lecternModelCaps ??= new Map());
}

/** 正整数才采纳：目录里的 0 / null / 非数字一律视为「未覆盖」，避免把窗口
 *  算成 0 导致每轮都触发压缩。 */
function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 灌入模型目录（幂等，后写覆盖）。任何拉到 relay 模型列表的地方都应调用。 */
export function primeModelCaps(
  list: readonly { model?: string; maxInputTokens?: number; maxOutputTokens?: number }[] | null | undefined,
): void {
  if (!list?.length) return;
  const map = store();
  for (const entry of list) {
    const id = entry?.model?.trim();
    if (!id) continue;
    const caps: ModelCaps = {};
    const contextWindow = positive(entry.maxInputTokens);
    const maxTokens = positive(entry.maxOutputTokens);
    if (contextWindow !== undefined) caps.contextWindow = contextWindow;
    if (maxTokens !== undefined) caps.maxTokens = maxTokens;
    map.set(id, caps);
  }
}

/** 同步查询模型真实能力；未命中返回 undefined（调用方回落默认值）。 */
export function capsFor(modelId: string | undefined | null): ModelCaps | undefined {
  if (!modelId) return undefined;
  return store().get(modelId);
}

/** 已覆盖的模型数（诊断用，/api/models 可透出以确认目录是否生效）。 */
export function primedModelCount(): number {
  return store().size;
}
