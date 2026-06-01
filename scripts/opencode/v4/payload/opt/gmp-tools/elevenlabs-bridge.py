#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
import subprocess
import time
import urllib.request

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
PORT = int(os.getenv("ELEVENLABS_BRIDGE_PORT", "8765"))


class BridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        text = str(body.get("text", ""))[:500]
        send_telegram = bool(body.get("send_to_telegram", False))
        if not ELEVENLABS_API_KEY or not ELEVENLABS_VOICE_ID:
            self.send_response(503)
            self.end_headers()
            self.wfile.write(b'{"error":"ElevenLabs not configured"}')
            return
        payload = json.dumps({
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.8},
        }).encode()
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}",
            data=payload,
            headers={
                "xi-api-key": ELEVENLABS_API_KEY,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                audio_data = response.read()
            audio_path = f"/tmp/voice-{int(time.time())}.mp3"
            with open(audio_path, "wb") as handle:
                handle.write(audio_data)
            telegram_sent = False
            if send_telegram and TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID:
                result = subprocess.run([
                    "curl", "-sS", "-X", "POST",
                    f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendVoice",
                    "-F", f"chat_id={TELEGRAM_CHAT_ID}",
                    "-F", f"voice=@{audio_path}",
                ], capture_output=True, text=True, timeout=30)
                telegram_sent = result.returncode == 0
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "audio_path": audio_path, "telegram_sent": telegram_sent}).encode())
        except Exception as exc:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(exc)}).encode())


if __name__ == "__main__":
    print(f"[ElevenLabs Bridge] escuchando en :{PORT}")
    HTTPServer(("0.0.0.0", PORT), BridgeHandler).serve_forever()
