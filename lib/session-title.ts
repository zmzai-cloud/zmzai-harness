import { streamOneText, type AgentFramework } from "@zmzai/agent-framework";

/**
 * AI 会话标题生成（framework spec §13.2 async title generation）：
 * 复用 runtime 的主聊天 provider 链路（端点/鉴权/降级与聊天完全一致）
 * 做一次 one-shot 补全，把用户首条消息总结成简短中文标题。
 * 返回 null 表示生成失败——调用方保留占位标题即可。
 */

const TITLE_SYSTEM_PROMPT =
  "你是会话标题生成器。根据用户消息概括任务意图，生成一个不超过12字的中文标题。" +
  "直接输出标题本身：不要引号、不要句号、不要任何解释或前缀。";

export async function generateSessionTitle(
  runtime: AgentFramework,
  sessionId: string,
  text: string,
): Promise<string | null> {
  try {
    const session = await runtime.store.getSession(sessionId);
    if (!session?.model) return null;
    const out = await streamOneText(
      // StreamFn 的 context 是宽类型（Context），这里断言到 streamOneText 的窄参数
      runtime.streamFor(session) as Parameters<typeof streamOneText>[0],
      runtime.modelFor(session.model),
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
