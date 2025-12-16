#!/usr/bin/env python3
"""ASR Health Check"""
import os
import sys
import urllib.request

def main():
    port = os.environ.get("PORT", "8000")
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/health", timeout=5) as r:
            sys.exit(0 if r.status == 200 else 1)
    except Exception:
        sys.exit(1)

if __name__ == "__main__":
    main()
