# Smart Git Commit (sgc)

Smart Git Commit Assistant — automatically detects changes and generates [Conventional Commits](https://www.conventionalcommits.org/) compliant commit messages, along with branch management, commit history viewing, hook validation, and other all-in-one Git workflow tools.

> [中文](https://github.com/xiongcao/smart-git-commit/blob/master/README.md) | English

## Installation

```bash
npm install -g @xiongcao/smart-git-commit
```

Once installed, you can use the `sgc` command in any Git repository.

## Command Overview

| Command | Description |
|------|------|
| `sgc` | Interactively generate commit message and commit |
| `sgc commit` | Same as above |
| `sgc log` | View beautified commit history + type statistics |
| `sgc log --graph` | Graphical commit history |
| `sgc log 20` | View last 20 commits |
| `sgc status` | View repository status (enhanced) |
| `sgc branch` | View branch list |
| `sgc branch create` | Create a branch with standardized prefix |
| `sgc branch switch` | Interactively switch branches |
| `sgc branch delete` | Interactively delete branches |
| `sgc push` | Push to all remotes at once (multi-platform) |
| `sgc push --force` | Force push to all remotes |
| `sgc review <target>` | AI code review (local) |
| `sgc init` | Initialize config file `.sgcrc.json` |
| `sgc hook install` | Install commit-msg validation hook |
| `sgc hook uninstall` | Uninstall hook |
| `sgc hook check` | Check hook status |
| `sgc -h` / `sgc help` | View help info |

### Commit Options

| Option | Description |
|------|------|
| `--ai` | Use AI to generate commit message |
| `--auto` / `-a` | Skip interactive confirmation, commit directly |
| `--dry-run` / `-d` | Preview mode, no actual commit |

### Git Passthrough

All commands other than those listed above are forwarded to `git`, for example:

```bash
sgc add .           # → git add .
sgc diff            # → git diff
sgc push            # → git push
sgc pull            # → git pull
sgc checkout xxx    # → git checkout xxx
# ... any git command can be executed via the sgc prefix
```

---

## Feature Details

### 1. Smart Commit — `sgc` / `sgc commit`

Core feature: automatically analyzes staged file changes and generates Conventional Commits compliant commit messages.

**Workflow:**

1. Detect Git repository and current branch
2. If staging area is empty, list unstaged changes and ask whether to auto `git add -A`
3. Display staged file list and change statistics (lines added/deleted)
4. Auto-generate commit message in format: `type(scope): description`
5. Interactive selection: `Enter` to confirm / `e` to edit / `t` to change type / `q` to quit
6. Execute `git commit`

**Commit Options:**

```bash
sgc                     # Interactive mode
sgc --auto / -a         # Skip interaction, commit directly
sgc --dry-run / -d      # Preview mode, no actual commit
sgc --ai                # Use AI to generate commit message
```

**Generation Rules:**

The tool deeply scans each file's diff content, automatically analyzes specific changes, and generates Conventional Commits compliant commit messages.

**Rule-based mode** (default) analyzes:
- Added/deleted functions, methods, components, classes
- Added/removed dependencies (package.json)
- Modified config items with old/new value comparison
- Added/modified conditionals, error handling, async logic
- Style file property changes
- JSON config file structural changes
- Markdown document section changes

**AI generation mode** (`--ai`) describes the changes from a functional perspective, excluding filenames, paths, function names, and other code symbols — focusing more on business semantics.

You can customize type matching rules via `typeRules` in `.sgcrc.json`.

---

### 2. Commit History — `sgc log`

Beautified display of the last N commits with colored labels and type statistics.

```bash
sgc log                 # View last 10 commits
sgc log 20              # View last 20 commits
sgc log --graph         # Graphical branch history
```

Sample output:

```text
📜 Last 10 Commits
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  abc1234  feat(auth) Add login feature
  def5678  fix(api) Fix token expiration issue
  ghi9012  docs Update README

📊 Commit Type Statistics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  feat         ████████████████████ 8 (40.0%)
  fix          ██████████████ 6 (30.0%)
  docs         ██████ 3 (15.0%)
```

---

### 3. Repository Status — `sgc status`

A more user-friendly status display than `git status`:

- Shows current branch with ahead/behind info (`↑3 ↓1`)
- Groups files by staged (green) / unstaged (yellow) / untracked (magenta)
- Displays file count and line change statistics for each group
- Icon annotations for file status (new 🆕 / modified ✏️ / deleted 🗑️)

```bash
sgc status
```

---

### 4. Branch Management — `sgc branch`

All-in-one branch management tool with automatic standardized prefix addition when creating branches.

```bash
sgc branch              # View all branches, current branch marked with ●
sgc branch create       # Interactively create branch: choose prefix → enter name
sgc branch switch       # Interactively switch branches
sgc branch delete       # Interactively delete branches (supports --force)
```

**Branch creation example:**

```text
🌿 Create New Branch
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Select branch prefix:
  feat         → feat/
  fix          → fix/
  docs         → docs/
  chore        → chore/

Branch name (feat/): login

✅ Branch created and switched to: feat/login
```

Branch prefix mappings can be configured in `.sgcrc.json`.

---

### 5. Hook Management — `sgc hook`

Automatically installs a `commit-msg` hook to validate commit message format on every `git commit`.

```bash
sgc hook install        # Install hook (existing hook will be backed up)
sgc hook uninstall      # Uninstall hook (restore backup automatically)
sgc hook check          # Check hook installation status
```

After installation, commits that do not conform to the Conventional Commits format will be rejected:

```text
❌ Commit message format does not comply with the specification!

Required format: type(scope): description

Examples:
  feat: Add user login feature
  fix(auth): Fix token expiration issue
  docs: Update API documentation

Available types: feat, fix, docs, style, refactor, perf, test, chore, revert, build
```

---

### 6. Initialize Config — `sgc init`

Generates a `.sgcrc.json` config file in the root of the current Git repository.

```bash
sgc init
```

Config file contents and description:

```json
{
  "useAI": false,              // Whether to enable AI mode by default
  "apiKey": "",                // AI API Key (optional, reads from env var if empty)
  "aiModel": "gpt-4o-mini",    // AI model name
  "aiBaseUrl": "https://api.openai.com/v1",  // AI API endpoint
  "defaultType": "feat",       // Default commit type
  "typeRules": [...],          // File matching rules
  "commitTypes": [...],        // Available commit types
  "branchPrefixes": {...},     // Branch prefix mappings
  "language": "zh",            // Commit message language
  "pushRemotes": []            // Remote list for multi-platform push (empty = auto-detect, filter by repo name)
}
```

Config priority: **Project-level `.sgcrc.json` > Global `~/.sgcrc.json` > Default config**

---

### 7. Multi-Platform Push — `sgc push`

When your repository is hosted on multiple platforms (e.g., GitHub + Gitee), `sgc push` can push to all remotes at once, eliminating the tedious step-by-step manual pushes.

**Auto-Detect Mode** (default):

No configuration needed — `sgc push` automatically detects all remotes and filters out those that don't belong to the current repo (matched by repo name in URL):

```bash
sgc push
```

Sample output:

```text
🚀 Start Pushing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Branch: master
  Target: github (https://github.com/user/workflow.git), origin (https://gitee.com/user/workflow.git)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1/2] Pushing to github/master ...
[2/2] Pushing to origin/master ...

✅ Push successful (all 2 remotes)
```

**Preset Remotes:**

To manually specify which remotes to push (skip auto-detection), configure `pushRemotes` in `.sgcrc.json`:

```json
{
  "pushRemotes": ["origin", "github"]
}
```

**Passing Through Arguments:**

```bash
sgc push --force        # Force push
sgc push --set-upstream # Set upstream branch
```

---

## AI Mode

Supports generating smarter commit messages via AI, compatible with the OpenAI API protocol (supports OpenAI, Alibaba Tongyi Qianwen, etc.).

### Configuration

**Option 1: Environment Variables**

```bash
export OPENAI_API_KEY="sk-your-key"      # OpenAI
export DASHSCOPE_API_KEY="your-key"      # Alibaba Tongyi Qianwen
```

**Option 2: Config File**

Set in `.sgcrc.json`:

```json
{
  "useAI": true,
  "apiKey": "your-api-key",
  "aiModel": "gpt-4o-mini",
  "aiBaseUrl": "https://api.openai.com/v1"
}
```

**Option 3: Interactive Input**

Run `sgc --ai` directly, and the tool will prompt for the key (valid for the current session only).

### Usage

```bash
sgc --ai                # Use AI to generate commit message
```

---

## Code Review (AI Review)

Automatically review code changes via AI, supporting both local CLI and Webhook auto-triggered approaches.

### Local Review — `sgc review`

Review code differences between two branches via the command line:

```bash
# Review changes in the current branch relative to main
sgc review main

# Review a specific branch
sgc review feat-login --target main
```

**Review content includes:**

- Logic errors and potential bugs
- Security vulnerabilities (SQL injection, XSS, etc.)
- Performance issues and optimization suggestions
- Code maintainability (naming conventions, duplicate code, etc.)
- Boundary conditions and exception handling

Review reports are displayed with severity levels and include specific code modification suggestions (with line number positioning).

### Auto Review (Webhook)

Deploy code review as a Cloudflare Worker that automatically triggers AI review when a PR/MR is created on GitHub/Gitee/GitLab — no self-hosted server required.

**How it works:**

```
Create PR/MR → Platform Webhook notification → Cloudflare Worker
    → Fetch code diff → AI review → Auto-publish inline comments
```

**Features:**

- **Free**: Cloudflare Workers free tier offers 100,000 requests per day
- **Multi-platform**: One codebase supports GitHub, Gitee, and GitLab simultaneously
- **Inline comments**: AI suggestions pinpoint specific code lines
- **Zero maintenance**: Fully automated after deployment

**Quick Deploy:**

```bash
cd workers
wrangler deploy
```

See [DEPLOY.md](./DEPLOY.md) for detailed deployment guide.

---

## Project Structure

```
smart-git-commit/
├── index.js              # Main entry, command routing
├── package.json          # Registers sgc global command
├── lib/
│   ├── colors.js         # ANSI terminal color utilities
│   ├── git.js            # Git command wrappers
│   ├── config.js         # Configuration management
│   ├── generator.js      # Commit message rule-based generator
│   ├── ai.js             # AI mode (OpenAI compatible interface)
│   ├── reviewer.js       # Code review (AI analysis + report generation)
│   ├── prompt.js         # Interactive utilities
│   └── commands/
│       ├── commit.js     # Commit workflow
│       ├── log.js        # Commit history
│       ├── status.js     # Repository status
│       ├── review.js     # Local review command
│       ├── push.js        # Multi-platform push
│       ├── branch.js     # Branch management
│       ├── hook.js       # Hook management
│       └── init.js       # Initialize config
└── workers/
    ├── review-webhook.js # Webhook auto-review Worker
    └── wrangler.toml     # Cloudflare Worker config
```

## Development & Publishing

### Publish to npm

```bash
# 1. Update version number (modify the version field in package.json)
# 2. Login to npm (first time only)
npm login --registry https://registry.npmjs.org

# 3. Publish
npm publish --access public --registry https://registry.npmjs.org

# 4. If OTP 2FA is enabled, include the verification code
npm publish --access public --registry https://registry.npmjs.org --otp=<code>
```

### Update sgc

After publishing a new version, users can update with:

```bash
npm update -g @xiongcao/smart-git-commit
```

Or reinstall:

```bash
npm install -g @xiongcao/smart-git-commit
```

### Deploy Webhook Worker

After modifying `workers/review-webhook.js`, redeploy:

```bash
cd workers
wrangler deploy
```

## License

MIT
