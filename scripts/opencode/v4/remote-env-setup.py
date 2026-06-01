#!/usr/bin/env python3
import re
from pathlib import Path

ENV_PATHS = [
    "/opt/gmp-api/backend/.env",
    "/var/www/mari-pepa/backend/.env",
    "/var/www/mari-pepa/frontend/.env.production",
    "/var/www/mari-pepa/frontend/.env.local",
    "/var/www/mari-pepa/frontend/.env",
]

WANTED = [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "GITHUB_TOKEN",
    "CHROMADB_URL",
    "REDIS_HOST",
    "PROMETHEUS_PUSHGATEWAY_URL",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "GITHUB_OWNER",
    "GMP_REPO",
    "GRANJA_REPO",
    "MOBILE_TRIGGER_KEYWORD",
    "DAILY_DIGEST_HOUR",
    "DAILY_DIGEST_TZ",
    "STAGING_BASE_PORT",
    "RAG_CHUNK_SIZE",
    "RAG_OVERLAP",
    "RAG_SIMILARITY_THRESHOLD",
    "ELEVENLABS_BRIDGE_PORT",
    "ELEVENLABS_BRIDGE_URL",
]

DEFAULTS = {
    "CHROMADB_URL": "http://localhost:8000",
    "REDIS_HOST": "127.0.0.1",
    "PROMETHEUS_PUSHGATEWAY_URL": "http://localhost:9091",
    "GITHUB_OWNER": "jlp717",
    "GMP_REPO": "gmp_app_mobilidad",
    "GRANJA_REPO": "granja_mari_pepa",
    "MOBILE_TRIGGER_KEYWORD": "equipo",
    "DAILY_DIGEST_HOUR": "08:00",
    "DAILY_DIGEST_TZ": "Europe/Madrid",
    "STAGING_BASE_PORT": "4000",
    "RAG_CHUNK_SIZE": "500",
    "RAG_OVERLAP": "50",
    "RAG_SIMILARITY_THRESHOLD": "1.2",
    "ELEVENLABS_BRIDGE_PORT": "8765",
    "ELEVENLABS_BRIDGE_URL": "http://192.168.1.230:8765",
}


def parse_env(path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    p = Path(path)
    if not p.exists():
        return values
    for raw in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            continue
        values[key] = value.strip().strip('"').strip("'")
    return values


def main() -> None:
    vals: dict[str, str] = {}
    sources: dict[str, str] = {}
    for path in ENV_PATHS:
        for key, value in parse_env(path).items():
            if key not in vals and value:
                vals[key] = value
                sources[key] = path
    for key, value in DEFAULTS.items():
        vals.setdefault(key, value)
        sources.setdefault(key, "default-v4")

    target = Path("/opt/gmp-tools/.env")
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        for key in WANTED:
            if key in vals:
                handle.write(f"{key}={vals[key]}\n")

    print(f"ENV_WRITTEN:{target}")
    for key in WANTED:
        present = bool(vals.get(key))
        source = sources.get(key, "missing") if present else "missing"
        print(f"{key}: {'OK' if present else 'MISSING'} ({source})")


if __name__ == "__main__":
    main()
