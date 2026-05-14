# Contributing

Thanks for your interest in contributing to obsidian-bases-kanban.

## Before you start

Check the [issue tracker](https://github.com/xiwcx/obsidian-bases-kanban/issues) to see if your idea or bug is already being discussed. If you haven't contributed before, please open an issue before starting work on a PR — it's much easier to align on approach before code is written.

## Making changes

1. Fork the repo and create a branch from `main`.
2. Add tests for any new or changed functionality.
3. Make sure all checks pass locally before opening a PR:
   ```
   npm run format        # Biome must report no formatting violations
   npm run lint          # ESLint must report no errors
   npm test              # all tests must pass
   npm run build         # TypeScript must compile and bundle cleanly
   ```

## Opening a pull request

When you open a PR, please include:

- **Screenshots or a short video** showing the change in Obsidian
- **Verification criteria** — a brief description of how you tested the change and what edge cases you considered

This makes review faster and helps maintainers understand your intent.
