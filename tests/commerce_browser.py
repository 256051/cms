"""Exercise commerce UI and authenticated callbacks against a disposable site."""
from geolocation_browser import main

if __name__ == "__main__":
    main("commerce.spec.ts", isolated_build=True)
