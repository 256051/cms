# Offline IP region data

Source: https://github.com/lionsoul2014/ip2region/tree/c1a1fc7d5941760db3f8431dc05c48cf7f0e30a1/data

Downloaded 2026-09-16, unmodified xdb v3 files. The full upstream license is in LICENSE.md.
The IP2Region.Net 3.0.2 reader is distributed under Apache-2.0; no reader source is copied here.

- ip2region_v4.xdb — SHA-256: 8e31bbdccb5bf21028af10592d4312ec975da0bffa108c0c5d862a12190f9ad3
- ip2region_v6.xdb — SHA-256: 939f6b46bd2b8bec3cf7c5ceb8ba782266ae9b1f35b5ba7916700dec0b7506ed

Fields: country|province|city|ISP|iso-alpha2-code. CMS stores only the first three geographic fields.
Data and this notice accompany build/publish output, including Docker. No request-time downloads occur.
To update, replace both files with compatible v3 country/province/city data, update provenance and hashes,
run the geolocation checks, and rebuild. GeoIp:Directory can also point at a mounted replacement directory;
restart after replacing the files. Missing/incompatible data preserves the IP and reports an unknown region.
