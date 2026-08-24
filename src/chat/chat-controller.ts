import type { Bot } from 'mineflayer'
import { Planner } from '../planner/planner.js'
import { SkillRuntime } from '../skills/runtime.js'
import { EventBus } from '../core/event-bus.js'
import { logger } from '../logger.js'
import { sameMinecraftUsername } from '../core/minecraftIdentity.js'

export class ChatController {
  private readonly chatListener: (username: string, message: string) => void
  private readonly whisperListener: (username: string, message: string) => void

  constructor(
    private readonly bot: Bot,
    private readonly planner: Planner,
    private readonly runtime: SkillRuntime,
    private readonly events: EventBus,
    private readonly owner: string,
    private readonly commandsEnabled = true
  ) {
    this.chatListener = (username, message) => { void this.onChat(username, message, 'public') }
    this.whisperListener = (username, message) => { void this.onChat(username, message, 'whisper') }
  }

  start(): void {
    this.bot.on('chat', this.chatListener)
    this.bot.on('whisper', this.whisperListener)
  }

  stop(): void {
    this.bot.off('chat', this.chatListener)
    this.bot.off('whisper', this.whisperListener)
  }

  private async onChat(username: string, message: string, channel: 'public' | 'whisper'): Promise<void> {
    if (sameMinecraftUsername(username, this.bot.username)) return
    const addressed = parseAddressedChat(message, this.bot.username, channel === 'whisper')
    this.events.emit(channel === 'whisper' ? 'whisper' : 'chat', {
      username,
      message,
      utterance: addressed.utterance,
      channel,
      aiUsername: this.bot.username,
      isPrimaryUser: sameMinecraftUsername(username, this.owner),
      addressedToAi: addressed.addressedToAi,
      addressReason: addressed.reason
    }, sameMinecraftUsername(username, this.owner) ? 'normal' : 'low')
    if (!this.commandsEnabled) return
    if (!sameMinecraftUsername(username, this.owner) || !addressed.addressedToAi) return
    const command = addressed.utterance
    if (!command) {
      this.bot.chat(`${username}，我在。你可以直接说任务、停止、状态或帮助。`)
      return
    }
    try {
      if (/^(停止|停下|取消|stop|cancel)$/i.test(command)) {
        await this.planner.stop('stopped_by_owner')
        this.bot.chat('已停止当前任务。')
        return
      }
      if (/^(状态|进度|status)$/i.test(command)) {
        const task = this.planner.status()
        const skills = this.runtime.active().map(skill => skill.name).join('、') || '无'
        this.bot.chat(task ? `任务：${task.goal}；状态：${task.status}；步骤：${task.currentStep ?? '无'}；运行技能：${skills}` : '当前没有任务。')
        return
      }
      if (/^(帮助|help)$/i.test(command)) {
        this.bot.chat(`${this.bot.username} 跟着我 / 去 x y z / 制作物品 / 挖矿；也可以说停止或状态。`)
        return
      }
      const task = await this.planner.submit(command)
      if (task.status === 'completed') this.bot.chat(`任务完成：${task.goal}`)
      else if (task.status === 'failed') this.bot.chat(`任务失败：${this.resultReason(task.result)}`)
    } catch (error) {
      logger.error({ error, username, command }, 'chat command failed')
      this.bot.chat(`无法执行：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private resultReason(result: unknown): string {
    if (result && typeof result === 'object' && 'reason' in result) return String(result.reason)
    return '未知原因'
  }
}

export interface AddressedChat {
  addressedToAi: boolean
  utterance: string
  reason: 'username' | 'whisper' | 'implicit'
}

export function parseAddressedChat(message: string, aiUsername: string, isWhisper = false): AddressedChat {
  const trimmed = message.trim()
  if (isWhisper) return { addressedToAi: true, utterance: trimmed, reason: 'whisper' }
  const target = aiUsername.trim().toLocaleLowerCase()
  const source = trimmed.toLocaleLowerCase()
  if (!target) return { addressedToAi: false, utterance: trimmed, reason: 'implicit' }

  let offset = source.indexOf(target)
  while (offset >= 0) {
    const before = offset > 0 ? (source[offset - 1] ?? '') : ''
    const after = source[offset + target.length] ?? ''
    const isWord = (value: string) => /[a-z0-9_]/i.test(value)
    if (!isWord(before) && !isWord(after)) {
      const utterance = `${trimmed.slice(0, offset)}${trimmed.slice(offset + target.length)}`
        .replace(/^[\s@,，:：、.!！?？]+|[\s@,，:：、]+$/g, '')
        .trim()
      return { addressedToAi: true, utterance, reason: 'username' }
    }
    offset = source.indexOf(target, offset + target.length)
  }
  return { addressedToAi: false, utterance: trimmed, reason: 'implicit' }
}
