#!/usr/bin/env python3
import sys
from pathlib import Path

BASE = Path("/opt/gmp-tools/.env")
EXTRA = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/gmp-v4-extra.env")
REPORT_KEYS = [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "GITHUB_TOKEN",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "GITHUB_OWNER",
    "GMP_REPO",
    "GRANJA_REPO",
    "GMP_PRODUCTION_PORT",
    "GMP_HEALTH_URL",
    "GMP_HEALTH_USER_AGENT",
]


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.lstrip("\ufeff")] = value
    return values


def main() -> None:
    values = read_env(BASE)
    values.update(read_env(EXTRA))
    BASE.parent.mkdir(parents=True, exist_ok=True)
    with BASE.open("w", encoding="utf-8") as handle:
        for key in sorted(values):
            handle.write(f"{key}={values[key]}\n")
    EXTRA.unlink(missing_ok=True)
    BASE.chmod(0o600)
    for key in REPORT_KEYS:
        print(f"{key}:{'OK' if values.get(key) else 'MISSING'}")


if __name__ == "__main__":
    main()
