import type { LLMProvider, PlanningInput, RecoveryInput } from './provider.js'
import type { Plan, WorldContext } from '../types.js'
import { planSchema, chatSchema } from './schemas.js'
import { safeJson, sleep } from '../core/utils.js'
import type { AppConfig } from '../config.js'
import { logger } from '../logger.js'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<Record<string, unknown>>
}

export class OpenAICompatibleProvider implements LLMProvider {
  constructor(private readonly config: AppConfig['llm'], private readonly visionModel?: string) {}

  async plan(input: PlanningInput, signal?: AbortSignal): Promise<Plan> {
    const system = `你是Minecraft自主玩家的高层规划器。只输出JSON，不输出Markdown。你只能选择提供的Skill，不能虚构动作。
规则：
1. 输出最短可执行计划；原子移动和战斗细节由Skill处理。
2. params必须满足Skill参数；步骤依赖必须引用已有步骤ID。
3. 精确配方知识优先于模型记忆。缺少材料时先安排采集或取物。
4. 生存安全优先；不执行PVP、破坏他人建筑或超出权限的行为。
5. 无需行动的普通对话可以返回空steps。
JSON格式：{"goal":"目标","reply":"给玩家的简短回复","steps":[{"id":"step_1","skill":"技能名","params":{},"dependsOn":[],"onFailure":"retry|replan|abort"}],"assumptions":[]}`
    const user = safeJson({
      command: input.command,
      owner: input.owner,
      world: this.compactContext(input.context),
      skills: input.skills,
      exactKnowledge: input.exactKnowledge ?? null,
      guideKnowledge: input.guideKnowledge ?? null
    })
    return planSchema.parse(await this.completeJson([{ role: 'system', content: system }, { role: 'user', content: user }], signal)) as Plan
  }

  async recover(input: RecoveryInput, signal?: AbortSignal): Promise<Plan> {
    const system = `你是Minecraft任务恢复规划器。根据失败原因生成剩余恢复计划。只使用列出的Skill，只输出JSON。
JSON格式：{"goal":"目标","reply":"简短说明","steps":[],"assumptions":[]}`
    return planSchema.parse(await this.completeJson([
      { role: 'system', content: system },
      { role: 'user', content: safeJson({ ...input, context: this.compactContext(input.context) }) }
    ], signal)) as Plan
  }

  async chat(message: string, context: WorldContext, signal?: AbortSignal): Promise<string> {
    const response = chatSchema.parse(await this.completeJson([
      { role: 'system', content: '你是Minecraft中的AI队友。结合当前状态简短回答，只输出JSON：{"reply":"内容"}。' },
      { role: 'user', content: safeJson({ message, world: this.compactContext(context) }) }
    ], signal))
    return response.reply
  }

  async analyzeImage(prompt: string, base64Image: string, mimeType: string, signal?: AbortSignal): Promise<string> {
    const response = await this.complete([
      { role: 'system', content: '分析Minecraft视觉异常，只报告可行动的事实和不确定性。' },
      { role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
      ] }
    ], signal, undefined, this.visionModel ?? this.config.model)
    return response
  }

  private async completeJson(messages: ChatMessage[], signal?: AbortSignal): Promise<unknown> {
    const content = await this.complete(messages, signal, { type: 'json_object' })
    const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try {
      return JSON.parse(normalized) as unknown
    } catch {
      throw new Error(`LLM returned invalid JSON: ${normalized.slice(0, 300)}`)
    }
  }

  private async complete(messages: ChatMessage[], signal?: AbortSignal, responseFormat?: Record<string, unknown>, model = this.config.model): Promise<string> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('LLM request timeout')), this.config.timeoutMs)
      const abort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
      try {
        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.2,
            ...(responseFormat ? { response_format: responseFormat } : {})
          }),
          signal: controller.signal
        })
        if (!response.ok) {
          const body = await response.text()
          throw new Error(`LLM HTTP ${response.status}: ${body.slice(0, 500)}`)
        }
        const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
        const content = body.choices?.[0]?.message?.content
        if (!content) throw new Error('LLM response contained no message content')
        return content
      } catch (error) {
        lastError = error
        if (responseFormat && error instanceof Error && /LLM HTTP (400|404|422)/.test(error.message)) {
          logger.warn('LLM endpoint rejected response_format; retrying with prompt-enforced JSON')
          return this.complete(messages, signal, undefined, model)
        }
        if (signal?.aborted || attempt >= this.config.maxRetries) break
        logger.warn({ attempt, error }, 'LLM request failed; retrying')
        await sleep(500 * 2 ** attempt, signal)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private compactContext(context: WorldContext): unknown {
    return {
      self: context.snapshot.self,
      inventory: context.snapshot.inventory.map(item => ({ name: item.name, count: item.count, durabilityRemaining: item.durabilityRemaining })),
      scene: context.scene,
      currentTask: context.currentTask,
      memories: context.memories.slice(0, 15),
      recentEvents: context.snapshot.recentEvents.slice(-15)
    }
  }
}
