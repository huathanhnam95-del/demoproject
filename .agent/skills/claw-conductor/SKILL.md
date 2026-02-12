# Claw Conductor v2.1

**Your always-on development assistant - handles everything from quick questions to full project builds.**

Claw Conductor is an intelligent orchestration layer that:

- 🎯 **Always-On**: Handles every message automatically (no need to invoke)
- 🤖 **Smart Triage**: Detects simple questions vs development tasks
- 💬 **Discord-Aware**: Auto-maps channels to project workspaces
- 🔀 **Multi-Model**: Routes tasks to optimal AI based on capabilities
- ⚡ **Parallel Execution**: Builds complete projects efficiently

## 🚀 How It Works

**Automatic Flow:**

1. Message arrives in Discord channel (e.g., #scientific-calculator)
2. Claw-conductor detects channel → maps to `/root/projects/scientific-calculator`
3. Triages request: Simple question or development task?
4. **If Simple**: Quick response from fast model with project context
5. **If Development**: Full orchestration - decompose, route, execute, consolidate

**You never need to explicitly invoke it** - it handles everything automatically!

## 🎯 Usage Examples

**Simple Questions** (fast response):

```
User: What files are in this project?
Conductor: 📋 Simple response mode
          [Lists files from /root/projects/scientific-calculator]

User: How does the calculator work?
Conductor: 📋 Simple response mode
          [Explains architecture with project context]
```

**Development Tasks** (full orchestration):

```
User: Build a scientific calculator with trig functions
Conductor: 🔧 Development mode - full orchestration
          [Decomposed into tasks, routes to models, executes in parallel]

User: Fix the bug in the calculation logic
Conductor: 🔧 Development mode - full orchestration
          [Analyzes code, creates fix, tests, commits]
```

## 🚀 Skill Invocation (For OpenClaw Agent)

**NEW: Always-On Mode (Recommended)**

Configure this skill as the default handler for Discord channels in "Active Projects" category:

```python
# In OpenClaw agent configuration
from orchestrator import Orchestrator

orchestrator = Orchestrator()

# Handle ALL messages through conductor
result = orchestrator.handle_message(
    request=user_message,
    channel_id=discord_channel_id,
    channel_name=discord_channel_name
)
```

## What's New in v2.1

🤖 **AI-Powered Decomposition**: Intelligently analyzes complex requests using your best AI model (auto-selected or configured)
🎯 **Full Orchestration**: Decomposes complex requests → Routes subtasks → Executes in parallel → Consolidates results
⚡ **Parallel Execution**: Up to 5 tasks running concurrently across multiple projects
📁 **Project Management**: Automatic workspace creation, git initialization, and GitHub integration
🔗 **Dependency-Aware**: Respects task dependencies and file conflicts
📦 **Auto-Consolidation**: Merges results, runs tests, commits to git, pushes to GitHub

### Installation

In OpenClaw:

```bash
cd ~/.openclaw/skills
git clone https://github.com/johnsonfarmsus/claw-conductor.git
cd claw-conductor
./scripts/setup.sh
```

### Complete Workflow

```
Discord Request
    ↓
1. Task Decomposition
2. Intelligent Routing
3. Project Initialization
4. Parallel Execution
5. Result Consolidation
    ↓
Discord Completion Report
```

### Scoring Algorithm

Each model is scored 0-100 for each task:

```python
score = (
    (rating / 5.0) * 50 +              # Model capability (0-50 pts)
    (1 - complexity/5.0) * 40 +        # Complexity fit (0-40 pts)
    (experience / 100) * 10 +          # Experience (0-10 pts)
    cost_factor * 10                   # Cost (0-10 pts)
)
```

### Task Categories (23 Standard)

- code-generation-new-features
- bug-detection-fixes
- multi-file-refactoring
- unit-test-generation
- debugging-complex-issues
- api-development
- security-vulnerability-detection
- security-fixes
- documentation-generation
- code-review
- frontend-development
- backend-development
- database-operations
- codebase-exploration
- dependency-management
- legacy-modernization
- error-correction
- performance-optimization
- test-coverage-analysis
- algorithm-implementation
- boilerplate-generation

### Advanced Features

- **Multi-Project Support**: Handle concurrent requests across different projects.
- **File Conflict Detection**: Tasks touching the same files run sequentially.
- **Dependency-Aware Scheduling**: Respects task dependencies.
- **Auto-Consolidation**: Merges results, runs tests, commits to git.

### Troubleshooting

- **Task Decomposition Issues**: Be specific in request. Include keywords like "database", "API".
- **Model Selection Issues**: Adjust capability ratings in `agent-registry.json`.
- **Execution Failures**: Check error logs in `.claw-conductor/execution-log.json`.
- **Git Conflicts**: Currently requires manual resolution.

## Roadmap

- [x] Task decomposition (v2.0)
- [x] Parallel execution (v2.0)
- [x] Multi-project support (v2.0)
- [x] Auto-consolidation (v2.0)
- [ ] AI-powered decomposition (v2.1)
- [ ] Discord progress updates (v2.1)
- [ ] Conflict resolution with AI (v2.2)

---
*Built with ❤️ by the Claw Conductor team*
