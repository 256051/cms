"""Exercise AI UI on a disposable site; provider replies are explicitly simulated in the browser spec."""
import os
os.environ.setdefault("CMS_TEST_CONFIGURATION", "Debug")
from geolocation_browser import main

if __name__ == "__main__":
    for key in list(os.environ):
        if key.lower().startswith("ai__"):
            del os.environ[key]
    main("ai-writing.spec.ts", isolated_build=True)
