## Fav Launcher – Release & Publish Steps

Step‑by‑step checklist for cutting a new version and publishing it to the VS Code / Cursor marketplace.

---

### 1. Update version and changelog

1. **Update version in `package.json`**
   - Bump the `version` field (e.g. `0.0.8` → `0.0.9`).
2. **Update `CHANGELOG.md`**
   - Add a new heading for the version.
   - List the key changes.
3. **Update `README.md`** (only if needed)
   - Refresh screenshots, usage docs, or feature lists that changed.

---

### 2. Build from a clean state

From the repo root:

```bash
cd c:\workspace\fav-launcher-extension
npm install
npm run package   # runs check-types, lint, and builds dist
```

This verifies the code builds and lints cleanly. It does **not** create a `.vsix` file.

---

### 3. Create the .vsix package for this version

Use `vsce` to build the extension package. The filename is derived from the `name` and `version` in `package.json`.

```bash
cd c:\workspace\fav-launcher-extension
vsce package
```

Result:

- For version `0.0.8`, you should see `fav-launcher-0.0.8.vsix` in the repo root.
- All historical packages (e.g. `fav-launcher-0.0.1.vsix` … `fav-launcher-0.0.8.vsix`) are intentionally kept in the repo.

If you see an older `.vsix` with the same version number, it means it was built earlier. Re‑run `vsce package` **after** updating `package.json` and rebuilding, so the `.vsix` matches the current code.

---

### 4. Commit and push the release

From the repo root:

```bash
cd c:\workspace\fav-launcher-extension
git status          # confirm what changed
git add .
git commit -m "Release vX.Y.Z – short description"
git push origin main
```

This keeps:

- Source code and config (`src`, `package.json`, `README.md`, `CHANGELOG.md`, etc.)
- All `.vsix` packages for every version.

---

### 5. Publish to the VS Code / Cursor marketplace

#### One‑time setup (if not already done)

1. **Install `vsce` globally**

   ```bash
   npm install -g @vscode/vsce
   ```

2. **Create a Personal Access Token (PAT) with Marketplace publish permissions**
   - Go to your Azure DevOps / Microsoft account → Personal Access Tokens.
   - Create a token with **Marketplace (Publish)** access.
   - Copy and store the token securely.

#### Publish a new version

From the repo root:

```bash
cd c:\workspace\fav-launcher-extension
vsce publish          # will prompt for PAT the first time
```

Or, provide the PAT explicitly:

```bash
vsce publish -p <YOUR_PAT>
```

`vsce publish` will:

- Run the `vscode:prepublish` script (which calls `npm run package`).
- Build a fresh `.vsix` from the current code and `version` in `package.json`.
- Upload the new version to the Marketplace under publisher `kohrock`.

Once complete, the new version appears on:

- VS Code Marketplace listing for this extension.

---

### 6. Versioning rules / gotchas

- **You cannot republish an existing version number.**
  - If `0.0.7` is already on the Marketplace, you **must** bump to `0.0.8`, `0.0.9`, etc. for any further changes.
- **The `.vsix` contents are determined at build time**, not commit time.
  - If a `.vsix` doesn’t contain your latest changes, it was built before those changes.
  - Fix by bumping `version`, rebuilding (`npm run package`), and re‑running `vsce package` / `vsce publish`.
- **Keeping all `.vsix` files**
  - Do **not** ignore `*.vsix` in `.gitignore`.
  - Each release’s `.vsix` is stored alongside the source, so you can always grab or attach a specific historical build if needed.

