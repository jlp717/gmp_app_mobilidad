export default async function AntiHallucinationGuardPlugin() {
  return {
    "tool.execute.before": async (input: any, output: any) => {
      const text = JSON.stringify({ input, args: output?.args })
      if (/192\.168\.(?!1\.(230|22|191)\b)\d+\.\d+/.test(text)) {
        throw new Error("S04_IP_NO_RECONOCIDA: verificar IP antes de escribir")
      }
      if (/(password=|token=|secret=|apikey=|bearer=|credentials=)/i.test(text)) {
        throw new Error("S01_SECRET_LITERAL: secreto literal bloqueado")
      }
    },
  }
}
