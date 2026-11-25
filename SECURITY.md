# Security policy

Only the latest release at <https://docgerd.github.io/gegenlenker/> (built from `main`) is supported.

Report vulnerabilities privately through GitHub: [report a vulnerability](https://github.com/DocGerd/gegenlenker/security/advisories/new).

Reports are acknowledged within 14 days. A fix production needs ships as a hotfix release ([release flow](docs/releasing.md)).

## Response process

1. Report privately through the advisory form above.
2. The maintainer triages the report and confirms or rejects it in the advisory.
3. A confirmed fix is developed privately and released from a `hotfix/*` branch.
4. The fix is published with a GitHub security advisory, which requests a CVE for confirmed vulnerabilities.
5. The release notes name the fixed CVE.
6. The reporter is credited in the advisory unless they decline.

Do not open public issues or pull requests for security problems.
