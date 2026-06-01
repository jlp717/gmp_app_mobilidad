#!/usr/bin/env python3
import json
import re
import urllib.request
from datetime import datetime

STACK_KEYWORDS = [
    "flutter", "dart", "nextjs", "next.js", "tailwind", "shadcn", "node.js",
    "nodejs", "express", "typescript", "db2", "ibm i", "as400", "opencode",
    "anthropic", "claude", "docker", "prometheus", "grafana", "redis",
    "chromadb", "playwright", "k6", "pact", "oauth", "jwt", "horeca", "b2b",
]


def relevant(text):
    lower = text.lower()
    return any(keyword in lower for keyword in STACK_KEYWORDS)


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "GMP-TechRadar/1.0"})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read())


def fetch_hn_top():
    items = []
    try:
        ids = fetch_json("https://hacker-news.firebaseio.com/v0/topstories.json")[:50]
        for item_id in ids:
            try:
                item = fetch_json(f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json")
                text = f"{item.get('title', '')} {item.get('text', '')}"
                if item.get("score", 0) > 100 and relevant(text):
                    items.append({
                        "source": "hackernews",
                        "title": item.get("title", ""),
                        "url": item.get("url", f"https://news.ycombinator.com/item?id={item_id}"),
                        "score": item.get("score", 0),
                        "date": datetime.fromtimestamp(item.get("time", 0)).isoformat(),
                    })
                if len(items) >= 5:
                    break
            except Exception:
                continue
    except Exception as exc:
        items.append({"source": "hackernews", "error": str(exc)})
    return items


def fetch_github_trending():
    items = []
    for lang in ["dart", "typescript", "javascript", "python"]:
        try:
            data = fetch_json(f"https://api.github.com/search/repositories?q=language:{lang}&sort=stars&order=desc&per_page=3")
            for repo in data.get("items", []):
                items.append({
                    "source": "github_trending",
                    "title": f"{repo['full_name']}: {repo.get('description') or 'No description'}",
                    "url": repo["html_url"],
                    "stars": repo["stargazers_count"],
                    "date": repo.get("pushed_at", ""),
                })
        except Exception as exc:
            items.append({"source": "github_trending", "language": lang, "error": str(exc)})
    return items


def fetch_arxiv():
    items = []
    url = "https://export.arxiv.org/api/query?search_query=cat:cs.SE+OR+cat:cs.AI+OR+cat:cs.PL&sortBy=submittedDate&max_results=20"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GMP-TechRadar/1.0"})
        with urllib.request.urlopen(req, timeout=20) as response:
            xml = response.read().decode("utf-8", errors="ignore")
        for entry in re.findall(r"<entry>(.*?)</entry>", xml, flags=re.S):
            title = re.sub(r"\s+", " ", re.search(r"<title>(.*?)</title>", entry, flags=re.S).group(1)).strip()
            summary = re.sub(r"\s+", " ", re.search(r"<summary>(.*?)</summary>", entry, flags=re.S).group(1)).strip()
            if relevant(f"{title} {summary}"):
                items.append({
                    "source": "arxiv",
                    "title": title,
                    "url": re.search(r"<id>(.*?)</id>", entry).group(1),
                    "summary": summary[:300],
                    "date": re.search(r"<published>(.*?)</published>", entry).group(1),
                })
            if len(items) >= 3:
                break
    except Exception as exc:
        items.append({"source": "arxiv", "error": str(exc)})
    return items


if __name__ == "__main__":
    print(json.dumps({
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "hn": fetch_hn_top(),
        "github": fetch_github_trending(),
        "arxiv": fetch_arxiv(),
    }, indent=2, ensure_ascii=False))
