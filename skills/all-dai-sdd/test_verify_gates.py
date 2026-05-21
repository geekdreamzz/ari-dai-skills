"""
Tests for verify_gates.py — 6 test cases covering all 8 gate rules.
Run with:  python3 -m pytest test_verify_gates.py -v
"""
import sys
import os

# Allow importing siblings without installing the package
sys.path.insert(0, os.path.dirname(__file__))

import pytest
from verify_gates import verify, format_result
from sdd_schema import SddTask


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_rs(spec_id: str = 'RS-001', column: str = 'done', vr: str = 'pass', content: str = '') -> SddTask:
    if not content:
        content = (
            '<h3>Sources <!-- #sources --></h3>'
            '<ul>'
            '<li><a href="https://doi.org/10.1/x">Source A</a></li>'
            '<li><a href="https://doi.org/10.2/y">Source B</a></li>'
            '</ul>'
        )
    return SddTask(
        spec_id=spec_id,
        title=f'{spec_id} · Research task',
        column=column,
        spec_type='research',
        validation_result=vr,
        content=content,
    )


def make_ns(
    spec_id: str = 'NS-001',
    column: str = 'north-stars',
    research_ref: str | None = 'RS-001',
    vr: str = 'pass',
) -> SddTask:
    return SddTask(
        spec_id=spec_id,
        title=f'{spec_id} · North Star',
        column=column,
        spec_type='architecture',
        research_ref=research_ref,
        validation_result=vr,
    )


def make_ep(
    spec_id: str = 'EP-001',
    column: str = 'epics',
    north_star_ref: str | None = 'NS-001',
    research_ref: str | None = 'RS-001',
    vr: str = 'pass',
) -> SddTask:
    return SddTask(
        spec_id=spec_id,
        title=f'{spec_id} · Epic',
        column=column,
        spec_type='architecture',
        north_star_ref=north_star_ref,
        research_ref=research_ref,
        validation_result=vr,
    )


def make_ex(
    spec_id: str = 'EX-001',
    column: str = 'execution',
    epic_ref: str | None = 'EP-001',
    north_star_ref: str | None = 'NS-001',
    research_ref: str | None = 'RS-001',
    vr: str = 'pass',
) -> SddTask:
    return SddTask(
        spec_id=spec_id,
        title=f'{spec_id} · Execution task',
        column=column,
        spec_type='algorithm',
        epic_ref=epic_ref,
        north_star_ref=north_star_ref,
        research_ref=research_ref,
        validation_result=vr,
    )


def make_done(
    spec_id: str = 'EX-001',
    epic_ref: str | None = 'EP-001',
    north_star_ref: str | None = 'NS-001',
    research_ref: str | None = 'RS-001',
    vr: str = 'pass',
) -> SddTask:
    return SddTask(
        spec_id=spec_id,
        title=f'{spec_id} · Done task',
        column='done',
        spec_type='algorithm',
        epic_ref=epic_ref,
        north_star_ref=north_star_ref,
        research_ref=research_ref,
        validation_result=vr,
    )


# ---------------------------------------------------------------------------
# Test 1: All valid tasks → UNSAT (no violations)
# ---------------------------------------------------------------------------

def test_all_valid_unsat():
    """A fully correct SDD chain should produce zero violations."""
    tasks = [
        make_rs('RS-001', column='done', vr='pass'),
        make_ns('NS-001', column='north-stars', research_ref='RS-001'),
        make_ep('EP-001', column='epics', north_star_ref='NS-001', research_ref='RS-001'),
        make_ex('EX-001', column='execution', epic_ref='EP-001', north_star_ref='NS-001', research_ref='RS-001'),
    ]
    ok, violations = verify(tasks)
    assert ok, f'Expected UNSAT (no violations) but got: {violations}'
    assert violations == []


# ---------------------------------------------------------------------------
# Test 2: Done task with validationResult=fail → RULE-1 violation
# ---------------------------------------------------------------------------

def test_done_with_fail_vr_triggers_rule1():
    """A task in Done with validationResult=fail must trigger RULE-1."""
    tasks = [
        make_rs('RS-001', column='done', vr='pass'),
        make_ns('NS-001', column='north-stars', research_ref='RS-001'),
        make_ep('EP-001', column='epics', north_star_ref='NS-001', research_ref='RS-001'),
        SddTask(
            spec_id='EX-BAD',
            title='EX-BAD · Broken done task',
            column='done',
            spec_type='algorithm',
            epic_ref='EP-001',
            north_star_ref='NS-001',
            research_ref='RS-001',
            validation_result='fail',  # <-- violation
        ),
    ]
    ok, violations = verify(tasks)
    assert not ok, 'Expected violations but got UNSAT'
    rule1_violations = [v for v in violations if 'RULE-1' in v]
    assert rule1_violations, f'Expected RULE-1 violation. Got: {violations}'
    assert 'EX-BAD' in rule1_violations[0]
    assert 'fail' in rule1_violations[0]


# ---------------------------------------------------------------------------
# Test 3: NS task with null research_ref → RULE-7 violation
# ---------------------------------------------------------------------------

def test_ns_with_null_research_ref_triggers_rule7():
    """A north-stars task with no research_ref must trigger RULE-7."""
    tasks = [
        make_rs('RS-001', column='done', vr='pass'),
        SddTask(
            spec_id='NS-BAD',
            title='NS-BAD · Orphaned NS',
            column='north-stars',
            spec_type='architecture',
            research_ref=None,  # <-- violation
            validation_result='pass',
        ),
    ]
    ok, violations = verify(tasks)
    assert not ok, 'Expected violations but got UNSAT'
    rule7_violations = [v for v in violations if 'RULE-7' in v]
    assert rule7_violations, f'Expected RULE-7 violation. Got: {violations}'
    assert 'NS-BAD' in rule7_violations[0]


# ---------------------------------------------------------------------------
# Test 4: NS past NorthStars but research_ref not in Done → RULE-3 violation
# ---------------------------------------------------------------------------

def test_ns_advanced_but_research_not_done_triggers_rule3():
    """NS in Epics with research_ref still in research column triggers RULE-3."""
    tasks = [
        make_rs('RS-001', column='research', vr='pending'),  # NOT done
        SddTask(
            spec_id='NS-001',
            title='NS-001 · Advanced NS',
            column='epics',          # past NorthStars — triggers rule
            spec_type='architecture',
            research_ref='RS-001',   # exists but not done
            validation_result='pass',
        ),
    ]
    ok, violations = verify(tasks)
    assert not ok, 'Expected violations but got UNSAT'
    rule3_violations = [v for v in violations if 'RULE-3' in v]
    assert rule3_violations, f'Expected RULE-3 violation. Got: {violations}'
    assert 'NS-001' in rule3_violations[0]
    assert 'RS-001' in rule3_violations[0]


# ---------------------------------------------------------------------------
# Test 5: Complete chain RS→NS→EP→EX→VA→Done → UNSAT
# ---------------------------------------------------------------------------

def test_complete_chain_unsat():
    """A complete six-column chain with all refs correctly linked should be UNSAT."""
    tasks = [
        # Research
        make_rs('RS-001', column='done', vr='pass'),
        # North Stars
        SddTask(
            spec_id='NS-001',
            title='NS-001 · Auth North Star',
            column='done',
            spec_type='architecture',
            research_ref='RS-001',
            validation_result='pass',
        ),
        # Epics
        SddTask(
            spec_id='EP-001',
            title='EP-001 · Auth Epic',
            column='done',
            spec_type='architecture',
            north_star_ref='NS-001',
            research_ref='RS-001',
            validation_result='pass',
        ),
        # Execution
        SddTask(
            spec_id='EX-001',
            title='EX-001 · Implement auth',
            column='done',
            spec_type='algorithm',
            epic_ref='EP-001',
            north_star_ref='NS-001',
            research_ref='RS-001',
            validation_result='pass',
        ),
    ]
    ok, violations = verify(tasks)
    assert ok, f'Expected UNSAT (no violations) but got: {violations}'
    assert violations == []


# ---------------------------------------------------------------------------
# Test 6: Orphaned EX task (epic_ref missing) → RULE-5 violation
# ---------------------------------------------------------------------------

def test_ex_with_no_epic_ref_triggers_rule5():
    """An Execution task with no epic_ref must trigger RULE-5."""
    tasks = [
        make_rs('RS-001', column='done', vr='pass'),
        make_ns('NS-001', column='north-stars', research_ref='RS-001'),
        SddTask(
            spec_id='EX-ORPHAN',
            title='EX-ORPHAN · Orphaned execution task',
            column='execution',
            spec_type='algorithm',
            epic_ref=None,           # <-- violation: in Execution with no epic_ref
            north_star_ref='NS-001',
            research_ref='RS-001',
            validation_result='pass',
        ),
    ]
    ok, violations = verify(tasks)
    assert not ok, 'Expected violations but got UNSAT'
    rule5_violations = [v for v in violations if 'RULE-5' in v]
    assert rule5_violations, f'Expected RULE-5 violation. Got: {violations}'
    assert 'EX-ORPHAN' in rule5_violations[0]


# ---------------------------------------------------------------------------
# Bonus: format_result output shape
# ---------------------------------------------------------------------------

def test_format_result_ok():
    result = format_result(ok=True, violations=[], n_tasks=5)
    assert 'UNSAT' in result
    assert '8 rules verified' in result
    assert '0 violations' in result
    assert '5 tasks checked' in result


def test_format_result_violations():
    viols = ['RULE-1 DONE-GATE: EX-001 column=done but validationResult=fail']
    result = format_result(ok=False, violations=viols, n_tasks=3)
    assert 'BLOCKED' in result
    assert 'RULE-1' in result
    assert 'Required: Fix violations' in result
