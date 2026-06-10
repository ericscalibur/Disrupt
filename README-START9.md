# Disrupt → StartOS packaging

Drop these files into the root of the Disrupt repo. The structure mirrors what already works in Deploy-Deadman-Switch, with two upgrades: the Makefile actually produces a real `.s9pk` (via `start-sdk pack`), and a GitHub Action builds it automatically on every release so users never have to build anything.

## File map

```
Disrupt/
├── Dockerfile                          # new
├── Makefile                            # new — builds disrupt.s9pk
├── instructions.md                     # new — shown in the StartOS UI
├── icon.png                            # ← you provide (reuse favicon-disrupt, 256x256 PNG)
├── LICENSE                             # ← repo currently has none — add one (see license review)
├── .github/workflows/build-s9pk.yml    # new — CI build on release
└── start9/
    ├── manifest.yaml
    ├── docker_entrypoint.sh
    ├── configurator.sh
    ├── check-web.sh
    ├── properties.sh
    └── backup.sh
```

## Verification status (checked against the repo by Claude CLI)

1. **Health endpoint** ✅ — `/healthz`. `check-web.sh` updated.
2. **Env names** ✅ — `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` confirmed; entrypoint generates and persists both.
3. **DB path** ✅ — `db.js` honors `DISRUPT_DB_PATH`; entrypoint sets it to `/app/data/disrupt.db`. No symlink.
4. **First-run admin** ⚠️ one item left — no web bootstrap exists, so the Config tab now collects Admin Name/Email/Password and the entrypoint runs `start9/create-admin.js` when the DB is empty. **That script guesses the users-table schema — have Claude in the repo align its INSERT with the real schema** (or better: extract setup.js's user-creation into a shared function and call it).
5. **package.json** ✅ — single root package.json, Dockerfile is correct as-is.

## Build it locally (once, to test)

```bash
# one-time setup
curl https://sh.rustup.rs -sSf | sh
git clone https://github.com/Start9Labs/start-os.git
cd start-os && git submodule update --init --recursive && make sdk
start-sdk init

# then, in the Disrupt repo
make
# → disrupt.s9pk  — sideload via StartOS: System → Sideload Service
```

## Fixing Deploy's distribution problem

You were right: Deploy's current Makefile builds a `build/` folder but never calls `start-sdk pack`, so it never emits a `.s9pk` — that's why sideloading is hard for users. Two fixes:

1. Replace its Makefile with Disrupt's pattern (swap `PKG_ID := deadman-switch`, keep its existing manifest).
2. Copy `build-s9pk.yml` into Deploy's `.github/workflows/`. Next release you publish gets a downloadable `deadman-switch.s9pk` attached automatically. Then sign it with sign-release and you have the complete story.

## After it works: registries

Once tested on your own Start9, submit to community registries so people find it without sideloading at all — Start9's community registry submission process is at docs.start9.com (Developer Docs → Community Submission Process).
