# MediaDB - Project Instructions & AI Agent Rules

This document outlines the architectural guidelines, API integrations, and metadata writing standards for the `mediadb` plugin. Any AI agent modifying this codebase must adhere strictly to these rules.

---

## 1. Metadata (Frontmatter) Writing Standards

### 📝 YAML Writing Safety

- **Rule**: When modifying frontmatter on markdown files, never write unescaped special characters (like `:` or `[]`) directly into YAML strings.
- **Solution**: Ensure values containing special characters are wrapped in double quotes. Lists must be written as valid YAML arrays (e.g., `genres: ["Action", "Adventure"]` or as bullet items).
- **Field Name Case-Consistency**: Do not mix singular and plural field names (e.g., maintain consistency between `genre` vs `genres`, `director` vs `directors`). Follow user conventions in existing notes.

### 🧹 Cleaning Missing or Null Values

- **Rule**: Do not write empty, `null`, `undefined`, or `"N/A"` string values to frontmatter.
- **Solution**: Clean keys with invalid or empty values before writing. Clean up missing fields instead of storing empty metadata variables.

---

## 2. API Integrations & Request Safety

### 🚀 Rate Limiting & Caching

- **Rule**: Avoid spamming external APIs (like IGDB, TMDB, or Goodreads) during database sync or rescan.
- **Solution**: Implement appropriate request throttling (e.g., minimum 100-250ms debounces) and prioritize reading from local caches (if available) before invoking network fetches.
- **API Key Security**: Never hardcode API keys or secret credentials. Always pull them from the plugin settings page.

### 🧩 Subtype Handlers

- **Rule**: Handle media subtypes (e.g., Movie vs TV Show, Game vs DLC) dynamically, mapping relevant fields accordingly (e.g., `playtime` for games, `episodes` for series, `duration` for movies).

---

## 3. Workflow Commitments

- **Package Manager & Builds**:
    - This project **must** be managed using Bun. Always install dependencies using `bun install` which creates/updates `bun.lockb`.
    - **Never generate or commit `package-lock.json`** to keep the repository aligned with the original developer's workflow.
    - Always run compilation using Bun (`bun run build` or `cmd.exe /c "bun run build"`) before finalizing turns to check for TypeScript errors.
- **Deletions & Replaces**: Deleting any file (including source files, config files, package-lock files, or user notes) must always be pre-approved by the user. Never execute a delete operation without explicit confirmation.

---

## 4. AI Agent Interaction & Query Guidelines

- **Default to Text/Explanation**: If the user's message is investigatory, conceptual, or a question (e.g. asking "how does X work?", "why is Y needed?", "explain Z", or asking for alternatives), **DO NOT write code, edit files, or execute commands**. You must answer purely in text.
- **Coding Trigger**: Only modify, write, or create code/files if the user explicitly commands it using action verbs (e.g. "implement this", "fix the bug", "refactor X", "write a script", "code the solution") or explicitly requests a code implementation.
- **Keep it Concise**: Keep explanations direct and avoid unnecessary verbosity.

### 🛑 Quality Guard Rules

- **No Placeholders**: Never write placeholder code (e.g., `// ... existing code ...` or `// TODO`). Always rewrite/provide the full block or file content to prevent syntax errors and broken files.
- **Scoped CSS Only**: Do not style generic HTML tags globally. Ensure all styles added to `styles.css` are scoped inside plugin-specific classes (e.g., prefix classes or widget wrappers) to prevent style bleeding into other Obsidian components.
- **No Redundant Dependencies**: Do not install new npm/bun packages if the functionality can be accomplished using the native Obsidian API or Vanilla JS/TS. Always check `package.json` first.
- **No Emojis**: Never use emojis in code, code comments, commit messages, console output, or user-facing notices. Use plain text or Obsidian-specific callout/styling structures instead.
