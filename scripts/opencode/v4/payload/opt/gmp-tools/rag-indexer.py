#!/usr/bin/env python3
import hashlib
import json
import os
import urllib.request
from datetime import datetime
from pathlib import Path

import chromadb

CHROMA_URL = os.getenv("CHROMADB_URL", "http://localhost:8000")
GMP_ROOT = os.getenv("GMP_ROOT", "/opt/gmp-api")
GRANJA_ROOT = os.getenv("GRANJA_ROOT", "/var/www/mari-pepa")
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "500"))
CHUNK_OVERLAP = int(os.getenv("RAG_OVERLAP", "50"))
MAX_FILE_BYTES = int(os.getenv("RAG_MAX_FILE_BYTES", "500000"))
MAX_FILES_PER_ROOT = int(os.getenv("RAG_MAX_FILES_PER_ROOT", "800"))
MAX_CHUNKS_TOTAL = int(os.getenv("RAG_MAX_CHUNKS_TOTAL", "3000"))
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_OWNER = os.getenv("GITHUB_OWNER", "")
GMP_REPO = os.getenv("GMP_REPO", "")
GRANJA_REPO = os.getenv("GRANJA_REPO", "")

COLLECTIONS = [
    "codebase",
    "documentation",
    "github_issues",
    "github_prs",
    "conversations",
    "user_corrections",
    "lessons",
    "anti_patterns",
    "tech_radar",
    "security_findings",
]


def chroma_client():
    host = CHROMA_URL.replace("http://", "").replace("https://", "").split(":")[0]
    port = int(CHROMA_URL.rstrip("/").split(":")[-1])
    return chromadb.HttpClient(host=host, port=port)


client = chroma_client()
chunks_written = 0


def collection(name):
    try:
        return client.get_collection(name)
    except Exception:
        return client.create_collection(name)


def reset_collection(name):
    try:
        client.delete_collection(name)
    except Exception:
        pass
    return client.create_collection(name)


def simple_embedding(text, dims=64):
    vec = [0.0] * dims
    for word in text.lower().split():
        digest = hashlib.sha256(word.encode()).digest()
        idx = int.from_bytes(digest[:2], "big") % dims
        sign = 1.0 if digest[2] % 2 == 0 else -1.0
        vec[idx] += sign
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


def ensure_collections():
    for name in COLLECTIONS:
        collection(name)


def chunks(text):
    words = text.split()
    step = max(1, CHUNK_SIZE - CHUNK_OVERLAP)
    return [" ".join(words[i:i + CHUNK_SIZE]) for i in range(0, len(words), step) if words[i:i + CHUNK_SIZE]]


def index_file(coll, path, root_name):
    global chunks_written
    text = path.read_text(encoding="utf-8", errors="ignore")
    for idx, chunk in enumerate(chunks(text)):
        if chunks_written >= MAX_CHUNKS_TOTAL:
            return False
        doc_id = hashlib.sha256(f"{path}:{idx}".encode()).hexdigest()[:24]
        coll.upsert(
            ids=[doc_id],
            documents=[chunk],
            embeddings=[simple_embedding(chunk)],
            metadatas=[{
                "file": str(path),
                "root": root_name,
                "chunk": idx,
                "date": datetime.utcnow().isoformat() + "Z",
            }],
        )
        chunks_written += 1
    return True


def index_codebase(root, root_name):
    coll = collection("codebase")
    extensions = {".dart", ".ts", ".tsx", ".js", ".mjs", ".py", ".sql", ".yaml", ".yml", ".json", ".md"}
    excluded = {
        "node_modules", ".git", "dist", "build", ".dart_tool", ".pub-cache", ".next",
        "coverage", "uploads", "logs", "tmp", "temp", "cache", ".venv", "__pycache__",
    }
    base = Path(root)
    if not base.exists():
        print(f"[RAG] root no existe: {root}")
        return
    total = 0
    for path in base.rglob("*"):
        if total >= MAX_FILES_PER_ROOT or chunks_written >= MAX_CHUNKS_TOTAL:
            break
        if not path.is_file() or path.suffix.lower() not in extensions:
            continue
        parts = set(path.parts)
        if parts.intersection(excluded):
            continue
        if path.stat().st_size > MAX_FILE_BYTES:
            continue
        try:
            index_file(coll, path, root_name)
            total += 1
        except Exception as exc:
            print(f"[RAG] error indexando {path}: {exc}")
    print(f"[RAG] {root_name}: {total} archivos indexados")


def index_docs(root, root_name):
    coll = collection("documentation")
    base = Path(root)
    candidates = [base / "AGENTS.md", base / "README.md", base / "CLAUDE.md", base / ".opencode" / "AGENTS.md"]
    candidates.extend((base / "docs").rglob("*.md") if (base / "docs").exists() else [])
    for path in candidates:
        if path.exists() and path.is_file():
            try:
                index_file(coll, path, root_name)
            except Exception as exc:
                print(f"[RAG] error docs {path}: {exc}")


def github_get(url):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "gmp-rag-indexer",
    })
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read())


def index_github_issues(owner, repo):
    if not GITHUB_TOKEN or not owner or not repo:
        print(f"[RAG] GitHub omitido para {repo}: faltan variables")
        return
    coll = collection("github_issues")
    page = 1
    while True:
        url = f"https://api.github.com/repos/{owner}/{repo}/issues?state=all&per_page=50&page={page}"
        issues = github_get(url)
        if not issues:
            break
        for issue in issues:
            if "pull_request" in issue:
                continue
            text = f"#{issue['number']} {issue['title']}\n{issue.get('body') or ''}"
            coll.upsert(
                ids=[f"{repo}-issue-{issue['number']}"],
                documents=[text],
                embeddings=[simple_embedding(text)],
                metadatas=[{
                    "repo": repo,
                    "number": issue["number"],
                    "state": issue["state"],
                    "labels": ",".join(label["name"] for label in issue.get("labels", [])),
                    "date": issue["created_at"],
                }],
            )
        page += 1
    print(f"[RAG] issues indexadas: {owner}/{repo}")


def index_github_prs(owner, repo):
    if not GITHUB_TOKEN or not owner or not repo:
        return
    coll = collection("github_prs")
    page = 1
    while True:
        pulls = github_get(f"https://api.github.com/repos/{owner}/{repo}/pulls?state=all&per_page=30&page={page}")
        if not pulls:
            break
        for pr in pulls:
            files = github_get(f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr['number']}/files")
            changed = "\n".join(f"{item['filename']}\n{item.get('patch', '')}" for item in files[:20])
            text = f"PR #{pr['number']} {pr['title']}\n{pr.get('body') or ''}\n{changed}"
            coll.upsert(
                ids=[f"{repo}-pr-{pr['number']}"],
                documents=[text],
                embeddings=[simple_embedding(text)],
                metadatas=[{"repo": repo, "number": pr["number"], "state": pr["state"], "date": pr["created_at"]}],
            )
        page += 1
    print(f"[RAG] PRs indexadas: {owner}/{repo}")


if __name__ == "__main__":
    print("[RAG Indexer] inicio")
    ensure_collections()
    reset_collection("codebase")
    reset_collection("documentation")
    reset_collection("github_issues")
    reset_collection("github_prs")
    index_codebase(GMP_ROOT, "gmp")
    index_docs(GMP_ROOT, "gmp")
    index_codebase(GRANJA_ROOT, "granja")
    index_docs(GRANJA_ROOT, "granja")
    for repo in [GMP_REPO, GRANJA_REPO]:
        if repo:
            index_github_issues(GITHUB_OWNER, repo)
            index_github_prs(GITHUB_OWNER, repo)
    print("[RAG Indexer] completo")
