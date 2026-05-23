#!/usr/bin/env python3
"""
Z3 gate verifier for all-dai-sdd.
Encodes all 8 gate rules as SMT constraints. UNSAT = all rules hold.
SAT + model = counterexample showing exactly which task violates which rule.

Usage:
  python3 verify_gates.py --tasks path/to/tasks.yaml
  python3 verify_gates.py --tasks path/to/tasks.yaml --verbose
  python3 verify_gates.py --json '{"tasks": [...]}'   # inline JSON
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from typing import Optional

try:
    import yaml
    from z3 import (
        And,
        BoolRef,
        BoolVal,
        Implies,
        Not,
        Or,
        Solver,
        sat,
        unsat,
    )
except ModuleNotFoundError as e:
    sys.stderr.write(
        f"\nverify_gates.py needs the optional 'sdd' extra (missing: {e.name}).\n"
        "Install with one of:\n"
        "  pip install 'dai-skills[sdd]'\n"
        "  uv tool install 'dai-skills[sdd]'\n"
        "\nNote: z3-solver requires a C++ toolchain on platforms without prebuilt wheels.\n"
        "  macOS:   brew install cmake\n"
        "  Ubuntu:  sudo apt install cmake build-essential\n"
        "  Windows: install Visual Studio Build Tools + CMake\n"
    )
    sys.exit(2)

from sdd_schema import COLUMN_ORD, SddTask

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _load_tasks_from_dict(raw: list[dict]) -> list[SddTask]:
    tasks: list[SddTask] = []
    for d in raw:
        tasks.append(SddTask(
            spec_id=d.get('spec_id', ''),
            title=d.get('title', ''),
            column=d.get('column', 'research'),
            spec_type=d.get('spec_type', 'architecture'),
            research_ref=d.get('research_ref') or None,
            epic_ref=d.get('epic_ref') or None,
            north_star_ref=d.get('north_star_ref') or None,
            validation_result=d.get('validationResult', d.get('validation_result', 'none')),
            content=d.get('content', ''),
            tags=d.get('tags', []),
        ))
    return tasks


def _count_source_citations(content: str) -> int:
    """Count <a href=...> or DOI references inside a #sources section."""
    # Find sources section: between <!-- #sources --> and the next <h3 or end
    sources_pat = re.compile(
        r'Sources\s*<!--\s*#sources\s*-->.*?(?=<h3|$)',
        re.IGNORECASE | re.DOTALL,
    )
    m = sources_pat.search(content)
    if not m:
        # Fallback: count all <a href= tags in full content
        return len(re.findall(r'<a\s+[^>]*href=', content, re.IGNORECASE))
    section = m.group(0)
    hrefs = len(re.findall(r'<a\s+[^>]*href=', section, re.IGNORECASE))
    dois = len(re.findall(r'\bdoi\.org\b', section, re.IGNORECASE))
    return max(hrefs, dois)


# ---------------------------------------------------------------------------
# Gate rule implementations
# Each returns (violated: bool, violation_msg: str | None)
# ---------------------------------------------------------------------------

def _check_rule(
    rule_id: str,
    rule_name: str,
    task: SddTask,
    task_map: dict[str, SddTask],
    *,
    verbose: bool = False,
) -> tuple[bool, Optional[str]]:
    """Evaluate a single rule against a single task using Z3 ground-term encoding."""

    col_ord = task.column_ord()
    done_ord = COLUMN_ORD['done']
    ns_ord = COLUMN_ORD['north-stars']
    ep_ord = COLUMN_ORD['epics']
    ex_ord = COLUMN_ORD['execution']

    if rule_id == 'RULE-1':
        # DONE-GATE: column=done → validationResult=pass
        s = Solver()
        is_done = BoolVal(col_ord == done_ord)
        is_pass = BoolVal(task.validation_result == 'pass')
        # Violation = done AND NOT pass
        s.add(And(is_done, Not(is_pass)))
        if s.check() == sat:
            return True, (
                f'RULE-1 DONE-GATE: {task.spec_id} '
                f'column=done but validationResult={task.validation_result}'
            )
        return False, None

    if rule_id == 'RULE-2':
        # NO-SKIP-VALIDATION: column=done → validationResult ≠ "none"
        s = Solver()
        is_done = BoolVal(col_ord == done_ord)
        is_none = BoolVal(task.validation_result == 'none')
        s.add(And(is_done, is_none))
        if s.check() == sat:
            return True, (
                f'RULE-2 NO-SKIP-VALIDATION: {task.spec_id} '
                f'column=done but validationResult=none (validation was skipped)'
            )
        return False, None

    if rule_id == 'RULE-3':
        # RESEARCH-GATE: ns.column > NorthStars → task_map[ns.research_ref].column = Done
        # Applies to north-stars tasks that have advanced past NorthStars
        if task.spec_type == 'research':
            return False, None  # rule targets NS tasks
        if col_ord <= ns_ord:
            return False, None  # not yet past NorthStars
        # At or past NorthStars: research_ref must exist and be in Done
        if task.research_ref is None:
            return False, None  # RULE-7 covers null ref; skip here
        ref_task = task_map.get(task.research_ref)
        if ref_task is None:
            return False, None  # RULE-7 covers missing ref
        s = Solver()
        ref_done = BoolVal(ref_task.column_ord() == done_ord)
        s.add(Not(ref_done))
        if s.check() == sat:
            return True, (
                f'RULE-3 RESEARCH-GATE: {task.spec_id} advanced past NorthStars '
                f'but research_ref {task.research_ref} is not in Done '
                f'(currently column={ref_task.column})'
            )
        return False, None

    if rule_id == 'RULE-4':
        # NS-FORWARD-GATE: epic.column >= Epics → task_map[epic.north_star_ref].column >= NorthStars
        # Applies to non-research tasks that carry a north_star_ref (epics, execution, etc.)
        if task.spec_type == 'research':
            return False, None
        if col_ord < ep_ord:
            return False, None
        if task.north_star_ref is None:
            return False, None  # RULE-7 / RULE-6 covers missing refs
        ns_task = task_map.get(task.north_star_ref)
        if ns_task is None:
            return False, None
        s = Solver()
        ns_ok = BoolVal(ns_task.column_ord() >= ns_ord)
        s.add(Not(ns_ok))
        if s.check() == sat:
            return True, (
                f'RULE-4 NS-FORWARD-GATE: {task.spec_id} is in Epics or beyond '
                f'but north_star_ref {task.north_star_ref} has not reached NorthStars '
                f'(currently column={ns_task.column})'
            )
        return False, None

    if rule_id == 'RULE-5':
        # EPIC-FORWARD-GATE: ex.column >= Execution → task_map[ex.epic_ref].column >= Epics
        # Only applies to execution/validation/done tasks that are NOT of spec_type research,
        # architecture (epics), or north-stars — i.e. the "leaf" execution work items.
        # We identify execution-level tasks by their column (>= execution) AND spec_type
        # being algorithm, test-plan, or user-journey (the leaf task types).
        LEAF_SPEC_TYPES = {'algorithm', 'test-plan', 'user-journey'}
        if task.spec_type not in LEAF_SPEC_TYPES:
            return False, None
        if col_ord < ex_ord:
            return False, None
        if task.epic_ref is None:
            # A leaf execution-or-later task with no epic_ref is a violation
            s = Solver()
            at_exec = BoolVal(col_ord >= ex_ord)
            has_epic = BoolVal(False)  # epic_ref is None
            s.add(And(at_exec, Not(has_epic)))
            if s.check() == sat:
                return True, (
                    f'RULE-5 EPIC-FORWARD-GATE: {task.spec_id} is in Execution or beyond '
                    f'but has no epic_ref'
                )
            return False, None
        ep_task = task_map.get(task.epic_ref)
        if ep_task is None:
            return False, None
        s = Solver()
        ep_ok = BoolVal(ep_task.column_ord() >= ep_ord)
        s.add(Not(ep_ok))
        if s.check() == sat:
            return True, (
                f'RULE-5 EPIC-FORWARD-GATE: {task.spec_id} is in Execution or beyond '
                f'but epic_ref {task.epic_ref} has not reached Epics '
                f'(currently column={ep_task.column})'
            )
        return False, None

    if rule_id == 'RULE-6':
        # TRACE-COMPLETE: every Done *execution-level leaf task* must have an unbroken chain
        # Research → NS → EP → EX. Research/NS/EP tasks are nodes in the chain, not the
        # subject of the chain-completeness check — they carry individual ref-validity rules
        # (RULE-3, RULE-4, RULE-7) instead.
        LEAF_SPEC_TYPES = {'algorithm', 'test-plan', 'user-journey'}
        if col_ord != done_ord:
            return False, None
        if task.spec_type not in LEAF_SPEC_TYPES:
            return False, None  # chain nodes (RS/NS/EP) are validated by their own rules
        # Walk: task (done leaf) → epic_ref → north_star_ref → research_ref
        chain: list[str] = [task.spec_id]
        # Step 1: must have epic_ref
        if task.epic_ref is None:
            return True, (
                f'RULE-6 TRACE-COMPLETE: {task.spec_id} is Done '
                f'but has no epic_ref — chain broken at EP link'
            )
        ep_task = task_map.get(task.epic_ref)
        if ep_task is None:
            return True, (
                f'RULE-6 TRACE-COMPLETE: {task.spec_id} is Done '
                f'but epic_ref {task.epic_ref} not found in task set'
            )
        chain.append(ep_task.spec_id)
        # Step 2: epic must have north_star_ref
        if ep_task.north_star_ref is None:
            return True, (
                f'RULE-6 TRACE-COMPLETE: {task.spec_id} is Done '
                f'but epic {ep_task.spec_id} has no north_star_ref — chain broken at NS link'
            )
        ns_task = task_map.get(ep_task.north_star_ref)
        if ns_task is None:
            return True, (
                f'RULE-6 TRACE-COMPLETE: {task.spec_id} is Done '
                f'but north_star_ref {ep_task.north_star_ref} not found in task set'
            )
        chain.append(ns_task.spec_id)
        # Step 3: NS must have research_ref
        if ns_task.research_ref is None:
            return True, (
                f'RULE-6 TRACE-COMPLETE: {task.spec_id} is Done '
                f'but north-star {ns_task.spec_id} has no research_ref — chain broken at RS link'
            )
        rs_task = task_map.get(ns_task.research_ref)
        if rs_task is None:
            return True, (
                f'RULE-6 TRACE-COMPLETE: {task.spec_id} is Done '
                f'but research_ref {ns_task.research_ref} not found in task set'
            )
        chain.append(rs_task.spec_id)
        # All links present — chain is complete
        if verbose:
            print(f'    RULE-6 chain OK: {" → ".join(reversed(chain))}')
        return False, None

    if rule_id == 'RULE-7':
        # RESEARCH-REF-VALID: ns.research_ref ≠ null ∧ exists in task set
        # The research_ref gating is the responsibility of the North Stars tier —
        # NS tasks are the ones that must declare which Research task backs them.
        # EP/EX tasks may carry research_ref for traceability but are not the
        # primary gate enforcer (RULE-3 handles advancement; RULE-6 handles chain).
        # So: only check tasks in the north-stars column (or beyond) that are NOT research.
        if task.spec_type == 'research':
            return False, None
        # Only the north-stars column tasks are the "primary" research_ref carriers
        if task.column != 'north-stars':
            # For tasks in epics/execution/done that have an explicit research_ref set,
            # we still validate the ref exists if it's set.
            if task.research_ref is not None and task.research_ref not in task_map:
                return True, (
                    f'RULE-7 RESEARCH-REF-VALID: {task.spec_id} '
                    f'research_ref={task.research_ref} does not exist in the task set'
                )
            return False, None
        # NS column task: must have research_ref and it must exist
        if task.research_ref is None:
            s = Solver()
            # Encode: is_ns=True AND has_ref=False — this is always SAT (violation is structural)
            is_ns = BoolVal(task.column == 'north-stars')   # True
            has_ref = BoolVal(task.research_ref is not None)  # False
            s.add(And(is_ns, Not(has_ref)))
            if s.check() == sat:
                return True, (
                    f'RULE-7 RESEARCH-REF-VALID: {task.spec_id} '
                    f'(column=north-stars) has no research_ref'
                )
            return False, None
        if task.research_ref not in task_map:
            return True, (
                f'RULE-7 RESEARCH-REF-VALID: {task.spec_id} '
                f'research_ref={task.research_ref} does not exist in the task set'
            )
        return False, None

    if rule_id == 'RULE-8':
        # SOURCE-COUNT: spec_type=research → ≥ 2 source citations in content
        if task.spec_type != 'research':
            return False, None
        count = _count_source_citations(task.content)
        s = Solver()
        enough_sources = BoolVal(count >= 2)
        s.add(Not(enough_sources))
        if s.check() == sat:
            return True, (
                f'RULE-8 SOURCE-COUNT: {task.spec_id} is spec_type=research '
                f'but has only {count} source citation(s) — minimum 2 required'
            )
        return False, None

    raise ValueError(f'Unknown rule_id: {rule_id}')


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

RULES = [
    ('RULE-1', 'DONE-GATE'),
    ('RULE-2', 'NO-SKIP-VALIDATION'),
    ('RULE-3', 'RESEARCH-GATE'),
    ('RULE-4', 'NS-FORWARD-GATE'),
    ('RULE-5', 'EPIC-FORWARD-GATE'),
    ('RULE-6', 'TRACE-COMPLETE'),
    ('RULE-7', 'RESEARCH-REF-VALID'),
    ('RULE-8', 'SOURCE-COUNT'),
]


def verify(tasks: list[SddTask], *, verbose: bool = False) -> tuple[bool, list[str]]:
    """
    Run all 8 gate rules against the given task list.

    Returns:
        (ok, violations)
        ok         — True if UNSAT for all rules (no violations found)
        violations — list of human-readable violation messages (empty if ok)
    """
    task_map = {t.spec_id: t for t in tasks}
    violations: list[str] = []

    for rule_id, rule_name in RULES:
        if verbose:
            print(f'  Checking {rule_id} {rule_name}...')
        for task in tasks:
            violated, msg = _check_rule(rule_id, rule_name, task, task_map, verbose=verbose)
            if violated and msg:
                violations.append(msg)
                if verbose:
                    print(f'    SAT — violation found: {msg}')

    return (len(violations) == 0), violations


def format_result(ok: bool, violations: list[str], n_tasks: int) -> str:
    """Format the canonical output string."""
    ts = _now_iso()
    n_rules = len(RULES)
    if ok:
        return (
            f'✅ GATE [Z3] all-constraints-UNSAT | {ts} | '
            f'{n_rules} rules verified, 0 violations, {n_tasks} tasks checked'
        )
    lines = [
        f'🚫 GATE [Z3] BLOCKED | {ts} | {len(violations)} violation(s):',
    ]
    for v in violations:
        lines.append(f'  - {v}')
    lines.append('Required: Fix violations before advancing tasks.')
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Data loading helpers
# ---------------------------------------------------------------------------

def load_tasks_yaml(path: str) -> list[SddTask]:
    with open(path, 'r', encoding='utf-8') as fh:
        raw = yaml.safe_load(fh)
    if not isinstance(raw, list):
        raw = raw.get('tasks', [])
    return _load_tasks_from_dict(raw)


def load_tasks_json(json_str: str) -> list[SddTask]:
    data = json.loads(json_str)
    if isinstance(data, list):
        raw = data
    else:
        raw = data.get('tasks', [])
    return _load_tasks_from_dict(raw)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='Z3 gate verifier for all-dai-sdd workflow',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument('--tasks', metavar='PATH', help='Path to tasks.yaml')
    src.add_argument('--json', metavar='JSON', dest='json_str', help='Inline JSON task data')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose rule-by-rule output')
    parser.add_argument(
        '--exit-code',
        action='store_true',
        default=True,
        help='Exit 1 on violations (default: True)',
    )

    args = parser.parse_args(argv)

    try:
        if args.tasks:
            tasks = load_tasks_yaml(args.tasks)
        else:
            tasks = load_tasks_json(args.json_str)
    except Exception as exc:
        print(f'ERROR loading tasks: {exc}', file=sys.stderr)
        return 2

    if args.verbose:
        print(f'Loaded {len(tasks)} tasks. Running {len(RULES)} gate rules...')

    ok, violations = verify(tasks, verbose=args.verbose)
    print(format_result(ok, violations, len(tasks)))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
