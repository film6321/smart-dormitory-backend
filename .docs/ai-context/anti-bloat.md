# Anti-Bloat & Complexity Guardrails

**Version:** 1.0.0 | **Updated:** 2026-07-02

## 1. Core Principle

Keep the project lean. Prefer solving the current task with the smallest change that works.

## 2. Rules

- Do not create new files, folders, modules, hooks, services, or abstractions unless they are necessary for the current task.
- Prefer editing existing files before creating new ones.
- Do not add new packages or libraries when the current stack already provides a suitable option.
- Avoid creating new docs/spec files unless the task truly needs them.
- Avoid introducing extra layers that do not reduce complexity.
- Keep the implementation aligned with the MVP scope.

## 3. Avoid These Patterns

- Creating a new service/hook/util for every small change.
- Splitting a simple feature into many files just for structure.
- Adding state management or architecture layers before the project actually needs them.
- Building advanced features before the current MVP is stable.

## 4. Before Adding Complexity

Ask:

1. Does this reduce real complexity?
2. Is this required for the current task?
3. Can the same outcome be achieved with existing files?
4. Will this make the project harder to maintain?
