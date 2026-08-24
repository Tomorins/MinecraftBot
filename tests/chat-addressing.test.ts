import { describe, expect, it } from 'vitest'
import { parseAddressedChat } from '../src/chat/chat-controller.js'
import { sameMinecraftUsername } from '../src/core/minecraftIdentity.js'

describe('Minecraft natural chat addressing', () => {
  it('recognizes the configured in-game username without requiring a fixed prefix', () => {
    expect(parseAddressedChat('AI_Player，跟我来', 'AI_Player')).toEqual({
      addressedToAi: true,
      utterance: '跟我来',
      reason: 'username'
    })
    expect(parseAddressedChat('大家先回基地', 'AI_Player').addressedToAi).toBe(false)
  })

  it('treats a whisper as directly addressed and avoids partial username matches', () => {
    expect(parseAddressedChat('你在哪里', 'AI_Player', true).reason).toBe('whisper')
    expect(parseAddressedChat('AI_PlayerTwo 过来', 'AI_Player').addressedToAi).toBe(false)
  })

  it('matches the configured primary player without depending on capitalization', () => {
    expect(sameMinecraftUsername('FuQiang', 'fuqiang')).toBe(true)
    expect(sameMinecraftUsername('Alex', 'FuQiang')).toBe(false)
  })
})
