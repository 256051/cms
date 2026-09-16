"""Verify shared attachment selection on an isolated site and production frontend build."""
from geolocation_browser import main

if __name__ == "__main__":
    main("asset-picker.spec.ts", isolated_build=True)
