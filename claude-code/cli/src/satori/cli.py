import argparse
import json
import sys

def _cmd_ingest(args):
    from satori import ingest
    counts = ingest.run(platform=args.platform)
    print(json.dumps(counts, indent=2))

def _cmd_judge(args):
    from satori.judge import get_backend, orchestrator
    from satori import config
    cfg = config.load().judge
    backend_name = args.judge or cfg.backend
    backend = get_backend(backend_name)
    n_inv = orchestrator.judge_invocations(backend, reanalyze_skill=args.reanalyze)
    n_gap = 0
    if not args.skip_gaps:
        n_gap = orchestrator.detect_gaps(backend, sample_rate=cfg.gap_sample_rate)
    print(json.dumps({"invocations_judged": n_inv, "gaps_found": n_gap}, indent=2))

def _cmd_aggregate(args):
    from satori import aggregate
    counts = aggregate.run()
    print(json.dumps(counts, indent=2))

def _cmd_run(args):
    from satori import ingest, aggregate, config
    from satori.judge import get_backend, orchestrator
    cfg = config.load().judge
    backend = get_backend(args.judge or cfg.backend)
    a = ingest.run()
    n_inv = orchestrator.judge_invocations(backend)
    n_gap = 0 if args.skip_gaps else orchestrator.detect_gaps(backend, cfg.gap_sample_rate)
    c = aggregate.run()
    print(json.dumps({"ingest": a, "invocations_judged": n_inv, "gaps_found": n_gap, "aggregate": c}, indent=2))

def _cmd_report(args):
    from satori.report import generate, server
    if not args.overview and not args.skill:
        raise SystemExit("specify --overview or --skill X")
    paths = []
    if args.overview:
        paths.append(generate.overview())
    if args.skill:
        paths.append(generate.skill_detail(args.skill))
    base = "(http server disabled)"
    if not args.no_serve:
        base = server.ensure_running()
    print(json.dumps({
        "urls": [base.rstrip("/") + "/" + p.name for p in paths],
        "files": [str(p) for p in paths],
    }, indent=2))

def _cmd_improve(args):
    from satori import improve
    if args.mark:
        if not args.skill:
            raise SystemExit("--skill required with --mark")
        improve.mark_status(args.skill, args.mark)
        print(json.dumps({"skill": args.skill, "status": args.mark}, indent=2))
        return
    if not args.skill:
        raise SystemExit("--skill required (or use --mark)")
    try:
        path = improve.build_evidence_pack(args.skill)
        print(json.dumps({"skill": args.skill, "evidence_path": str(path)}, indent=2))
    except improve.InsufficientSampleError as e:
        raise SystemExit(str(e))

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="satori")
    sub = p.add_subparsers(dest="cmd", required=True)

    ing = sub.add_parser("ingest", help="Phase A: ingest new events into state.db")
    ing.add_argument("--platform", default="claude-code")
    ing.set_defaults(func=_cmd_ingest)

    jud = sub.add_parser("judge", help="Phase B: classify invocations and detect gaps")
    jud.add_argument("--judge", default=None, help="backend: anthropic|codex")
    jud.add_argument("--reanalyze", default=None, help="skill name or 'all'")
    jud.add_argument("--skip-gaps", action="store_true")
    jud.set_defaults(func=_cmd_judge)

    agg = sub.add_parser("aggregate", help="Phase C: recompute per-skill rollups")
    agg.set_defaults(func=_cmd_aggregate)

    rn = sub.add_parser("run", help="A -> B -> C in sequence")
    rn.add_argument("--judge", default=None)
    rn.add_argument("--skip-gaps", action="store_true")
    rn.set_defaults(func=_cmd_run)

    rpt = sub.add_parser("report", help="Phase E: render HTML reports")
    rpt.add_argument("--overview", action="store_true")
    rpt.add_argument("--skill", default=None)
    rpt.add_argument("--no-serve", action="store_true", help="skip starting http.server")
    rpt.set_defaults(func=_cmd_report)

    imp = sub.add_parser("improve", help="Phase D: build evidence pack for a skill")
    imp.add_argument("--skill", required=False)
    imp.add_argument("--mark", choices=["applied", "rejected"], default=None,
                     help="mark the most recent evidence row for --skill as applied or rejected")
    imp.set_defaults(func=_cmd_improve)

    return p

def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
    return 0
