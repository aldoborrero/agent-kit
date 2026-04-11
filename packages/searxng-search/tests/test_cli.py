import json

from searxng_search.cli import build_params, dedupe_results, normalize_result, parse_args


def test_normalize_result_maps_content_to_snippet():
    result = normalize_result(
        {
            "title": "Example",
            "url": "https://example.com",
            "content": "  hello\n world  ",
            "engine": "duckduckgo",
            "publishedDate": "2026-01-01",
        }
    )
    assert result == {
        "title": "Example",
        "url": "https://example.com",
        "snippet": "hello world",
        "engine": "duckduckgo",
        "engines": ["duckduckgo"],
        "score": None,
        "category": None,
        "published_date": "2026-01-01",
    }


def test_dedupe_results_uses_url():
    results = dedupe_results(
        [
            {"url": "https://example.com", "title": "A"},
            {"url": "https://example.com", "title": "B"},
            {"url": "https://example.org", "title": "C"},
        ]
    )
    assert [r["title"] for r in results] == ["A", "C"]


def test_build_params_contains_search_fields():
    args = parse_args([
        "query words",
        "--category",
        "general",
        "--language",
        "en",
        "--engines",
        "duckduckgo,startpage",
        "--time-range",
        "month",
        "--page",
        "2",
        "--safe-search",
        "1",
    ])
    assert build_params(args) == {
        "q": "query words",
        "format": "json",
        "categories": "general",
        "language": "en",
        "engines": "duckduckgo,startpage",
        "time_range": "month",
        "pageno": "2",
        "safesearch": "1",
    }


def test_parse_args_reads_stdin(monkeypatch):
    monkeypatch.setattr("sys.stdin.read", lambda: "stdin query")
    args = parse_args([])
    assert args.query == "stdin query"
