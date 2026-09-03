#!/usr/bin/env python3
"""Rewrite Colors.* and Color(0x...) in lib/ to AppColors tokens (F1)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIB = ROOT / "lib"
APP_COLORS = ROOT / "lib/core/theme/app_colors.dart"
SKIP = {APP_COLORS.resolve()}

COLORS_MAP = {
    "Colors.transparent": "AppColors.transparent",
    "Colors.white10": "AppColors.themedWhite10",
    "Colors.white12": "AppColors.themedWhite12",
    "Colors.white24": "AppColors.themedWhite24",
    "Colors.white30": "AppColors.themedWhite30",
    "Colors.white38": "AppColors.themedWhite38",
    "Colors.white54": "AppColors.themedWhite54",
    "Colors.white60": "AppColors.themedWhite60",
    "Colors.white70": "AppColors.themedWhite70",
    "Colors.white": "AppColors.themedWhite",
    "Colors.black12": "AppColors.systemBlack12",
    "Colors.black26": "AppColors.systemBlack26",
    "Colors.black38": "AppColors.systemBlack38",
    "Colors.black45": "AppColors.systemBlack45",
    "Colors.black54": "AppColors.systemBlack54",
    "Colors.black87": "AppColors.systemBlack87",
    "Colors.black": "AppColors.systemBlack",
    "Colors.grey": "AppColors.systemGrey",
    "Colors.blueGrey": "AppColors.systemBlueGrey",
    "Colors.blueAccent": "AppColors.systemBlueAccent",
    "Colors.blue": "AppColors.systemBlue",
    "Colors.brown": "AppColors.systemBrown",
    "Colors.cyanAccent": "AppColors.systemCyanAccent",
    "Colors.cyan": "AppColors.systemCyan",
    "Colors.deepPurple": "AppColors.systemDeepPurple",
    "Colors.greenAccent": "AppColors.systemGreenAccent",
    "Colors.green": "AppColors.systemGreen",
    "Colors.lightBlue": "AppColors.systemLightBlue",
    "Colors.lightGreen": "AppColors.systemLightGreen",
    "Colors.orangeAccent": "AppColors.systemOrangeAccent",
    "Colors.orange": "AppColors.systemOrange",
    "Colors.pinkAccent": "AppColors.systemPinkAccent",
    "Colors.pink": "AppColors.systemPink",
    "Colors.purpleAccent": "AppColors.systemPurpleAccent",
    "Colors.purple": "AppColors.systemPurple",
    "Colors.redAccent": "AppColors.systemRedAccent",
    "Colors.red": "AppColors.systemRed",
    "Colors.amber": "AppColors.systemAmber",
    "Colors.teal": "AppColors.systemTeal",
}

SHADE_MAP = {
    ("amber", "50"): "systemAmber50",
    ("amber", "100"): "systemAmber100",
    ("amber", "700"): "systemAmber700",
    ("amber", "800"): "systemAmber800",
    ("amber", "900"): "systemAmber900",
    ("blue", "50"): "systemBlue50",
    ("blue", "300"): "systemBlue300",
    ("blue", "400"): "systemBlue400",
    ("blue", "700"): "systemBlue700",
    ("blueGrey", "200"): "systemBlueGrey200",
    ("brown", "300"): "systemBrown300",
    ("cyan", "400"): "systemCyan400",
    ("green", "50"): "systemGreen50",
    ("green", "400"): "systemGreen400",
    ("green", "700"): "systemGreen700",
    ("green", "800"): "systemGreen800",
    ("grey", "50"): "systemGrey50",
    ("grey", "100"): "systemGrey100",
    ("grey", "200"): "systemGrey200",
    ("grey", "300"): "systemGrey300",
    ("grey", "400"): "systemGrey400",
    ("grey", "500"): "systemGrey500",
    ("grey", "600"): "systemGrey600",
    ("grey", "700"): "systemGrey700",
    ("grey", "800"): "systemGrey800",
    ("orange", "300"): "systemOrange300",
    ("orange", "700"): "systemOrange700",
    ("pink", "400"): "systemPink400",
    ("purple", "50"): "systemPurple50",
    ("purple", "400"): "systemPurple400",
    ("purple", "700"): "systemPurple700",
    ("red", "700"): "systemRed700",
}

IMPORT = "import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';"
HEX_RE = re.compile(r"Color\(0x([0-9A-Fa-f]{8})\)")
SHADE_RE = re.compile(
    r"Colors\.(amber|blueGrey|blue|brown|cyan|green|grey|orange|pink|purple|red)"
    r"(?:\.shade(\d+)|\[(\d+)\])"
)
GETTER_RE = re.compile(r"AppColors\.(themed[A-Za-z0-9]+|textPrimary|textSecondary|textTertiary)\b")


def load_hex_tokens() -> dict[str, str]:
    text = APP_COLORS.read_text(encoding="utf-8")
    mapping: dict[str, str] = {}
    for match in re.finditer(
        r"static const Color (\w+) = Color\(0x([0-9A-Fa-f]{8})\)",
        text,
    ):
        mapping[match.group(2).upper()] = match.group(1)
    return mapping


def ensure_import(text: str) -> str:
    if IMPORT in text:
        return text
    if "import 'package:flutter/material.dart';" in text:
        return text.replace(
            "import 'package:flutter/material.dart';",
            "import 'package:flutter/material.dart';\n" + IMPORT,
            1,
        )
    return IMPORT + "\n" + text


def replace_shades(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        family = match.group(1)
        shade = match.group(2) or match.group(3)
        token = SHADE_MAP.get((family, shade))
        if not token:
            return match.group(0)
        return f"AppColors.{token}"

    return SHADE_RE.sub(repl, text)


def replace_colors(text: str) -> str:
    # Longest keys first so white70 beats white.
    # Do not match inside identifiers (AppColors.transparent contains Colors.transparent).
    for old in sorted(COLORS_MAP, key=len, reverse=True):
        text = re.sub(rf"(?<![A-Za-z]){re.escape(old)}\b", COLORS_MAP[old], text)
    return text


def replace_hex(text: str, hex_tokens: dict[str, str], missing: set[str]) -> str:
    def repl(match: re.Match[str]) -> str:
        hex_value = match.group(1).upper()
        token = hex_tokens.get(hex_value)
        if not token:
            missing.add(hex_value)
            token = f"legacy{hex_value}"
        return f"AppColors.{token}"

    return HEX_RE.sub(repl, text)


def append_missing_tokens(missing: set[str], hex_tokens: dict[str, str]) -> None:
    if not missing:
        return
    text = APP_COLORS.read_text(encoding="utf-8")
    marker = "  // END GENERATED F1 LEGACY TOKENS"
    additions = []
    for hex_value in sorted(missing):
        name = f"legacy{hex_value}"
        if name in hex_tokens.values():
            continue
        additions.append(f"  static const Color {name} = Color(0x{hex_value});")
        hex_tokens[hex_value] = name
    if not additions:
        return
    text = text.replace(marker, "\n".join(additions) + "\n" + marker)
    APP_COLORS.write_text(text, encoding="utf-8")


def main() -> None:
    hex_tokens = load_hex_tokens()
    missing: set[str] = set()
    updated_files = 0
    for path in sorted(LIB.rglob("*.dart")):
        if path.resolve() in SKIP:
            continue
        original = path.read_text(encoding="utf-8")
        text = replace_shades(original)
        text = replace_colors(text)
        text = replace_hex(text, hex_tokens, missing)
        if text == original:
            continue
        if "AppColors." in text:
            text = ensure_import(text)
        path.write_text(text, encoding="utf-8")
        updated_files += 1
        print(f"updated {path.relative_to(ROOT)}")
    append_missing_tokens(missing, hex_tokens)
    print(f"files={updated_files} missing_hex={len(missing)}")


if __name__ == "__main__":
    main()
