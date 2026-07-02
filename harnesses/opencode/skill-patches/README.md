# Skill Patches

This directory contains unified diff patches for external skills installed via `pull-external-skills.mjs`.

## Layout

Patches are organized by skill name:

```
skill-patches/
  <skill-name>/
    my-change.patch
    another-fix.patch
  <another-skill>/
    core-enhancement.patch
```

Each `.patch` file is a unified diff that can be applied to the installed skill copy.

## Creating a Patch

When you need to modify an external skill, create a patch instead of editing the installed copy directly. This preserves your changes across skill pin bumps.

1. Make changes to the installed skill (typically at `~/.config/opencode/skills/<skill-name>`)
2. Generate a patch from your changes:
   ```bash
   cd ~/.config/opencode/skills/<skill-name>
   git init  # if not already a git repo
   git add -A
   git diff --cached > /path/to/harnesses/opencode/skill-patches/<skill-name>/my-change.patch
   ```

   Or if the skill is already version-controlled:
   ```bash
   git diff > /path/to/harnesses/opencode/skill-patches/<skill-name>/my-change.patch
   ```

3. Commit the patch to your project repository

## Applying Patches

After pulling updated skills, apply patches using:

```bash
bun scripts/apply-patches.mjs
```

### Modes

- **Default**: Apply all patches, skip any already applied
  ```bash
  bun scripts/apply-patches.mjs
  ```

- **Dry-run**: List what would be applied without making changes
  ```bash
  bun scripts/apply-patches.mjs --dry-run
  ```

- **Check**: Verify all patches would apply cleanly (exit 1 if any fail)
  ```bash
  bun scripts/apply-patches.mjs --check
  ```

## Idempotency

The patch applier is idempotent — it detects when a patch is already applied and skips it. This means:
- Re-running apply-patches.mjs multiple times is safe
- Patches that have already been applied are skipped
- Partially applied patches are detected and reported

## Maintenance

Patches must survive skill pin bumps. If a skill is pinned to a new commit and a patch no longer applies:

1. Pull the updated skill
2. Update your local copy to include the patch changes
3. Regenerate the patch file
4. Re-apply using `apply-patches.mjs`

This ensures your customizations stay compatible with skill updates.
