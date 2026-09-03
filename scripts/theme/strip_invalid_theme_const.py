#!/usr/bin/env python3
"""Remove const from constructors that use AppTheme color getters."""

from __future__ import annotations

import re
from pathlib import Path

GETTERS = re.compile(
    r"(?:AppTheme\.(darkBase|darkSurface|darkCard|borderColor|inkSurface|"
    r"raisedSurface|softPanel|mutedPanel|surfaceCommand|surfaceOverlay|"
    r"surfaceGlass|surfaceColor|textPrimary|textSecondary|textTertiary|"
    r"loginGradient|appShellGradient|panelGradient|commandGradient|"
    r"dataHeaderGradient|cardGradient|urgentGradient|successGradient)|"
    r"AppColors\.(textPrimary|textSecondary|textTertiary|darkBase|"
    r"darkSurface|darkCard|borderColor|backgroundColor|surfaceColor|"
    r"cardColor|surfaceVariant|outlineVariant|inversePrimary|themed\w+))\b"
)


def matching_paren(src: str, open_idx: int) -> int:
    depth = 0
    in_str = None
    escape = False
    for i, ch in enumerate(src[open_idx:], start=open_idx):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == in_str:
                in_str = None
            continue
        if ch in {'"', "'"}:
            in_str = ch
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
    return -1


def matching_bracket(src: str, open_idx: int, open_ch: str, close_ch: str) -> int:
    depth = 0
    in_str = None
    escape = False
    for i, ch in enumerate(src[open_idx:], start=open_idx):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == in_str:
                in_str = None
            continue
        if ch in {'"', "'"}:
            in_str = ch
            continue
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return i
    return -1


def strip_file(src: str) -> tuple[str, int]:
    updated = src
    changed = 0

    # static const / const locals assigned from AppTheme getters.
    updated, n = re.subn(
        r"\b(static\s+)?const\s+(\w+)\s*=\s*((?:AppTheme|AppColors)\.(?:"
        r"darkBase|darkSurface|darkCard|borderColor|inkSurface|raisedSurface|"
        r"softPanel|mutedPanel|surfaceCommand|surfaceOverlay|surfaceGlass|"
        r"surfaceColor|textPrimary|textSecondary|textTertiary|"
        r"loginGradient|appShellGradient|panelGradient|commandGradient|"
        r"dataHeaderGradient|cardGradient|urgentGradient|successGradient|"
        r"backgroundColor|cardColor|surfaceVariant|outlineVariant|inversePrimary)"
        r")\b",
        lambda m: f"{m.group(1) or ''}final {m.group(2)} = {m.group(3)}",
        updated,
    )
    changed += n

    out: list[str] = []
    i = 0
    while i < len(updated):
        if updated.startswith("const ", i) and (
            i == 0 or not (updated[i - 1].isalnum() or updated[i - 1] == "_")
        ):
            rest = updated[i + 6 :]
            match = re.match(
                r"((?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*)\s*\(",
                rest,
            )
            if match:
                open_idx = i + 6 + match.end() - 1
                close_idx = matching_paren(updated, open_idx)
                if close_idx != -1:
                    body = updated[open_idx : close_idx + 1]
                    if GETTERS.search(body):
                        out.append(updated[i + 6 : close_idx + 1])
                        i = close_idx + 1
                        changed += 1
                        continue
            if rest.lstrip().startswith("["):
                rel = len(rest) - len(rest.lstrip())
                open_idx = i + 6 + rel
                close_idx = matching_bracket(updated, open_idx, "[", "]")
                if close_idx != -1 and GETTERS.search(updated[open_idx : close_idx + 1]):
                    out.append(updated[i + 6 : close_idx + 1])
                    i = close_idx + 1
                    changed += 1
                    continue
        out.append(updated[i])
        i += 1
    return "".join(out), changed


def main() -> None:
    root = Path("lib")
    total = 0
    files = 0
    for path in root.rglob("*.dart"):
        text = path.read_text(encoding="utf-8")
        updated, count = strip_file(text)
        if count:
            path.write_text(updated, encoding="utf-8")
            files += 1
            total += count
            print(f"{count:3} {path}")
    print(f"TOTAL {total} consts removed in {files} files")


if __name__ == "__main__":
    main()
