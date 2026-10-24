import json
import os
import sys
import time

from app.retrieve import top_k

EVAL_FILE = os.path.join(os.path.dirname(__file__), "eval_set.json")
K = 5
MODE = sys.argv[1] if len(sys.argv) > 1 else "hybrid"


def main():
    with open(EVAL_FILE, encoding="utf-8") as f:
        cases = json.load(f)

    hit1 = hit3 = hit_k = 0
    reciprocal_ranks = []
    misses = []

    for i, case in enumerate(cases, start=1):
        results = top_k(case["question"], k=K, document_name=case["document"], mode=MODE)
        pages = [r["page_number"] for r in results]
        expected = case["expected_pages"]

        rank = next((n for n, p in enumerate(pages, start=1) if p in expected), None)

        if rank is not None:
            hit_k += 1
            hit3 += rank <= 3
            hit1 += rank == 1
            reciprocal_ranks.append(1 / rank)
        else:
            reciprocal_ranks.append(0.0)
            misses.append((case["question"], expected, pages))

        status = f"rank {rank}" if rank else "MISS"
        print(f"{i:>2}. [{status}] {case['question']}  (expected {expected}, got {pages})")
        time.sleep(0.5)  # stay under the free-tier embedding limit

    n = len(cases)
    print("\n" + "=" * 50)
    print(f"Mode:             {MODE}")
    print(f"Questions:        {n}")
    print(f"Hit@1:            {hit1 / n:.0%}")
    print(f"Hit@3:            {hit3 / n:.0%}")
    print(f"Hit@{K}:            {hit_k / n:.0%}")
    print(f"MRR:              {sum(reciprocal_ranks) / n:.3f}")

    if misses:
        print("\nMissed questions:")
        for q, expected, got in misses:
            print(f"  - {q}\n    expected {expected}, retrieved {got}")


if __name__ == "__main__":
    main()