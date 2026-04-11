from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

DEFAULT_TIMEOUT = 20.0
DEFAULT_LIMIT = 8
CONFIG_PATH = Path.home() / ".config" / "searxng-search" / "config.json"


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return cast(dict[str, Any], json.loads(CONFIG_PATH.read_text()))
    except Exception as exc:  # pragma: no cover - defensive path
        raise SystemExit(f"Failed to parse config file {CONFIG_PATH}: {exc}") from exc


def resolve_api_base(config: dict[str, Any], override: str | None) -> str:
    api_base = override or os.getenv("SEARXNG_API_BASE") or config.get("api_base")
    if not api_base:
        raise SystemExit(
            "No SearXNG API base configured. Set SEARXNG_API_BASE, pass --api-base, "
            "or create ~/.config/searxng-search/config.json"
        )
    return api_base.rstrip("/")


def normalize_result(result: dict[str, Any]) -> dict[str, Any]:
    snippet = result.get("content") or result.get("snippet") or ""
    return {
        "title": result.get("title") or "",
        "url": result.get("url") or result.get("link") or "",
        "snippet": " ".join(str(snippet).split()),
        "engine": result.get("engine"),
        "engines": result.get("engines") or ([] if result.get("engine") is None else [result.get("engine")]),
        "score": result.get("score"),
        "category": result.get("category"),
        "published_date": result.get("publishedDate") or result.get("published_date"),
    }


def build_params(args: argparse.Namespace) -> dict[str, str]:
    params: dict[str, str] = {
        "q": args.query,
        "format": "json",
    }
    if args.category:
        params["categories"] = args.category
    if args.language:
        params["language"] = args.language
    if args.engines:
        params["engines"] = args.engines
    if args.time_range:
        params["time_range"] = args.time_range
    if args.page:
        params["pageno"] = str(args.page)
    if args.safe_search is not None:
        params["safesearch"] = str(args.safe_search)
    return params


def fetch_results(api_base: str, params: dict[str, str], timeout: float, headers: dict[str, str]) -> dict[str, Any]:
    url = urljoin(f"{api_base}/", "search") + "?" + urlencode(params)
    request_headers = {"Accept": "application/json", "User-Agent": "searxng-search/0.1"}
    request_headers.update(headers)
    request = Request(url, headers=request_headers)

    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").strip()
        raise SystemExit(f"SearXNG request failed with HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise SystemExit(f"Failed to reach SearXNG instance: {exc.reason}") from exc

    try:
        return cast(dict[str, Any], json.loads(body))
    except json.JSONDecodeError as exc:
        preview = body[:500]
        raise SystemExit(f"SearXNG did not return valid JSON. Response preview:\n{preview}") from exc


def format_human(result: dict[str, Any], index: int) -> str:
    lines = [f"{index}. {result['title']}", f"   {result['url']}"]
    if result["snippet"]:
        lines.append(f"   {result['snippet']}")
    meta = []
    if result.get("engine"):
        meta.append(f"engine: {result['engine']}")
    if result.get("category"):
        meta.append(f"category: {result['category']}")
    if result.get("published_date"):
        meta.append(f"published: {result['published_date']}")
    if meta:
        lines.append("   " + " | ".join(meta))
    return "\n".join(lines)


def dedupe_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for result in results:
        url = result.get("url") or ""
        if not url or url in seen:
            continue
        seen.add(url)
        deduped.append(result)
    return deduped


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Query a SearXNG instance")
    parser.add_argument("query", nargs="?", help="Search query. If omitted, read from stdin.")
    parser.add_argument("--api-base", help="Base URL of the SearXNG instance")
    parser.add_argument("--json", action="store_true", dest="json_output", help="Print normalized JSON output")
    parser.add_argument("--raw", action="store_true", help="Print raw JSON response from SearXNG")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help=f"Maximum results to print (default: {DEFAULT_LIMIT})")
    parser.add_argument("--category", help="SearXNG category filter")
    parser.add_argument("--language", help="Language code, e.g. en")
    parser.add_argument("--engines", help="Comma-separated engine names")
    parser.add_argument("--time-range", choices=["day", "month", "year"], help="Restrict recency")
    parser.add_argument("--page", type=int, help="Result page number")
    parser.add_argument("--safe-search", type=int, choices=[0, 1, 2], help="SearXNG safesearch level")
    parser.add_argument("--timeout", type=float, help=f"Request timeout in seconds (default: {DEFAULT_TIMEOUT})")
    args = parser.parse_args(argv)

    if not args.query:
        stdin_query = sys.stdin.read().strip()
        if not stdin_query:
            parser.error("query is required either as an argument or on stdin")
        args.query = stdin_query

    if args.limit < 1:
        parser.error("--limit must be >= 1")

    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    config = load_config()
    api_base = resolve_api_base(config, args.api_base)
    timeout = args.timeout or config.get("timeout") or DEFAULT_TIMEOUT
    headers = config.get("headers") or {}

    raw = fetch_results(api_base, build_params(args), timeout=float(timeout), headers=headers)
    if args.raw:
        json.dump(raw, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    normalized = dedupe_results([normalize_result(item) for item in raw.get("results", [])])
    normalized = normalized[: args.limit]
    payload = {
        "query": raw.get("query", args.query),
        "result_count": len(normalized),
        "results": normalized,
        "suggestions": raw.get("suggestions") or [],
        "infoboxes": raw.get("infoboxes") or [],
    }

    if args.json_output:
        json.dump(payload, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    if not normalized:
        print(f"No results found for: {args.query}")
        return 0

    print(f"SearXNG results for: {payload['query']}")
    print()
    for index, result in enumerate(normalized, start=1):
        print(format_human(result, index))
        if index != len(normalized):
            print()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
