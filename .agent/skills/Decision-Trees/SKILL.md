# Decision Trees — Structured Logic

A logic engine for designing branching narratives, dialogue trees, and complex RPG decision outcomes.

## When to Use

- **Dialogue Design**: Branching conversation paths based on player choices.
- **Skill Checks**: Calculating Expected Value (EV) for different RPG strategies.
- **World Events**: Managing multiple outcomes for major game decisions.

## Workflow

1. **Structuring**: Identify action options and possible outcomes.
2. **Visualization**: Draw trees in markdown to map paths.
3. **Calculation**: Use Expected Value (EV) to determine "optimal" AI responses.

## Example (RPG Dialogue)

```
Decision (Persuade the Guard)
├─ Success (70%) → Value: Entrance granted, 50 XP
└─ Failure (30%) → Value: Combat starts, -10 Reputation
```

---
*Safety Check: Pure mathematical/logical structuring tool. No dangerous code.*
