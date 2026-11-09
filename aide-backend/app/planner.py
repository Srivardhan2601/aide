"""Exam study planner: turn exam dates + topics into a day-by-day revision plan.

How it schedules:
- The day before each exam gets a "Full revision" session for that subject.
- Every other day, study time is filled topic by topic, always picking the subject whose
  remaining work is most at risk (remaining minutes ÷ days left before its exam), so a
  near exam gets priority without starving later ones.
- Done topics are never rescheduled. Missed ones (past days, not ticked) are moved
  forward automatically on the next replan.
- If something can't fit before its exam, it says so instead of silently dropping it.
"""
from __future__ import annotations

from datetime import date, timedelta

REVISION = "Full revision"
REVISION_MINUTES = 90
MIN_BLOCK = 30  # don't start a topic in less than this much time


def default_topics(name: str, n: int = 4) -> list[str]:
    return [f"{name}: part {i}" for i in range(1, n + 1)]


def build_plan(subjects: list[dict], today: date, daily_minutes: int,
               done: set[tuple[int, str, str]]) -> tuple[list[dict], list[str]]:
    """subjects: [{id, name, exam_date: date, topics: [..], minutes_per_topic}]
    done: {(subject_id, topic, kind)} already completed.
    Returns (sessions, warnings). Sessions: {subject_id, subject, topic, kind, day: date, minutes}."""
    active = [s for s in subjects if s["exam_date"] > today]
    remaining = {s["id"]: [t for t in (s["topics"] or default_topics(s["name"])) if (s["id"], t, "study") not in done]
                 for s in active}
    sessions: list[dict] = []
    if not active:
        return sessions, []
    last = max(s["exam_date"] for s in active)

    day = today
    while day < last:
        cap = daily_minutes
        # 1. The day before an exam: full revision first.
        for s in sorted(active, key=lambda s: s["exam_date"]):
            if s["exam_date"] - timedelta(days=1) == day and (s["id"], REVISION, "revision") not in done:
                m = REVISION_MINUTES
                sessions.append({"subject_id": s["id"], "subject": s["name"], "topic": REVISION,
                                 "kind": "revision", "day": day, "minutes": m})
                cap -= m
        # 2. Fill the rest of the day with topics, most at-risk subject first. Each subject is
        #    paced evenly over the days it has left (no cramming everything into day one).
        last_pick = None
        quota = {}
        for s in active:
            study_days = max((s["exam_date"] - day).days - 1, 1)  # the day before is for revision
            quota[s["id"]] = -(-len(remaining[s["id"]]) // study_days)  # ceil
        while cap >= MIN_BLOCK:
            cands = [s for s in active if remaining[s["id"]] and s["exam_date"] > day and quota[s["id"]] > 0]
            if not cands:
                break

            def risk(s):
                days_left = max((s["exam_date"] - day).days - 1, 0) + 0.5  # the day before is for revision
                load = len(remaining[s["id"]]) * s["minutes_per_topic"] / days_left
                return (load, s["id"] != last_pick, -s["exam_date"].toordinal())  # vary subjects on ties

            s = max(cands, key=risk)
            m = min(s["minutes_per_topic"], cap)
            if m < min(MIN_BLOCK, s["minutes_per_topic"]):
                break
            sessions.append({"subject_id": s["id"], "subject": s["name"], "topic": remaining[s["id"]].pop(0),
                             "kind": "study", "day": day, "minutes": m})
            cap -= m
            quota[s["id"]] -= 1
            last_pick = s["id"]
        day += timedelta(days=1)

    warnings = []
    for s in active:
        left = remaining[s["id"]]
        if left:
            warnings.append(f"{len(left)} {s['name']} topic{'s' if len(left) != 1 else ''} don't fit before the exam "
                            f"({', '.join(left[:3])}{'…' if len(left) > 3 else ''}). Add study time per day, or trim topics.")
    for s in subjects:
        if s["exam_date"] == today:
            warnings.append(f"{s['name']} exam is today. Good luck!")
    return sessions, warnings
