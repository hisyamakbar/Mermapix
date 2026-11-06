# Security Policy

Mermapix runs entirely locally: the web app renders diagrams in your browser and the Figma plugin declares `networkAccess: none`. It collects no data and makes no network requests.

## Supported versions

Security fixes are made on the latest release (see [CHANGELOG.md](CHANGELOG.md)).

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (https://github.com/hisyamakbar/Mermapix/security/advisories/new). Include the steps to reproduce, the affected part (web app, plugin UI, plugin sandbox) and the impact you expect.

You can expect a first reply within a few days. Once a fix is released the report is credited in the advisory unless you prefer to stay anonymous.

Examples of what matters here: a Mermaid, DBML or SQL input that runs script in the web app or the plugin UI, anything that makes the plugin read or change Figma content outside what it inserts, or any network request the app makes.
