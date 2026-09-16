"""Run editorial UI checks on a disposable site; never attach to the daily development database."""
from geolocation_browser import main

if __name__ == "__main__":
    main("editorial.spec.ts")
