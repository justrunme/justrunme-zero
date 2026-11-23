# Third-party components and declared licenses

Audited `origin/main`: `34318d72c9da92dc181d12c5fac5e64ad360fe18` (2026-11-23). This is a reproducible inventory of declared metadata, **not legal advice** or a determination of obligations.

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

## npm lockfile license check

No npm lockfile dependency has a license outside the specified allowlist. Verified by the command below (output: `[]`):

```sh
node - <<'NODE'
const l=require('./package-lock.json').packages; const ok=new Set(['MIT','ISC','BSD','BSD-2-Clause','BSD-3-Clause','Apache-2.0','0BSD','BlueOak','CC0','CC0-1.0']); console.log(Object.entries(l).filter(([p,m])=>p && !ok.has(m.license||'UNKNOWN')).map(([p,m])=>[p,m.license||'UNKNOWN']));
NODE
```

## Container component inventory (2026-11-23)

The [official rules](https://kiroween.devpost.com/rules) were fetched successfully (HTTP 200). The rules require: “The repository must be public and open source by including an open source license file.” They also say: “If a Project integrates any third-party SDK, APIs and/or data, Entrant must be authorized to use them in accordance with any terms and conditions or licensing requirements of the tool.” On open-source reuse: “An Entrant may submit a Submission that includes the use of open source software or hardware, provided the Entrant complies with applicable open source licenses”. The [overview](https://kiroween.devpost.com/) also returned HTTP 200.

**Finding:** The retrieved rules do **not** enumerate an exclusive list of permitted third-party SPDX identifiers. In particular, they do not prohibit the **PostgreSQL License** by name, nor GPL/LGPL components in Alpine images. The repository's own MIT license is a separate requirement. Therefore there is no *textual license-name conflict* for PostgreSQL or the installed Alpine components. This does **not** prove compliance with all redistribution/notice/source obligations or confer rights to third-party materials. The PostgreSQL License is recorded under its actual name, not relabelled BSD.

Inventory below uses installed package metadata inside the **pulled images** (not a guessed base image package list), and bundled npm/corepack package.json declarations. `OK*` means **no contradiction with the quoted rule's license-name wording**, *not* legal clearance; `OK (virtual package, no code)` identifies an image-created apk dependency meta-package, not a separate software component. Bundled packages can carry a license file even when package.json omits a declaration. This inventory is architecture/time dependent, not an SBOM, and tags may change. Images were inspected on the Mac's Docker host; no immutable image references were added to the repository.

Commands executed:

```sh
docker pull postgres:16.3-alpine
docker pull node:24-alpine
docker image inspect postgres:16.3-alpine --format '{{json .RepoDigests}}'
docker image inspect node:24-alpine --format '{{json .RepoDigests}}'
docker run --rm --entrypoint sh postgres:16.3-alpine -c 'cat /lib/apk/db/installed'
docker run --rm --entrypoint sh node:24-alpine -c 'cat /lib/apk/db/installed'
docker run --rm --entrypoint postgres postgres:16.3-alpine --version
docker run --rm --entrypoint node node:24-alpine --version
# Enumerated package.json name/version/license/homepage or repository fields
# under /usr/local/lib/node_modules/{npm,corepack} and their node_modules.
```

Observed image digests at audit time: postgres `sha256:36ed71227ae36305d26382657c0b96cbaf298427b3f1eaeb10d77a6dea3eec41`; node `sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5`. These are observations, **not** pinned references. Installed Alpine package versions came from `P:`, `V:`, `L:`, `U:` records of `/lib/apk/db/installed`; bundled Node modules from their `package.json` files. Upstream PostgreSQL and Node license pages provide the application license names. A package.json license declaration is not independent license-file verification.

| Image | Component | Installed version | Declared license | Metadata/upstream source | Verdict |
| --- | --- | --- | --- | --- | --- |
| postgres:16.3-alpine | .postgresql-rundeps | 20240724.012926 | N/A (virtual meta-package) | https://github.com/docker-library/postgres/blob/master/16/alpine3.23/Dockerfile | OK (virtual package, no code) |
| postgres:16.3-alpine | alpine-baselayout | 3.6.5-r0 | GPL-2.0-only | https://git.alpinelinux.org/cgit/aports/tree/main/alpine-baselayout | OK* |
| postgres:16.3-alpine | alpine-baselayout-data | 3.6.5-r0 | GPL-2.0-only | https://git.alpinelinux.org/cgit/aports/tree/main/alpine-baselayout | OK* |
| postgres:16.3-alpine | alpine-keys | 2.4-r1 | MIT | https://alpinelinux.org | OK* |
| postgres:16.3-alpine | apk-tools | 2.14.4-r0 | GPL-2.0-only | https://gitlab.alpinelinux.org/alpine/apk-tools | OK* |
| postgres:16.3-alpine | bash | 5.2.26-r0 | GPL-3.0-or-later | https://www.gnu.org/software/bash/bash.html | OK* |
| postgres:16.3-alpine | busybox | 1.36.1-r29 | GPL-2.0-only | https://busybox.net/ | OK* |
| postgres:16.3-alpine | busybox-binsh | 1.36.1-r29 | GPL-2.0-only | https://busybox.net/ | OK* |
| postgres:16.3-alpine | ca-certificates-bundle | 20240705-r0 | MPL-2.0 AND MIT | https://www.mozilla.org/en-US/about/governance/policies/security-group/certs/ | OK* |
| postgres:16.3-alpine | gdbm | 1.23-r1 | GPL-3.0-or-later | https://www.gnu.org/software/gdbm/ | OK* |
| postgres:16.3-alpine | icu-data-full | 74.2-r0 | ICU | https://icu.unicode.org/ | OK* |
| postgres:16.3-alpine | icu-libs | 74.2-r0 | ICU | https://icu.unicode.org/ | OK* |
| postgres:16.3-alpine | keyutils-libs | 1.6.3-r3 | GPL-2.0-or-later AND LGPL-2.0-or-later | https://people.redhat.com/~dhowells/keyutils/ | OK* |
| postgres:16.3-alpine | krb5-conf | 1.0-r2 | MIT | https://web.mit.edu/kerberos/www/ | OK* |
| postgres:16.3-alpine | krb5-libs | 1.21.3-r0 | MIT | https://web.mit.edu/kerberos/www/ | OK* |
| postgres:16.3-alpine | libcom_err | 1.47.0-r5 | GPL-2.0-or-later AND LGPL-2.0-or-later AND BSD-3-Clause AND MIT | https://e2fsprogs.sourceforge.net/ | OK* |
| postgres:16.3-alpine | libcrypto3 | 3.3.1-r3 | Apache-2.0 | https://www.openssl.org/ | OK* |
| postgres:16.3-alpine | libedit | 20240517.3.1-r0 | BSD-3-Clause | https://www.thrysoee.dk/editline | OK* |
| postgres:16.3-alpine | libffi | 3.4.6-r0 | MIT | https://sourceware.org/libffi/ | OK* |
| postgres:16.3-alpine | libgcc | 13.2.1_git20240309-r0 | GPL-2.0-or-later AND LGPL-2.1-or-later | https://gcc.gnu.org | OK* |
| postgres:16.3-alpine | libgcrypt | 1.10.3-r0 | LGPL-2.1-or-later AND GPL-2.0-or-later | https://www.gnupg.org/ | OK* |
| postgres:16.3-alpine | libgpg-error | 1.49-r0 | GPL-2.0-or-later AND LGPL-2.1-or-later | https://www.gnupg.org/ | OK* |
| postgres:16.3-alpine | libldap | 2.6.7-r0 | OLDAP-2.8 | https://www.openldap.org/ | OK* |
| postgres:16.3-alpine | libncursesw | 6.4_p20240420-r0 | X11 | https://invisible-island.net/ncurses/ | OK* |
| postgres:16.3-alpine | libsasl | 2.1.28-r6 | BSD-3-Clause-Attribution AND BSD-4-Clause | https://www.cyrusimap.org/sasl/ | OK* |
| postgres:16.3-alpine | libssl3 | 3.3.1-r3 | Apache-2.0 | https://www.openssl.org/ | OK* |
| postgres:16.3-alpine | libstdc++ | 13.2.1_git20240309-r0 | GPL-2.0-or-later AND LGPL-2.1-or-later | https://gcc.gnu.org | OK* |
| postgres:16.3-alpine | libuuid | 2.40.1-r1 | BSD-3-Clause | https://git.kernel.org/cgit/utils/util-linux/util-linux.git | OK* |
| postgres:16.3-alpine | libverto | 0.3.2-r2 | MIT | https://github.com/latchset/libverto | OK* |
| postgres:16.3-alpine | libxml2 | 2.12.7-r0 | MIT | https://gitlab.gnome.org/GNOME/libxml2 | OK* |
| postgres:16.3-alpine | libxslt | 1.1.39-r1 | X11 | http://xmlsoft.org/XSLT/ | OK* |
| postgres:16.3-alpine | llvm15-libs | 15.0.7-r13 | Apache-2.0 | https://llvm.org/ | OK* |
| postgres:16.3-alpine | lz4-libs | 1.9.4-r5 | BSD-2-Clause AND GPL-2.0-only | https://github.com/lz4/lz4 | OK* |
| postgres:16.3-alpine | musl | 1.2.5-r0 | MIT | https://musl.libc.org/ | OK* |
| postgres:16.3-alpine | musl-utils | 1.2.5-r0 | MIT AND BSD-2-Clause AND GPL-2.0-or-later | https://musl.libc.org/ | OK* |
| postgres:16.3-alpine | ncurses-terminfo-base | 6.4_p20240420-r0 | X11 | https://invisible-island.net/ncurses/ | OK* |
| postgres:16.3-alpine | nss_wrapper | 1.1.12-r1 | BSD-3-Clause | https://cwrap.org/nss_wrapper.html | OK* |
| postgres:16.3-alpine | readline | 8.2.10-r0 | GPL-3.0-or-later | https://tiswww.cwru.edu/php/chet/readline/rltop.html | OK* |
| postgres:16.3-alpine | scanelf | 1.3.7-r2 | GPL-2.0-only | https://wiki.gentoo.org/wiki/Hardened/PaX_Utilities | OK* |
| postgres:16.3-alpine | ssl_client | 1.36.1-r29 | GPL-2.0-only | https://busybox.net/ | OK* |
| postgres:16.3-alpine | tzdata | 2024a-r1 | Public-Domain | https://www.iana.org/time-zones | OK* |
| postgres:16.3-alpine | xz-libs | 5.6.1-r3 | GPL-2.0-or-later AND 0BSD AND Public-Domain AND LGPL-2.1-or-later | https://xz.tukaani.org/xz-utils/ | OK* |
| postgres:16.3-alpine | zlib | 1.3.1-r1 | Zlib | https://zlib.net/ | OK* |
| postgres:16.3-alpine | zstd | 1.5.6-r0 | BSD-3-Clause OR GPL-2.0-or-later | https://www.zstd.net/ | OK* |
| postgres:16.3-alpine | zstd-libs | 1.5.6-r0 | BSD-3-Clause OR GPL-2.0-or-later | https://www.zstd.net/ | OK* |
| node:24-alpine | alpine-baselayout | 3.7.2-r1 | GPL-2.0-only | https://gitlab.alpinelinux.org/alpine/aports/-/tree/master/main/alpine-baselayout | OK* |
| node:24-alpine | alpine-baselayout-data | 3.7.2-r1 | GPL-2.0-only | https://gitlab.alpinelinux.org/alpine/aports/-/tree/master/main/alpine-baselayout | OK* |
| node:24-alpine | alpine-keys | 2.6-r0 | MIT | https://alpinelinux.org | OK* |
| node:24-alpine | alpine-release | 3.24.4-r0 | MIT | https://alpinelinux.org | OK* |
| node:24-alpine | apk-tools | 3.0.9-r0 | GPL-2.0-only | https://gitlab.alpinelinux.org/alpine/apk-tools | OK* |
| node:24-alpine | busybox | 1.37.0-r31 | GPL-2.0-only | https://busybox.net/ | OK* |
| node:24-alpine | busybox-binsh | 1.37.0-r31 | GPL-2.0-only | https://busybox.net/ | OK* |
| node:24-alpine | ca-certificates-bundle | 20261020-r0 | MPL-2.0 AND MIT | https://www.mozilla.org/en-US/about/governance/policies/security-group/certs/ | OK* |
| node:24-alpine | libapk | 3.0.9-r0 | GPL-2.0-only | https://gitlab.alpinelinux.org/alpine/apk-tools | OK* |
| node:24-alpine | libatomic | 15.2.0-r5 | GPL-2.0-or-later AND LGPL-2.1-or-later | https://gcc.gnu.org | OK* |
| node:24-alpine | libcrypto3 | 3.5.9-r0 | Apache-2.0 | https://www.openssl.org/ | OK* |
| node:24-alpine | libgcc | 15.2.0-r5 | GPL-2.0-or-later AND LGPL-2.1-or-later | https://gcc.gnu.org | OK* |
| node:24-alpine | libssl3 | 3.5.9-r0 | Apache-2.0 | https://www.openssl.org/ | OK* |
| node:24-alpine | libstdc++ | 15.2.0-r5 | GPL-2.0-or-later AND LGPL-2.1-or-later | https://gcc.gnu.org | OK* |
| node:24-alpine | musl | 1.2.6-r3 | MIT | https://musl.libc.org/ | OK* |
| node:24-alpine | musl-utils | 1.2.6-r3 | MIT AND BSD-2-Clause AND GPL-2.0-or-later | https://musl.libc.org/ | OK* |
| node:24-alpine | scanelf | 1.3.9-r1 | GPL-2.0-only | https://wiki.gentoo.org/wiki/Hardened/PaX_Utilities | OK* |
| node:24-alpine | ssl_client | 1.37.0-r31 | GPL-2.0-only | https://busybox.net/ | OK* |
| node:24-alpine | zlib | 1.3.2-r1 | Zlib | https://zlib.net/ | OK* |
| node:24-alpine | npm | 11.19.1 | Artistic-2.0 | https://docs.npmjs.com/ | OK* |
| node:24-alpine | @gar/promise-retry | 1.0.3 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | @isaacs/fs-minipass | 4.0.1 | ISC | https://github.com/npm/fs-minipass.git | OK* |
| node:24-alpine | @isaacs/string-locale-compare | 1.1.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/agent | 4.0.2 | ISC | https://github.com/npm/agent#readme | OK* |
| node:24-alpine | @npmcli/arborist | 9.9.1 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/config | 10.12.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/fs | 5.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/git | 7.0.2 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/installed-package-contents | 4.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/map-workspaces | 5.0.3 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/metavuln-calculator | 9.0.3 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/name-from-folder | 4.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/node-gyp | 5.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/package-json | 7.0.5 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/promise-spawn | 9.0.1 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/query | 5.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/redact | 4.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @npmcli/run-script | 10.0.4 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | @sigstore/bundle | 4.0.0 | Apache-2.0 | https://github.com/sigstore/sigstore-js/tree/main/packages/bundle#readme | OK* |
| node:24-alpine | @sigstore/core | 3.2.1 | Apache-2.0 | https://github.com/sigstore/sigstore-js/tree/main/packages/core#readme | OK* |
| node:24-alpine | @sigstore/protobuf-specs | 0.5.1 | Apache-2.0 | https://github.com/sigstore/protobuf-specs#readme | OK* |
| node:24-alpine | @sigstore/sign | 4.1.1 | Apache-2.0 | https://github.com/sigstore/sigstore-js/tree/main/packages/sign#readme | OK* |
| node:24-alpine | @sigstore/tuf | 4.0.2 | Apache-2.0 | https://github.com/sigstore/sigstore-js/tree/main/packages/tuf#readme | OK* |
| node:24-alpine | @sigstore/verify | 3.1.1 | Apache-2.0 | https://github.com/sigstore/sigstore-js/tree/main/packages/verify#readme | OK* |
| node:24-alpine | @tufjs/canonical-json | 2.0.0 | MIT | https://github.com/theupdateframework/tuf-js/tree/main/packages/canonical-json#readme | OK* |
| node:24-alpine | @tufjs/models | 4.1.0 | MIT | https://github.com/theupdateframework/tuf-js/tree/main/packages/models#readme | OK* |
| node:24-alpine | abbrev | 4.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | agent-base | 7.1.4 | MIT | https://github.com/TooTallNate/proxy-agents.git | OK* |
| node:24-alpine | aproba | 2.1.0 | ISC | https://github.com/iarna/aproba | OK* |
| node:24-alpine | archy | 1.0.0 | MIT | http://github.com/substack/node-archy.git | OK* |
| node:24-alpine | balanced-match | 4.0.4 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | bin-links | 6.0.2 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | binary-extensions | 3.1.0 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | brace-expansion | 5.0.9 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | cacache | 20.0.4 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | chalk | 5.6.2 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | chownr | 3.0.0 | BlueOak-1.0.0 | https://github.com/npm/cli | OK* |
| node:24-alpine | ci-info | 4.4.0 | MIT | https://github.com/watson/ci-info | OK* |
| node:24-alpine | cidr-regex | 5.0.5 | BSD-2-Clause | https://github.com/npm/cli | OK* |
| node:24-alpine | cmd-shim | 8.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | common-ancestor-path | 2.0.0 | BlueOak-1.0.0 | https://github.com/npm/cli | OK* |
| node:24-alpine | cssesc | 3.0.0 | MIT | https://mths.be/cssesc | OK* |
| node:24-alpine | debug | 4.4.3 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | diff | 8.0.4 | BSD-3-Clause | https://github.com/kpdecker/jsdiff.git | OK* |
| node:24-alpine | env-paths | 2.2.1 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | exponential-backoff | 3.1.3 | Apache-2.0 | https://github.com/coveooss/exponential-backoff#readme | OK* |
| node:24-alpine | fastest-levenshtein | 1.0.16 | MIT | https://github.com/ka-weihe/fastest-levenshtein#README | OK* |
| node:24-alpine | fs-minipass | 3.0.3 | ISC | https://github.com/npm/fs-minipass#readme | OK* |
| node:24-alpine | glob | 13.0.6 | BlueOak-1.0.0 | https://github.com/npm/cli | OK* |
| node:24-alpine | graceful-fs | 4.2.11 | ISC | https://github.com/isaacs/node-graceful-fs | OK* |
| node:24-alpine | hosted-git-info | 9.0.3 | ISC | https://github.com/npm/hosted-git-info | OK* |
| node:24-alpine | http-cache-semantics | 4.2.0 | BSD-2-Clause | https://github.com/npm/cli | OK* |
| node:24-alpine | http-proxy-agent | 7.0.2 | MIT | https://github.com/TooTallNate/proxy-agents.git | OK* |
| node:24-alpine | https-proxy-agent | 7.0.6 | MIT | https://github.com/TooTallNate/proxy-agents.git | OK* |
| node:24-alpine | iconv-lite | 0.7.2 | MIT | https://github.com/pillarjs/iconv-lite | OK* |
| node:24-alpine | ignore-walk | 8.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | ini | 6.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | init-package-json | 8.2.5 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | ip-address | 10.5.0 | MIT | https://github.com/beaugunderson/ip-address.git | OK* |
| node:24-alpine | is-cidr | 6.0.4 | BSD-2-Clause | https://github.com/npm/cli | OK* |
| node:24-alpine | isexe | 4.0.0 | BlueOak-1.0.0 | https://github.com/npm/cli | OK* |
| node:24-alpine | json-parse-even-better-errors | 5.0.0 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | json-stringify-nice | 1.1.4 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | jsonparse | 1.3.1 | MIT | http://github.com/creationix/jsonparse.git | OK* |
| node:24-alpine | just-diff | 6.0.2 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | just-diff-apply | 5.5.0 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | libnpmaccess | 10.0.3 | ISC | https://npmjs.com/package/libnpmaccess | OK* |
| node:24-alpine | libnpmdiff | 8.1.12 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | libnpmexec | 10.3.2 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | libnpmfund | 7.0.26 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | libnpmorg | 8.0.1 | ISC | https://npmjs.com/package/libnpmorg | OK* |
| node:24-alpine | libnpmpack | 9.1.13 | ISC | https://npmjs.com/package/libnpmpack | OK* |
| node:24-alpine | libnpmpublish | 11.2.0 | ISC | https://npmjs.com/package/libnpmpublish | OK* |
| node:24-alpine | libnpmsearch | 9.0.1 | ISC | https://npmjs.com/package/libnpmsearch | OK* |
| node:24-alpine | libnpmteam | 8.0.2 | ISC | https://npmjs.com/package/libnpmteam | OK* |
| node:24-alpine | libnpmversion | 8.0.4 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | lru-cache | 11.5.1 | BlueOak-1.0.0 | https://github.com/npm/cli | OK* |
| node:24-alpine | make-fetch-happen | 15.0.6 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | minimatch | 10.2.5 | BlueOak-1.0.0 | https://github.com/npm/cli | OK* |
| node:24-alpine | minipass | 7.1.3 | BlueOak-1.0.0 | https://github.com/npm/cli | OK* |
| node:24-alpine | minipass-collect | 2.0.1 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | minipass-fetch | 5.0.2 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | minipass-flush | 1.0.6 | BlueOak-1.0.0 | https://github.com/npm/cli | OK* |
| node:24-alpine | minipass-pipeline | 1.2.4 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | minipass | 3.3.6 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | yallist | 4.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | minipass-sized | 2.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | minizlib | 3.1.0 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | ms | 2.1.3 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | mute-stream | 3.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | negotiator | 1.0.0 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | node-gyp | 12.4.0 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | nopt | 9.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | npm-audit-report | 7.0.0 | ISC | https://github.com/npm/npm-audit-report#readme | OK* |
| node:24-alpine | npm-bundled | 5.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | npm-install-checks | 8.0.0 | BSD-2-Clause | https://github.com/npm/cli | OK* |
| node:24-alpine | npm-normalize-package-bin | 5.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | npm-package-arg | 13.0.2 | ISC | https://github.com/npm/npm-package-arg | OK* |
| node:24-alpine | npm-packlist | 10.0.4 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | npm-pick-manifest | 11.0.3 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | npm-profile | 12.0.2 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | npm-registry-fetch | 19.1.1 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | npm-user-validate | 4.0.0 | BSD-2-Clause | https://github.com/npm/cli | OK* |
| node:24-alpine | p-map | 7.0.4 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | pacote | 21.5.1 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | parse-conflict-json | 5.0.1 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | path-scurry | 2.0.2 | BlueOak-1.0.0 | https://github.com/npm/cli | OK* |
| node:24-alpine | postcss-selector-parser | 7.1.4 | MIT | https://github.com/postcss/postcss-selector-parser | OK* |
| node:24-alpine | proc-log | 6.1.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | proggy | 4.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | promise-all-reject-late | 1.0.1 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | promise-call-limit | 3.0.2 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | promzard | 3.0.1 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | qrcode-terminal | 0.12.0 | Apache-2.0 (bundled LICENSE; includes MIT notice for vendored QRCode) | https://github.com/gtanner/qrcode-terminal | OK* |
| node:24-alpine | read | 5.0.1 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | read-cmd-shim | 6.0.0 | ISC | https://github.com/npm/read-cmd-shim#readme | OK* |
| node:24-alpine | safer-buffer | 2.1.2 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | semver | 7.8.5 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | signal-exit | 4.1.0 | ISC | https://github.com/tapjs/signal-exit.git | OK* |
| node:24-alpine | sigstore | 4.1.1 | Apache-2.0 | https://github.com/sigstore/sigstore-js/tree/main/packages/client#readme | OK* |
| node:24-alpine | smart-buffer | 4.2.0 | MIT | https://github.com/JoshGlazebrook/smart-buffer/ | OK* |
| node:24-alpine | socks | 2.8.9 | MIT | https://github.com/JoshGlazebrook/socks/ | OK* |
| node:24-alpine | socks-proxy-agent | 8.0.5 | MIT | https://github.com/TooTallNate/proxy-agents.git | OK* |
| node:24-alpine | spdx-exceptions | 2.5.0 | CC-BY-3.0 | https://github.com/npm/cli | OK* |
| node:24-alpine | spdx-expression-parse | 4.0.0 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | spdx-license-ids | 3.0.23 | CC0-1.0 | https://github.com/npm/cli | OK* |
| node:24-alpine | ssri | 13.0.1 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | supports-color | 10.2.2 | MIT | https://github.com/npm/cli | OK* |
| node:24-alpine | tar | 7.5.22 | BlueOak-1.0.0 | https://github.com/isaacs/node-tar.git | OK* |
| node:24-alpine | text-table | 0.2.0 | MIT | https://github.com/substack/text-table | OK* |
| node:24-alpine | tiny-relative-date | 2.0.2 | MIT | https://github.com/wildlyinaccurate/relative-date.git | OK* |
| node:24-alpine | tinyglobby | 0.2.17 | MIT | https://superchupu.dev/tinyglobby | OK* |
| node:24-alpine | fdir | 6.5.0 | MIT | https://github.com/thecodrr/fdir#readme | OK* |
| node:24-alpine | picomatch | 4.0.4 | MIT | https://github.com/micromatch/picomatch | OK* |
| node:24-alpine | treeverse | 3.0.0 | ISC | https://github.com/npm/treeverse.git | OK* |
| node:24-alpine | tuf-js | 4.1.0 | MIT | https://github.com/theupdateframework/tuf-js/tree/main/packages/client#readme | OK* |
| node:24-alpine | undici | 6.28.0 | MIT | https://undici.nodejs.org | OK* |
| node:24-alpine | util-deprecate | 1.0.2 | MIT | https://github.com/TooTallNate/util-deprecate | OK* |
| node:24-alpine | validate-npm-package-name | 7.0.2 | ISC | https://github.com/npm/validate-npm-package-name | OK* |
| node:24-alpine | walk-up-path | 4.0.0 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | which | 6.0.1 | ISC | https://github.com/npm/cli | OK* |
| node:24-alpine | write-file-atomic | 7.0.1 | ISC | https://github.com/npm/write-file-atomic | OK* |
| node:24-alpine | yallist | 5.0.0 | BlueOak-1.0.0 | https://github.com/npm/cli | OK* |
| node:24-alpine | corepack | 0.36.0 | MIT | https://github.com/nodejs/corepack#readme | OK* |
| postgres:16.3-alpine | PostgreSQL | 16.3 | PostgreSQL License | https://www.postgresql.org/about/licence/ | OK* |
| node:24-alpine | Node.js | 24.22.3 | MIT (upstream LICENSE) | https://github.com/nodejs/node/blob/v24.22.3/LICENSE | OK* |

**Open actions:** Both initially undeclared metadata rows have been investigated: the installed `.postgresql-rundeps` apk record states `T:virtual meta package`, `S:0`, `I:0`, `L:` (blank), and the [official Dockerfile](https://github.com/docker-library/postgres/blob/master/16/alpine3.23/Dockerfile) creates it with `apk add --no-cache --virtual .postgresql-rundeps`; it is not third-party code. The bundled `qrcode-terminal/LICENSE` in `node:24-alpine` contains Apache License 2.0 and an MIT notice for its vendored QRCode. For all rows, Andrey must still confirm applicable notices, source/redistribution obligations, assets, originality, and sponsor-conflict eligibility. The images also contain upstream application and runtime files outside the Alpine package database; this inventory does not certify every copied file. No image tag or digest was changed.
