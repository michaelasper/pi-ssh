# Stage a release and publish it

Releases use GitHub Actions OIDC, not an npm token. The workflow stages a verified tarball; a maintainer approves it with npm two-factor authentication before it becomes public.

Use this process only for an explicitly authorised release. Documentation and successful staging do not establish a public npm release; maintainer approval is still required.

## Configure npm once

The package must already exist publicly on npm as `@michaelasper/pi-ssh`. Staging cannot create a brand-new package. If `npm view @michaelasper/pi-ssh` returns 404, verify the package name, visibility and completion of the initial interactive publication first.

In the package’s npm settings, configure a trusted publisher:

| Field | Value |
| --- | --- |
| GitHub owner | `michaelasper` |
| Repository | `pi-ssh` |
| Workflow filename | `publish.yml` |
| Allowed action | `npm stage publish` only |
| Environment | Leave unset; this workflow does not name an environment |

The filename refers to `.github/workflows/publish.yml`, but npm expects just `publish.yml`. The workflow runs on GitHub-hosted runners. Do not add `NPM_TOKEN` or `NODE_AUTH_TOKEN` secrets.

Once OIDC staging is verified, npm recommends “Require two-factor authentication and disallow tokens”. Revoke obsolete publishing tokens in your npm account.

## Verify without staging

Run the workflow on `main` with its default input:

```bash
gh workflow run publish.yml --ref main
```

This performs clean installation, tests, type checks, both npm audits and the production installation smoke test, then uploads a tarball. The staging job is skipped. Release builds do not use dependency caches.

## Prepare a new version

For an explicitly authorised release, update `package.json` and the lockfile, then commit and push the release source to `main`. Each npm version is immutable; never reuse a published version or move an existing release tag.

The host-aware file-tool change alters default routing for existing users with `--ssh-host` / `PI_SSH_HOST`. Do not treat it as an ordinary patch by assumption. Choose the version deliberately and include a prominent breaking-change notice linking to [migration instructions](how-to.md#migrate-existing-prompts-and-integrations): all six file tools now follow the SSH default, `host="local"` preserves local calls, file tools have no per-call `cwd`, and bash artifacts stay local. Include the new remote Python/fd/rg prerequisites. Check [recorded verification](verification.md) for current seven-tool evidence rather than relying on historical bash-only results.

For a separate ordinary patch release, the existing command sequence is:

```bash
npm version patch --no-git-tag-version
npm run check
npm run test:package
```

Review and commit the changed version files before tagging. After the checks pass:

```bash
version=$(node -p "require('./package.json').version")
git tag "v$version"
git push origin "v$version"
```

A `v*` tag triggers staging. The workflow requires the tag to exactly match `package.json` and checks that the lockfile has the same name and version. It stages the tarball produced by the verification job, not a rebuilt package. Only the separate staging job has `id-token: write` permission; it installs no project dependencies.

To retry an appropriate tag manually, use `gh workflow run publish.yml --ref "v$version" -f stage=true`. Inspect npm first to avoid duplicate staging attempts. Manual staging from a branch is rejected.

## Review and approve on npm

Open npm’s **Staged Packages** tab. Verify the package name, version, contents and provenance, then approve with 2FA. Alternatively, use the interactive CLI:

```bash
npm stage list @michaelasper/pi-ssh
npm stage view <stage-id>
npm stage download <stage-id>
npm stage approve <stage-id>
```

OIDC authenticates staging; it cannot approve releases. The workflow does not invoke `npm publish` or `npm stage approve`. A successful staging run is not a public release.

After approval, verify registry metadata and installation before announcing a GitHub release:

```bash
npm view @michaelasper/pi-ssh version license
pi install npm:@michaelasper/pi-ssh
```

See npm’s [trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [staged publishing](https://docs.npmjs.com/staged-publishing/) documentation for the approval model.

## Appear in the pi.dev package catalog

The [pi.dev catalog](https://pi.dev/packages) discovers npm packages carrying the `pi-package` keyword. This project already includes it, along with `pi.extensions`, description, repository and homepage metadata. The upstream [package guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md#gallery-metadata) documents that discovery path; it does not specify a separate submission step or an indexing deadline.

Publish and approve the public npm version, then check the [catalog search](https://pi.dev/packages?name=%40michaelasper%2Fpi-ssh). Registry search and catalog indexing may lag publication. An unpublished, private or merely staged package cannot be assumed to appear publicly.

An optional `pi.image` URL can provide a PNG, JPEG, GIF or WebP preview. An optional `pi.video` URL can provide an MP4 preview and takes precedence over an image. These are not required for discovery; add a genuine, sanitised demonstration rather than a placeholder.
