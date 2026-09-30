# Development Workflow

## Source of Truth

GitHub repository is the authoritative source of truth.

Important project decisions must not live only in chat or external AI coding tools.

## Before Work

Run:

```powershell
git status
git pull
```

## During Development

After meaningful code changes:

```powershell
npm run typecheck
npm run lint
npm run build
```

If database changes are involved:

```powershell
npx prisma migrate status
```

## Documentation Rule

Before completing any milestone, update:

- `docs/02-MILESTONES.md`
- `docs/03-CURRENT-STATUS.md`

If architecture changes:

- `docs/07-DECISIONS.md`

If shipped changes occur:

- `CHANGELOG.md`

## Commit Conventions

Good:

```text
Milestone 4: complete AI planning and approval engine
Milestone 5: add execution operation registry
Fix: enforce shop isolation during approval
Docs: update execution architecture
```

Avoid:

```text
update
changes
fix stuff
```

## Milestone Release Gate

A milestone is complete only when:

1. typecheck passes
2. lint passes
3. build passes
4. migrations verified
5. happy-path runtime test passes
6. failure-path test passes
7. tenant isolation passes
8. safety gates pass
9. documentation updated
10. checkpoint commit pushed