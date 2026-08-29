# 求职星计划 — 本地语义重排（bge-reranker-v2-m3）
# 用法：echo '{"query":"...","docs":["...","..."]}' | python rerank_local.py
# 输出：JSON 数组 [score1, score2, ...]（与 docs 顺序一致，归一化 0-1）

import sys
import json


def main():
    data = json.loads(sys.stdin.read())
    query = data.get("query", "")
    docs = data.get("docs", [])
    if not docs:
        print(json.dumps([]))
        return

    from FlagEmbedding import FlagReranker

    reranker = FlagReranker("BAAI/bge-reranker-v2-m3", use_fp16=True)
    pairs = [[query, d] for d in docs]
    scores = reranker.compute_score(pairs, normalize=True)
    if not isinstance(scores, list):
        scores = [scores]
    print(json.dumps([float(s) for s in scores]))


if __name__ == "__main__":
    main()
