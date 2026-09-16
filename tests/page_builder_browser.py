"""Run page builder workflows against an isolated site and the current production frontend build."""
from geolocation_browser import main

if __name__ == "__main__":
    main("page-builder.spec.ts", isolated_build=True)
