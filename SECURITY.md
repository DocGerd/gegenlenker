# Security policy

Only the latest release at <https://docgerd.github.io/gegenlenker/> (built from `main`) is supported.

Report vulnerabilities privately through GitHub: [report a vulnerability](https://github.com/DocGerd/gegenlenker/security/advisories/new). Do not open public issues or pull requests for security problems.

## Response process

1. Reports are acknowledged within 14 days. The maintainer triages the report and confirms or rejects it in the advisory.
2. A confirmed fix that production needs ships as a hotfix release from a `hotfix/*` branch ([release flow](docs/releasing.md)).
3. The release is disclosed in a GitHub security advisory, which requests a CVE for confirmed vulnerabilities, and in a `security` changelog entry.
4. The reporter is credited in the advisory unless they decline.
