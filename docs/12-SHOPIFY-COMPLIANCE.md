# Shopify Policy & Platform Compliance Strategy

## Core Principle

Use Shopify-native platform mechanisms whenever Shopify provides them.

## Embedded Experience

The product should remain a proper interactive embedded Shopify admin application.

Use Shopify platform tools such as App Bridge where applicable.

## Theme Integration

Prefer Theme App Extensions for app-provided storefront functionality when appropriate.

Advantages:

- reduced direct theme-code mutation
- merchant configuration through theme editor
- cleaner uninstall behavior
- lower theme breakage risk

## Direct Theme Editing

Direct theme modification should be treated as a separate developer capability.

When direct edits are necessary:

- target an explicit theme
- create backup/snapshot
- generate exact diff
- run Theme Check
- provide preview
- require approval
- preserve rollback data
- avoid silent published-theme edits

## Scripts

Do not build new storefront functionality around legacy ScriptTag injection.

Prefer current Shopify extension mechanisms.

## Liquid

Generated Liquid must satisfy Shopify parsing and validation requirements.

Theme validation should run before deployment.

## Scopes

Follow least privilege.

Do not request broad scopes only because a future feature may need them.

Add scopes only when an implemented capability requires them.

## Merchant Transparency

The merchant should be able to understand:

- what data is accessed
- which Shopify scopes are needed
- what AI provider receives context
- what will change
- risk level
- whether the action is reversible

## Public Distribution Requirements

Before Shopify App Store submission:

- embedded experience works correctly
- app is free from blocking UI/runtime errors
- privacy/compliance complete
- install/reinstall/uninstall tested
- storefront integration tested
- billing tested
- onboarding complete
- production monitoring enabled