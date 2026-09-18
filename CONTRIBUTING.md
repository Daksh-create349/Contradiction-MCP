# Contributing to Contradiction MCP

Thank you for your interest in contributing to **Contradiction MCP**! 🎉

Contradiction MCP is an open-source intelligence engine designed to detect, analyze, and resolve cross-document inconsistencies and contradictions for AI agents and developer workflows. We welcome all forms of contribution: bug fixes, new connector implementations, heuristic rule additions, test coverage expansions, documentation improvements, and architectural suggestions.

---

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

---

## How Can I Contribute?

### 1. Reporting Bugs
- Search existing [GitHub Issues](https://github.com/Daksh-create349/Contradiction-MCP/issues) first to ensure the bug hasn't already been reported.
- If it's a new bug, open a [Bug Report](https://github.com/Daksh-create349/Contradiction-MCP/issues/new?template=bug_report.yml).
- Include:
  - Clear reproduction steps.
  - Sample document fragments or payload causing the failure.
  - Node.js version and MCP client environment (e.g. Claude Desktop, Cursor, Gemini CLI).
  - Expected vs. actual behavior.

### 2. Suggesting Features & Connectors
- Open a [Feature Request](https://github.com/Daksh-create349/Contradiction-MCP/issues/new?template=feature_request.yml) or start a thread in [Discussions](https://github.com/Daksh-create349/Contradiction-MCP/discussions).
- Explain why the feature is needed, how it benefits agent workflows, and any proposed tool / API designs.

### 3. Finding "Good First Issues"
- Look for issues tagged with [`good first issue`](https://github.com/Daksh-create349/Contradiction-MCP/labels/good%20first%20issue) or [`help wanted`](https://github.com/Daksh-create349/Contradiction-MCP/labels/help%20wanted).
- Comment on the issue to let everyone know you're working on it!

---

## Development Setup

### Prerequisites
- **Node.js**: `>= 20.0.0`
- **npm**: `>= 10.0.0`
- **Git**: `>= 2.30.0`

### 1. Fork and Clone
```bash
# Clone your fork
git clone https://github.com/<your-username>/Contradiction-MCP.git
cd Contradiction-MCP

# Navigate to package directory
cd contradiction-mcp

# Install dependencies
npm install
```

### 2. Development Scripts
Inside the `contradiction-mcp` directory, the following scripts are available:

| Command | Purpose |
|---|---|
| `npm run dev` | Run server in development watch mode |
| `npm run build` | Compile TypeScript into `dist/` |
| `npm test` | Run complete Vitest suite (194 tests) |
| `npm run test:watch` | Run Vitest in interactive watch mode |
| `npm run typecheck` | Verify TypeScript compilation (`tsc --noEmit`) |
| `npm run lint` | Run ESLint across codebase |
| `npm run format:check` | Check code formatting via Prettier |
| `npm run format` | Auto-format files via Prettier |
| `npm run security:check` | Run `npm audit` for dependency vulnerabilities |

---

## Code Guidelines & Standards

1. **TypeScript First**:
   - Write clean, strictly typed TypeScript. Avoid `any` where possible.
   - Use zod schemas for runtime parameter validation.
2. **Deterministic Analysis**:
   - Extraction, normalization, and contradiction detection logic must be pure and deterministic.
   - Every bug fix should be accompanied by a regression unit test in `tests/`.
3. **Tool Registration**:
   - When introducing or modifying MCP tools, ensure both dot-notation (`contradiction.*`) and legacy routing shims are maintained in `server.ts`.
4. **Code Style**:
   - Run `npm run format` before pushing to ensure compliance with our Prettier configuration.

---

## Pull Request Workflow

1. **Create a Branch**:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```
2. **Make Changes & Add Tests**:
   - Write your code changes.
   - Add unit/integration tests covering new paths in `tests/`.
3. **Verify All Checks Pass**:
   ```bash
   cd contradiction-mcp
   npm run typecheck
   npm run lint
   npm run format:check
   npm test
   npm run build
   ```
4. **Commit Your Changes**:
   - Use [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat: add postgres connector`, `fix: handle unit mismatch in quantity comparator`, `docs: update quickstart`).
5. **Push & Open PR**:
   ```bash
   git push origin feat/your-feature-name
   ```
   - Open a PR against `main` on `Daksh-create349/Contradiction-MCP`.
   - Fill out the PR template completely.

---

## Community & Questions

Have questions or want to discuss architecture ideas?
- Join the [GitHub Discussions](https://github.com/Daksh-create349/Contradiction-MCP/discussions)
- Email: [dakshshrivastav56@gmail.com](mailto:dakshshrivastav56@gmail.com)

Thank you for making Contradiction MCP better for everyone! 🚀
