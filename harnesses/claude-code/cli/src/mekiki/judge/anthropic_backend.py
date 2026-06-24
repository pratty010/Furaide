import json
import os
from anthropic import Anthropic
from mekiki import config
from mekiki.judge.interface import InvocationContext, Judgment, Gap, AvailableSkillCtx
from mekiki.judge import prompts


class AnthropicBackend:
    def __init__(self):
        self.cfg = config.load().judge
        self.client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    def _call(self, model: str, system: str, user: str, max_tokens: int = 512) -> str:
        resp = self.client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        parts = []
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                parts.append(block.text)
        return "".join(parts).strip()

    def _parse_json(self, raw: str) -> dict | list:
        """Parse JSON from LLM response, stripping markdown fences if present."""
        stripped = raw.strip()
        # Strip markdown fences
        if stripped.startswith("```"):
            lines = stripped.split("\n")
            stripped = "\n".join(lines[1:])
            if stripped.endswith("```"):
                stripped = stripped[:-3].strip()
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass
        # Find earliest opener that exists
        bracket_pos = stripped.find("[")
        brace_pos = stripped.find("{")
        if bracket_pos >= 0 and (brace_pos < 0 or bracket_pos < brace_pos):
            end = stripped.rfind("]")
            if end >= 0:
                return json.loads(stripped[bracket_pos:end + 1])
        if brace_pos >= 0:
            end = stripped.rfind("}")
            if end >= 0:
                return json.loads(stripped[brace_pos:end + 1])
        raise ValueError(f"Could not parse JSON: {raw[:200]}")

    def classify_invocation(self, ctx: InvocationContext) -> Judgment:
        """G-Eval two-phase: generate eval steps, then score each.

        used_downstream and session_ended_cleanly are NOT set here —
        they are read from DB by the orchestrator.
        """
        model = self.cfg.anthropic_model_classify

        # Phase 1: generate eval steps (criteria)
        steps_raw = self._call(
            model, prompts.GEVAL_STEPS_SYSTEM, prompts.geval_steps_prompt(ctx), max_tokens=256
        )
        try:
            steps = self._parse_json(steps_raw)
            if not isinstance(steps, list):
                steps = [str(steps)]
        except Exception:
            steps = [
                "Was the correct skill chosen for the user's request?",
                "Was the skill's output used in the subsequent response?",
                "Did the user react positively to the outcome?",
            ]

        # Phase 2: score each step
        scores: list[int] = []
        user_reaction = "none"
        user_reaction_quote = ""
        notes_parts: list[str] = []

        for step in steps[:5]:  # cap at 5 steps
            score_raw = self._call(
                model, prompts.GEVAL_SCORE_SYSTEM, prompts.geval_score_prompt(step, ctx), max_tokens=128
            )
            try:
                data = self._parse_json(score_raw)
                if isinstance(data, dict):
                    s = int(data.get("score", 5))
                    scores.append(s)
                    reasoning = data.get("reasoning", "")
                    if reasoning:
                        notes_parts.append(f"{step}: {reasoning}")
                    # Derive user_reaction from scores heuristically
                    if s >= 7 and user_reaction == "none":
                        user_reaction = "positive"
                    elif s <= 3:
                        user_reaction = "negative"
            except Exception:
                scores.append(5)

        normalized = round((sum(scores) / (len(scores) * 10)), 3) if scores else 0.0

        return Judgment(
            user_reaction=user_reaction,
            user_reaction_quote=user_reaction_quote,
            notes="; ".join(notes_parts[:3]),
            judgment_model=f"anthropic:{model}",
            score=normalized,
        )

    def detect_gap(self, prompt: str, available_skills: list[AvailableSkillCtx]) -> Gap | None:
        model = self.cfg.anthropic_model_gap
        raw = self._call(model, prompts.GAP_SYSTEM, prompts.gap_user_prompt(prompt, available_skills))
        data = self._parse_json(raw)
        if not isinstance(data, dict):
            return None
        sk = data.get("suggested_skill")
        if not sk:
            return None
        return Gap(
            suggested_skill=sk,
            reasoning=data.get("reasoning", "") or "",
            judgment_model=f"anthropic:{model}",
        )
