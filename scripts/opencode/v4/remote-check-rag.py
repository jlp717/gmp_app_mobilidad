#!/usr/bin/env python3
import hashlib
import subprocess

import chromadb


def simple_embedding(text: str, dims: int = 64) -> list[float]:
    vec = [0.0] * dims
    for word in text.lower().split():
        digest = hashlib.sha256(word.encode()).digest()
        idx = int.from_bytes(digest[:2], "big") % dims
        vec[idx] += 1.0 if digest[2] % 2 == 0 else -1.0
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


def main() -> None:
    subprocess.run("ps -o pid,etime,pcpu,pmem,cmd -C python3 | grep rag-indexer || true", shell=True)
    client = chromadb.HttpClient(host="localhost", port=8000)
    names = [getattr(item, "name", str(item)) for item in client.list_collections()]
    print("collections:", ",".join(names))
    for name in names:
        try:
            coll = client.get_collection(name)
            print(f"{name}:count={coll.count()}")
        except Exception as exc:
            print(f"{name}:error={exc}")
    if "codebase" in names:
        coll = client.get_collection("codebase")
        result = coll.query(query_embeddings=[simple_embedding("pedidos endpoint express")], n_results=3)
        docs = result.get("documents", [[]])[0]
        metas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]
        print(f"query_results:{len(docs)}")
        for idx, doc in enumerate(docs):
            meta = metas[idx] if idx < len(metas) else {}
            distance = distances[idx] if idx < len(distances) else None
            print(f"result:{idx}:distance={distance}:file={meta.get('file')}")
            print((doc or "")[:160].replace("\n", " "))


if __name__ == "__main__":
    main()
