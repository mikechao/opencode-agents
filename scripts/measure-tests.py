#!/usr/bin/env python3
"""Measure uninstrumented Bun tests, including descendant CPU time (Unix only)."""

import argparse
import json
from pathlib import Path
import re
import resource
import statistics
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--per-file", action="store_true")
    parser.add_argument("--budget", type=float, help="Maximum suite median wall seconds")
    parser.add_argument("--expected-tests", type=int, help="Optional exact suite test count")
    parser.add_argument("--minimum-assertions", type=int, help="Optional minimum suite assertion count")
    parser.add_argument("--output", type=Path, help="Save samples and complete runner output as JSON")
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be positive")
    root = Path(__file__).resolve().parent.parent
    targets = ([str(p.relative_to(root)) for p in sorted((root / "test").glob("*.test.ts"))]
               if args.per_file else []) + ["suite"]
    samples = []
    failed = False
    for repetition in range(1, args.runs + 1):
        for target in targets:
            before = resource.getrusage(resource.RUSAGE_CHILDREN)
            start = time.perf_counter()
            result = subprocess.run(
                ["bun", "test", *([] if target == "suite" else [target])],
                cwd=root, capture_output=True, text=True,
            )
            elapsed = time.perf_counter() - start
            after = resource.getrusage(resource.RUSAGE_CHILDREN)
            log = result.stdout + result.stderr
            count = re.search(r"Ran (\d+) tests? across", log)
            tests = int(count.group(1)) if count else None
            count = re.search(r"(\d+) expect\(\) calls", log)
            assertions = int(count.group(1)) if count else None
            sample = dict(run=repetition, target=target, wall=elapsed,
                          user=after.ru_utime - before.ru_utime,
                          system=after.ru_stime - before.ru_stime,
                          tests=tests, assertions=assertions, exit_code=result.returncode, log=log)
            samples.append(sample)
            count_mismatch = target == "suite" and (
                tests is None or assertions is None or
                (args.expected_tests is not None and tests != args.expected_tests) or
                (args.minimum_assertions is not None and assertions < args.minimum_assertions)
            )
            failed |= result.returncode != 0 or count_mismatch
            print(f"run {repetition}: {target}: wall={elapsed:.3f}s "
                  f"user={sample['user']:.3f}s system={sample['system']:.3f}s "
                  f"tests={tests} assertions={assertions} exit={result.returncode}", flush=True)
            if count_mismatch:
                print(f"Suite count check failed: expected-tests={args.expected_tests}, "
                      f"minimum-assertions={args.minimum_assertions}")
            if result.returncode:
                print(log)
    medians = {}
    for target in targets:
        rows = [s for s in samples if s["target"] == target]
        medians[target] = {metric: statistics.median(s[metric] for s in rows)
                           for metric in ("wall", "user", "system")}
    print(json.dumps({"medians": medians}, indent=2))
    if args.output:
        args.output.write_text(json.dumps({"samples": samples, "medians": medians}, indent=2) + "\n")
    if args.budget is not None and medians["suite"]["wall"] > args.budget:
        print(f"Suite median exceeds {args.budget:.3f}s budget")
        failed = True
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
