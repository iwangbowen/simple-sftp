# AGENTS.md - simple-sftp VS Code Extension

## Build, Lint, Test Commands

- **Build**: `npm run build` (production) or `npm run compile` (dev)
- **Watch**: `npm run watch` (auto-rebuild on changes)
- **Lint**: `npm run lint`
- **Test**: `npm run test` (run once) or `npm run test:watch` (watch mode)
- **Single test**: `npm run test -- src/path/to/file.test.ts` (vitest supports file filtering)
- **Unit tests only**: `npm run test:unit`
- **Integration tests**: `npm run test:integration`
- **Coverage**: `npm run test:coverage`

## Architecture & Codebase Structure

**VS Code Extension** providing SFTP client with port forwarding and SSH configuration sync.

**Key Modules**:
- `sshConnectionManager.ts` - SSH/SFTP connection handling
- `sshConnectionPool.ts` - Connection pooling
- `hostManager.ts` - Host configuration management
- `services/` - Business logic (transfer, auth, etc.)
- `ui/` - UI components (tree providers, webviews)
- `models/` - Data structures
- `integrations/` - Third-party integrations
- `attributePreservingTransfer.ts`, `compressionTransfer.ts`, `parallelChunkTransfer.ts` - Transfer strategies

**Entry**: `extension.ts` (activation on file system and treeview events)

## Code Style & Conventions

- **Language**: TypeScript (ES2021), compiled to CommonJS
- **Linter**: ESLint with @typescript-eslint
- **Naming**: camelCase (default), PascalCase for types/classes, UPPER_CASE for constants
- **Imports**: Standard TS imports, mock aliases in tests via vitest config
- **Testing**: Vitest with node environment; mocks in `__mocks__/` (vscode is mocked)
- **Strict mode**: Enabled in tsconfig
- **Formatting**: Semi-colons encouraged, curly braces required
- **Error handling**: Use typed exceptions, avoid throwing literals
- **No trailing spaces**, consistent formatting with ESLint rules
