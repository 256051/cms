"""Check friend links on a disposable site and isolated Next.js build."""
from geolocation_browser import main

if __name__ == "__main__":
    main("friend-links.spec.ts", isolated_build=True)
