"""Exercise category/tag deletion in an isolated site, including off-screen errors."""
from geolocation_browser import main

if __name__ == "__main__":
    main("taxonomy-delete.spec.ts", isolated_build=True)
