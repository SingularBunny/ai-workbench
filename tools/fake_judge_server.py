#!/usr/bin/env python3
"""Fake OpenAI-compatible judge for tools/validate_in_docker.sh.

Answers POST /v1/chat/completions with verdict PASS for every criterion in the request. Checks
only the path "skill installed → script reached the provider → report built", not judge quality.
    python3 tools/fake_judge_server.py <port>
"""
import http.server
import json
import re
import sys


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        ids = re.findall(r'- id "([^"]+)"', req["messages"][1]["content"])
        verdict = {"criteria": [{"id": i, "critique": "fake judge", "verdict": "PASS"} for i in ids]}
        body = json.dumps({"choices": [{"message": {"content": json.dumps(verdict, ensure_ascii=False)}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
