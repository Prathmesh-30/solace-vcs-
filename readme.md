# Solace VCS 

> A Git-inspired version control system built from scratch in Node.js
>
> ---

## What is Solace?

Solace is a lightweight version control system that implements the core ideas behind Git — **content-addressed object storage**, a **staged index**, and **parent-linked commit chains** — using nothing but Node.js built-ins and a handful of small npm packages.

It's not a Git wrapper. Every operation is written from scratch: hashing, file storage, commit traversal, and diffing all run on raw filesystem APIs.

It also ships a **Secret Guardian** — a pre-stage scanner that blocks files containing exposed credentials (AWS keys, Google API keys, hardcoded secrets) before they can ever be committed.

---

![image ](https://res.cloudinary.com/dwioxbbrl/image/upload/q_auto/f_auto/v1776064856/Screenshot_2026-04-13_124551_vrdhtg.png)
![image ](https://res.cloudinary.com/dwioxbbrl/image/upload/q_auto/f_auto/v1776064856/Screenshot_2026-04-13_124852_pse7dp.png)
![image ](https://res.cloudinary.com/dwioxbbrl/image/upload/q_auto/f_auto/v1776064875/Screenshot_2026-04-13_125032_osn9ap.png)

---



## Features

| Command | What it does |
|---------|-------------|
| `init` | Creates `.solace/` with object store, branch refs, config, and a `.solaceignore` template |
| `add <file>` | Stages a file after running existence, ignore, and secret checks |
| `commit <message>` | Saves a SHA-1 hashed, parent-linked snapshot of staged files |
| `log` | Walks the parent chain and prints the full commit history |
| `status` | Shows staged files and the current branch |
| `diff <h1> <h2>` | Line-by-line diff between any two commits, including deleted files |

---

## 🛡️ Secret Guardian

Before any file is staged, Solace scans its content for credential patterns. If a match is found, the file is blocked — no staging, no commit.

**Detected patterns:**

| Pattern | Regex |
|---------|-------|
| AWS Access Key | `AKIA[0-9A-Z]{16}` |
| Google API Key | `AIza[0-9A-Za-z-_]{35}` |
| Generic Secret | `(api_key\|secret\|password)\s*[:=]\s*['"][^'"]{6,}['"]` |

> The generic pattern only fires when a value is actually assigned — not on innocent comments like `// api_key param is required`.

**Example block:**
```
🛡️  SECRET GUARDIAN ALERT!
   Security risk detected in: config.js
   ⚠  Possible Generic Secret
   Action blocked to prevent credential leak.
```

---

## How It Works

### The object store

Every file Solace tracks is stored as `SHA-1(content)` in `.solace/objects/`. Two identical files always produce the same hash — only one copy is ever stored. This is the same idea Git calls a "blob".

### Commits

A commit is a JSON object:

```json
{
  "timeStamp": "2025-04-12T14:22:10.000Z",
  "message": "add secret guardian",
  "files": [
    { "path": "index.js", "hash": "a3f92c1..." }
  ],
  "parent": "b81e447..."
}
```

That JSON is itself SHA-1 hashed and stored in `.solace/objects/`. The `parent` field creates a linked chain — that's the commit history.

### Branches

`HEAD` stores a symbolic ref (`ref: refs/heads/main`), which points to `.solace/refs/heads/main`, which holds the latest commit hash. This mirrors exactly how Git manages branches — no magic, just file pointers.

---

## Project Flow

![Solace VCS Flow](https://res.cloudinary.com/dwioxbbrl/image/upload/q_auto/f_auto/v1776063779/Screenshot_2026-04-13_123211_eflcwl.png)

The `add` pipeline (purple) and `commit` pipeline (teal) are independent — both ultimately write into the same content-addressed object store (green).

---

## Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/solace-vcs.git
cd solace-vcs

# Install dependencies
npm install

# Optional: make the CLI globally available
npm link
```

**Dependencies:**

| Package | Purpose |
|---------|---------|
| `chalk` | Terminal colors |
| `commander` | CLI argument parsing |
| `diff` | Line-by-line diff generation |

---

## Usage

```bash
# Initialize a new repo
node solace.mjs init

# Stage a file (runs secret scan first)
node solace.mjs add index.js

# Commit staged files
node solace.mjs commit "initial commit"

# View history
node solace.mjs log

# Check what's staged
node solace.mjs status

# Diff two commits (use hashes from log)
node solace.mjs diff a3f92c1 b81e447
```

---

## Testing the Secret Guardian

Create a file with a fake secret:

```js
// config.js
const api_key = "my-super-secret-key-123";
```

Try to stage it:

```bash
node solace.mjs add config.js
# → blocked with SECRET GUARDIAN ALERT
```

Create a clean file:

```js
// utils.js
function add(a, b) { return a + b; }
```

Stage it:

```bash
node solace.mjs add utils.js
# → Staged: utils.js
```

---

## Project Structure

```
solace-vcs/
├── solace.mjs          # entire VCS — single file
├── package.json
├── .solaceignore       # auto-created on init
└── .solace/            # auto-created on init
    ├── HEAD            # ref: refs/heads/main
    ├── index           # staging area (JSON)
    ├── config.json     # repo metadata
    ├── objects/        # content-addressed file store
    │   ├── a3f92c1...  # a commit object
    │   └── b5d7e2a...  # a file blob
    └── refs/
        └── heads/
            └── main    # latest commit hash
```

---

## What I Learned

- **Content-addressed storage** — hashing content instead of tracking filenames means deduplication is free and integrity checks are trivial
- **Stateful regex pitfalls** — the `g` flag on a regex makes `.test()` advance `lastIndex`, causing unpredictable false negatives on repeated calls; fixed by resetting `lastIndex = 0` before each test
- **Symbolic refs** — why Git's `HEAD` doesn't store a hash directly, and how indirection through `refs/heads/<branch>` makes branch switching clean
- **Diff as a set operation** — the original diff only iterated the newer commit's files; computing a union of both commits' paths correctly surfaces deleted files

---

## Possible Next Steps

- [ ] Branch creation and switching (`branch`, `checkout`)
- [ ] Merging two branches
- [ ] Remote support (push/pull over HTTP)
- [ ] `restore` — undo staged changes
- [ ] Web UI dashboard (see `/docs/index.html`)

---

## Tech Stack

- **Runtime** — Node.js with ES Modules (`"type": "module"`)
- **Hashing** — `node:crypto` SHA-1
- **Storage** — raw `fs/promises` filesystem operations
- **CLI** — Commander.js
- **Output** — Chalk v5
- **Diffing** — diff (Meyers algorithm)

---

