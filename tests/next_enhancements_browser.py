"""Run the next CMS feature workflows with a private database and production frontend build."""
from geolocation_browser import main

if __name__ == "__main__":
    main("(builder-enhancements|shared-blocks|business-tools).spec.ts", isolated_build=True)
