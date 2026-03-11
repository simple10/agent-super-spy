"""Stream only SSE responses to avoid buffering streaming API calls.

Set MITMPROXY_STREAM_SSE=false to disable and buffer all responses (useful for debugging).
"""

import os

from mitmproxy import http

enabled = os.environ.get("MITMPROXY_STREAM_SSE", "true").lower() != "false"


def responseheaders(flow: http.HTTPFlow):
    if not enabled:
        return
    content_type = flow.response.headers.get("content-type", "")
    if "text/event-stream" in content_type:
        flow.response.stream = True
