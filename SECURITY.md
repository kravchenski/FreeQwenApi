# Security Policy

## Sensitive Local Data

FreeQwenApi stores authenticated provider state locally. Never publish:

- `session/`
- browser profiles and cookies
- bearer tokens and `Authorization.txt`
- logs containing provider responses
- `.env` files

If credentials are exposed, revoke or refresh them immediately.

## Reporting

Do not open a public issue for vulnerabilities that expose credentials,
sessions, account data, or authentication bypasses. Contact the repository
maintainer privately with:

- affected version or commit;
- reproduction steps;
- impact;
- suggested mitigation, if available.

## Supported Versions

Security fixes target the latest `main` branch and the latest published
container image. This project connects to unofficial web APIs, so upstream
provider changes may require rapid compatibility updates.
