# rules/gate-policy.md

Applies to EVERY flow. Formalizes the reversible→proceed / irreversible→stop principle and adds "don't stall on a soft gate — move forward on the stated default." Three tiers:

1. **Auto-proceed** (reversible; a clear sensible default exists): state the default + why, then proceed. Never block. (e.g. "defaulting to medium/native, starting collection.")
2. **Soft-confirm** (moderate consequence; good default exists): state the default + alternatives, then proceed with the default if unaddressed — in interactive use, on the next turn if the user doesn't redirect; in autonomous/`/loop` use, after an idle threshold of 20 minutes (via ScheduleWakeup). Never hang indefinitely.
3. **Hard gate** (always block for explicit confirmation, NO timeout auto-proceed): git push / PR / merge (via `hanko--git-seal`); launching a deep / `/deep-research` run (real token spend); deletion or overwrite of files we did not create; any scope change.

**Honest mechanism note:** a literal timer only fires in autonomous/`/loop` contexts (ScheduleWakeup). In plain interactive Claude Code the agent ends its turn and the soft-gate default fires on the user's next message if unaddressed — there is no background clock mid-turn. Dynamic `workflows/` runs take no mid-run input at all, so their gating is pre-launch or between-stage only.
