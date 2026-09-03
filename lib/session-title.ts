import { streamOneText, type AgentFramework, type ModelRef } from "@zmzai/agent-framework";

/**
 * AI 会话标题生成（framework spec §13.2 async title generation）：
 * 复用 runtime 的主聊天 provider 链路（端点/鉴权/降级与聊天完全一致）
 * 做一次 one-shot 补全，把用户首条消息总结成简短中文标题。
 * 返回 null 表示生成失败——调用方保留占位标题即可。
 *
 * `model` 为本次实际使用的模型：runner 不会把 prompt 传入的 model 回写
 * session.model，所以标题生成必须由调用方显式带上当轮模型，否则会落到
 * 会话创建时的旧模型（乃至 env 兜底）。缺省时回落 session.model。
 */

const TITLE_SYSTEM_PROMPT =
  "你是会话标题生成器。根据用户消息概括任务意图，生成一个不超过12字的中文标题。" +
  "直接输出标题本身：不要引号、不要句号、不要任何解释或前缀。";

export async function generateSessionTitle(
  runtime: AgentFramework,
  sessionId: string,
  text: string,
  model?: ModelRef,
): Promise<string | null> {
  try {
    const session = await runtime.store.getSession(sessionId);
    if (!session) return null;
    const ref = model ?? session.model;
    if (!ref) return null;
    const out = await streamOneText(
      // StreamFn 的 context 是宽类型（Context），这里断言到 streamOneText 的窄参数
      runtime.streamFor(session) as Parameters<typeof streamOneText>[0],
      runtime.modelFor(ref),
      TITLE_SYSTEM_PROMPT,
      // 只带首条消息（截断防长文），一次性补全不追求上下文完整
      [{ role: "user", content: text.slice(0, 2000), timestamp: Date.now() } as never],
    );
    const title = out
      .replace(/^[\s"'“”「『《*]+|[\s"'“”」』》。*]+$/g, "")
      .split("\n")[0]
      .trim()
      .slice(0, 30);
    return title || null;
  } catch {
    return null;
  }
}
