import json
import os
from anthropic import Anthropic
from satori import config
from satori.judge.interface import InvocationContext, Judgment, Gap, AvailableSkillCtx
from satori.judge import prompts

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

    def _parse_json(self, raw: str) -> dict:
        try:
            return json.loads(raw.strip())
        except json.JSONDecodeError:
            pass
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end >= 0:
            return json.loads(raw[start : end + 1])
        raise ValueError(f"Could not parse JSON from response: {raw[:200]}")

    def classify_invocation(self, ctx: InvocationContext) -> Judgment:
        model = self.cfg.anthropic_model_classify
        raw = self._call(model, prompts.CLASSIFY_SYSTEM, prompts.classify_user_prompt(ctx))
        data = self._parse_json(raw)
        return Judgment(
            used_downstream=data.get("used_downstream"),
            user_reaction=data.get("user_reaction", "none"),
            user_reaction_quote=data.get("user_reaction_quote", "") or "",
            session_ended_cleanly=data.get("session_ended_cleanly"),
            notes=data.get("notes", "") or "",
            judgment_model=f"anthropic:{model}",
        )

    def detect_gap(self, prompt: str, available_skills: list[AvailableSkillCtx]) -> Gap | None:
        model = self.cfg.anthropic_model_gap
        raw = self._call(model, prompts.GAP_SYSTEM, prompts.gap_user_prompt(prompt, available_skills))
        data = self._parse_json(raw)
        sk = data.get("suggested_skill")
        if not sk:
            return None
        return Gap(
            suggested_skill=sk,
            reasoning=data.get("reasoning", "") or "",
            judgment_model=f"anthropic:{model}",
        )
