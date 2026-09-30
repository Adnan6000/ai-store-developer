# Testing & Release Gates

## Core Commands

```powershell
npm run typecheck
npm run lint
npm run build
npx prisma migrate status
```

## Milestone 4 Test Matrix

### AI Providers

- valid Gemini key
- invalid Gemini key
- valid OpenAI key
- invalid OpenAI key
- one provider connected
- two providers connected
- preferred provider failure
- fallback provider success
- rate limit
- network error
- provider unavailable

### Planning

- Standard mode
- Reviewed mode
- missing context
- no provider connected
- malformed JSON
- failed repair
- unsupported output

### Validation

- valid plan
- invalid category
- invalid operation intent
- missing scope
- high-risk plan
- blocked plan

### Approval

- approve valid plan
- reject valid plan
- blocked plan cannot be approved
- another shop cannot access or approve plan

### History

- shop-isolated history
- correct order
- correct timestamps
- correct status