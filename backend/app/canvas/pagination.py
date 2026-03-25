"""
RFC 5988 Link header parser for Canvas API pagination.
Canvas returns: Link: <url>; rel="next", <url>; rel="last", ...
"""
import re


def parse_next_url(link_header: str | None) -> str | None:
    """Extract the 'next' URL from a Link header, or None if not present."""
    if not link_header:
        return None

    # Match each <url>; rel="relation" segment
    pattern = r'<([^>]+)>;\s*rel="([^"]+)"'
    for match in re.finditer(pattern, link_header):
        url, rel = match.group(1), match.group(2)
        if rel == "next":
            return url

    return None
