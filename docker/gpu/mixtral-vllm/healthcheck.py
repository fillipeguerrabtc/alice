#!/usr/bin/env python3
"""
Mixtral vLLM Health Check
Verifica se o servidor está respondendo corretamente.
"""

import os
import sys
import urllib.request
import urllib.error

def main():
    port = os.environ.get("PORT", "8000")
    host = os.environ.get("HOST", "0.0.0.0")
    url = f"http://localhost:{port}/health"
    
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                print("OK")
                sys.exit(0)
            else:
                print(f"UNHEALTHY: HTTP {response.status}")
                sys.exit(1)
    except urllib.error.URLError as e:
        print(f"UNHEALTHY: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
