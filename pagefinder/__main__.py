"""Entry point for python -m pagefinder."""

from pagefinder.main import main as _cli_main
import argparse


def main():
    parser = argparse.ArgumentParser(
        description="Crawl a site and rank pages for a task/goal."
    )
    parser.add_argument("entry_url", help="Root URL to crawl.")
    parser.add_argument(
        "goals",
        nargs="*",
        help="Optional goals/tasks to rank immediately; otherwise prompts interactively.",
    )
    parser.add_argument(
        "--use-llm",
        action="store_true",
        help="Use OpenAI embeddings to score semantic similarity.",
    )
    parser.add_argument(
        "--llm-model",
        default=None,
        help="Override embedding model name (default: text-embedding-3-small).",
    )
    parser.add_argument(
        "--pagerank-weight",
        type=float,
        default=0.2,
        help="Blend weight for PageRank when using LLM similarity (0-1).",
    )
    parser.add_argument(
        "--hybrid-expand",
        action="store_true",
        help="If similarity is low, expand crawl from top candidates and retry ranking.",
    )
    parser.add_argument(
        "--hybrid-threshold",
        type=float,
        default=0.3,
        help="Trigger expansion if best score is below this value.",
    )
    parser.add_argument(
        "--hybrid-max-new",
        type=int,
        default=5,
        help="Maximum new pages to crawl during a hybrid expansion.",
    )
    parser.add_argument(
        "--hybrid-frontier-k",
        type=int,
        default=3,
        help="Use outbound links from top-k pages as the expansion frontier.",
    )
    args = parser.parse_args()

    _cli_main(
        args.entry_url,
        args.goals if args.goals else None,
        use_llm=args.use_llm,
        llm_model=args.llm_model,
        pagerank_weight=args.pagerank_weight,
        hybrid_expand=args.hybrid_expand,
        hybrid_threshold=args.hybrid_threshold,
        hybrid_max_new=args.hybrid_max_new,
        hybrid_frontier_k=args.hybrid_frontier_k,
    )


if __name__ == "__main__":
    main()
