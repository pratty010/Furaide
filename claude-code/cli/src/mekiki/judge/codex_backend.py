import json
import subprocess
from mekiki.judge.interface import InvocationContext, Judgment, Gap, AvailableSkillCtx
from mekiki.judge import prompts

CODEX_BIN = "codex"

class CodexBackend:
    def _call(self, system: str, user: str) -> str:
        full = f"{system}\n\n{user}"
        r = subprocess.run(
            [CODEX_BIN, "exec", "--full-auto", "-"],
            input=full, capture_output=True, text=True, timeout=120,
        )
        if r.returncode != 0:
            raise RuntimeError(f"codex failed: {r.stderr[:400]}")
        return r.stdout.strip()

    def _parse_json(self, raw: str) -> dict:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end < 0:
            raise ValueError(f"no JSON in codex response: {raw[:200]}")
        return json.loads(raw[start : end + 1])

    def classify_invocation(self, ctx: InvocationContext) -> Judgment:
        raw = self._call(prompts.CLASSIFY_SYSTEM, prompts.classify_user_prompt(ctx))
        data = self._parse_json(raw)
        return Judgment(
            used_downstream=data.get("used_downstream"),
            user_reaction=data.get("user_reaction", "none"),
            user_reaction_quote=data.get("user_reaction_quote", "") or "",
            session_ended_cleanly=data.get("session_ended_cleanly"),
            notes=data.get("notes", "") or "",
            judgment_model="codex",
        )

    def detect_gap(self, prompt: str, available_skills: list[AvailableSkillCtx]) -> Gap | None:
        raw = self._call(prompts.GAP_SYSTEM, prompts.gap_user_prompt(prompt, available_skills))
        data = self._parse_json(raw)
        sk = data.get("suggested_skill")
        if not sk:
            return None
        return Gap(
            suggested_skill=sk,
            reasoning=data.get("reasoning", "") or "",
            judgment_model="codex",
        )
