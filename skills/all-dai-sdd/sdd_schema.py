"""
SDD task schema — dataclass definitions for all-dai-sdd gate verifier.
Pydantic-free: uses only stdlib dataclasses.
"""
from dataclasses import dataclass, field
from typing import Optional

COLUMN_ORD: dict[str, int] = {
    'research': 0,
    'north-stars': 1,
    'epics': 2,
    'execution': 3,
    'validation': 4,
    'done': 5,
}

VALID_COLUMNS = set(COLUMN_ORD.keys())
VALID_SPEC_TYPES = {'research', 'architecture', 'user-journey', 'algorithm', 'test-plan'}
VALID_VALIDATION_RESULTS = {'pass', 'fail', 'pending', 'none'}


@dataclass
class SddTask:
    spec_id: str
    title: str
    column: str
    spec_type: str
    research_ref: Optional[str] = None
    epic_ref: Optional[str] = None
    north_star_ref: Optional[str] = None
    validation_result: str = 'none'   # pass | fail | pending | none
    content: str = ''
    tags: list = field(default_factory=list)

    def column_ord(self) -> int:
        return COLUMN_ORD.get(self.column, 0)

    def is_done(self) -> bool:
        return self.column == 'done'

    def is_research(self) -> bool:
        return self.spec_type == 'research'
