"""Verify GrapesJS and existing page workflows using an isolated database, ports and build."""
from geolocation_browser import main

if __name__ == "__main__":
    main("grapes-builder.spec.ts|page-builder.spec.ts|builder-enhancements.spec.ts|shared-blocks.spec.ts", isolated_build=True)
