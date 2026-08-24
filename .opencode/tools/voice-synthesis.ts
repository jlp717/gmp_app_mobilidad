import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

function json(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

function mobileMode() {
  return process.env.OPENCODE_CLIENT_TYPE === "mobile" || process.env.OPENCODE_MOBILE_MODE === "true"
}

export default tool({
  description: "Sintetiza respuestas cortas por ElevenLabs y opcionalmente las envia a Telegram.",
  args: {
    text: tool.schema.string().min(1).max(500).describe("Texto a sintetizar, maximo 500 caracteres."),
    voice_id: tool.schema.string().optional().describe("Voice ID de ElevenLabs. Usa ELEVENLABS_VOICE_ID por defecto."),
    output_format: tool.schema.string().default("mp3_44100_128"),
    send_to_telegram: tool.schema.boolean().default(false),
  },
  async execute(args) {
    if (!mobileMode()) return json({ audio_url: undefined, telegram_sent: false, error: "Voice synthesis solo disponible en mobile mode" })
    const apiKey = process.env.ELEVENLABS_API_KEY
    const voiceId = args.voice_id || process.env.ELEVENLABS_VOICE_ID
    if (!apiKey || !voiceId) return json({ telegram_sent: false, error: "ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID no configurado" })

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(args.output_format)}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: args.text.slice(0, 500),
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
      }),
    })
    if (!response.ok) return json({ telegram_sent: false, error: `ElevenLabs HTTP ${response.status}: ${await response.text()}` })

    const audio = Buffer.from(await response.arrayBuffer())
    const audioPath = path.join(process.env.VOICE_TMP_DIR || os.tmpdir(), `voice-${Date.now()}.mp3`)
    await fs.writeFile(audioPath, audio)
    let telegramSent = false
    if (args.send_to_telegram) telegramSent = await sendTelegramVoice(audio, audioPath)
    return json({
      audio_url: audioPath,
      telegram_sent: telegramSent,
      duration_seconds: Math.max(1, Math.round(args.text.length / 13)),
    })
  },
})

async function sendTelegramVoice(audio: Buffer, filename: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return false
  const form = new FormData()
  form.set("chat_id", chatId)
  form.set("voice", new Blob([audio], { type: "audio/mpeg" }), path.basename(filename))
  const response = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, { method: "POST", body: form })
  return response.ok
}
