import tomllib
from dataclasses import dataclass, field
from satori.paths import config_file

@dataclass
class JudgeConfig:
    backend: str = "anthropic"
    anthropic_model_classify: str = "claude-haiku-4-5-20251001"
    anthropic_model_gap: str = "claude-sonnet-4-6"
    context_window_messages: int = 10
    gap_sample_rate: float = 1.0

@dataclass
class ImproveConfig:
    min_sample_size: int = 20
    horizon_days: int = 30

@dataclass
class Config:
    judge: JudgeConfig = field(default_factory=JudgeConfig)
    improve: ImproveConfig = field(default_factory=ImproveConfig)

def load() -> Config:
    cfg_path = config_file()
    if not cfg_path.exists():
        return Config()
    raw = tomllib.loads(cfg_path.read_text())
    judge_raw = raw.get("judge", {})
    improve_raw = raw.get("improve", {})
    return Config(
        judge=JudgeConfig(**judge_raw),
        improve=ImproveConfig(**improve_raw),
    )
