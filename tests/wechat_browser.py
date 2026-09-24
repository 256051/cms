"""Verify the editor against an isolated site; never call a real WeChat account."""
import os
from geolocation_browser import main

if __name__ == "__main__":
    for key in list(os.environ):
        if key.lower().startswith("wechat__"):
            del os.environ[key]
    main("wechat.spec.ts", isolated_build=True)
