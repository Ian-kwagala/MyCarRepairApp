@AGENTS.md

## Code comments (always)

Every file you create or edit must explain what its code does:

- **File header**: start each source file with a short comment saying what the file is for and how it fits into the app (e.g. which screen it is, which layer it belongs to).
- **Exports**: give every exported function, component, hook, class, and type a `/** JSDoc */` comment describing what it does, and its inputs/outputs when that isn't obvious.
- **Logic**: add `//` comments to non-obvious blocks — business rules, side effects, platform differences, workarounds, and why something is done a certain way. Skip comments that only restate a single obvious line.
- **Keep them current**: when you change code, update or remove any comment it makes stale. When you touch a file that is missing comments, add them.
- Match the existing style: `//` for inline notes, `/** */` for declarations, and blueprint references like `(§13.1)` where they apply.
