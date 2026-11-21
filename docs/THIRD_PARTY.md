# Third-party components and declared licenses

Audited `origin/main`: `25acd5f152e0dbf32775300413b92db237fe6236` (2026-11-21). This is a reproducible inventory of declared metadata, **not legal advice** or a determination of obligations.

## Reproduction

Run from the repository root at the audited commit:

```sh
git rev-parse origin/main
npm ci --ignore-scripts --no-audit --no-fund
node -e "const l=require('./package-lock.json').packages; console.log(Object.entries(l).map(([p,v])=>[p,v.version,v.license,v.dev]))"
npm ls --omit=dev --all --json
grep -nE "^[[:space:]]*image:|postgres:[0-9]|node:[0-9]" demo/docker-compose.yml
grep -Rn "uses:" .github/workflows/*.yml
```

The tables below derive from `package.json` and `package-lock.json` lockfile v3. `npm ci` succeeded (`added 6 packages`); license values are package-lock declarations, not independent legal verification.

## Direct npm dependencies

| Scope | Package | Requested | Resolved | Declared license |
| --- | --- | --- | --- | --- |
| Runtime | `@modelcontextprotocol/server` | `2.4.0` | `2.4.0` | `Apache-2.0` |
| Runtime | `yaml` | `2.9.1` | `2.9.1` | `ISC` |
| Runtime | `zod` | `4.6.7` | `4.6.7` | `MIT` |
| Development | `fast-check` | `4.10.2` | `4.10.2` | `MIT` |

## Transitive production dependencies

| Package | Resolved | Declared license |
| --- | --- | --- |
| `@modelcontextprotocol/core` | `2.4.0` | `Apache-2.0` |

## Dev-only transitive dependency summary

| Declared license | Count |
| --- | ---: |
| `MIT` | 1 |

Reproduce the dev-only counts (excluding direct dev dependencies) with:

```sh
node - <<'NODE'
const p=require('./package.json'), l=require('./package-lock.json').packages; const direct=new Set(Object.keys({...p.dependencies,...p.devDependencies})); const counts={}; for(const [path,m] of Object.entries(l)){const name=path.replace(/^node_modules\//,''); if(path && m.dev && !direct.has(name))counts[m.license||'UNKNOWN']=(counts[m.license||'UNKNOWN']||0)+1;} console.log(counts);
NODE
```

## Container images

| Exact image reference | Source | Upstream project and license information |
| --- | --- | --- |
| `postgres:16.3-alpine` | `demo/docker-compose.yml:11` | [Official PostgreSQL Docker image](https://hub.docker.com/_/postgres); PostgreSQL source uses the [PostgreSQL License](https://www.postgresql.org/about/licence/) (permissive, BSD-like). The Alpine base includes separately licensed components; [Alpine package license metadata](https://pkgs.alpinelinux.org/packages) applies. |
| `node:24-alpine` | `demo/docker-compose.yml:32` | [Official Node Docker image](https://hub.docker.com/_/node); Node.js source declares [MIT](https://github.com/nodejs/node/blob/main/LICENSE). Alpine base and bundled components carry their own licenses; see [Alpine packages](https://pkgs.alpinelinux.org/packages). |

`test/demo-a.test.js:247` contains `postgres:0.0-jrm-does-not-exist` only as an intentionally invalid replacement in a negative test; it is not an image that the project normally pulls. No image digest is asserted.

## GitHub Actions

| Action as used | Location |
| --- | --- |
| `actions/checkout@v4` | `.github/workflows/ci.yml:27` |
| `actions/setup-node@v4` | `.github/workflows/ci.yml:32` |
| `actions/upload-artifact@v4` | `.github/workflows/ci.yml:44` |
| `actions/checkout@v4` | `.github/workflows/ci.yml:78` |
| `actions/setup-node@v4` | `.github/workflows/ci.yml:81` |
| `actions/checkout@v4` | `.github/workflows/ci.yml:97` |

## Needs attention

- No npm lockfile dependency has a license outside the specified allowlist. Verified by the command below.
- **Container layers need a separate package-level review.** The Alpine base images can contain packages under GPL/LGPL or other licenses; the repository pins tags, not an SBOM or immutable image digests. The image table does not imply a single license for a complete container.
- The PostgreSQL License is permissive but is not literally one of the named allowlist identifiers; record its declared name rather than silently classifying it as BSD.

```sh
node - <<'NODE'
const l=require('./package-lock.json').packages; const ok=new Set(['MIT','ISC','BSD','BSD-2-Clause','BSD-3-Clause','Apache-2.0','0BSD','BlueOak','CC0','CC0-1.0']); console.log(Object.entries(l).filter(([p,m])=>p && !ok.has(m.license||'UNKNOWN')).map(([p,m])=>[p,m.license||'UNKNOWN']));
NODE
```
