# Cacao

Finance and operations app for FRC Team 2064, deployed at [finance.2064.team](https://finance.2064.team).

## Deployment & Releasing

Production releases are automated via GitHub Actions on version tags:

```bash
npm version minor # or patch / major
git push origin trunk --follow-tags
```

The [Release workflow](.github/workflows/release.yml) runs tests and typechecks before triggering the deployment on Vercel.

### Build & Environments

- **Build Command**: `npm run build:vercel` (deploys Convex backend then builds SvelteKit frontend)
- **Vercel Environment Variables**:
  - `CONVEX_DEPLOY_KEY`
  - `PUBLIC_CONVEX_URL` (plain config variable)
- **GitHub Secrets** (for release action):
  - `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
