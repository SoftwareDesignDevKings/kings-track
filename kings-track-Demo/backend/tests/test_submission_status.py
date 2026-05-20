from app.api.routes.courses import _submission_status


def test_excused_takes_priority():
    assert _submission_status("unsubmitted", None, True) == "excused"
    assert _submission_status("graded", 100, True) == "excused"


def test_graded_returns_completed():
    assert _submission_status("graded", 85.0, False) == "completed"
    assert _submission_status("graded", None, False) == "completed"


def test_submitted_returns_in_progress():
    assert _submission_status("submitted", None, False) == "in_progress"


def test_pending_review_returns_in_progress():
    assert _submission_status("pending_review", None, False) == "in_progress"


def test_unsubmitted_returns_not_started():
    assert _submission_status("unsubmitted", None, False) == "not_started"


def test_none_state_returns_not_started():
    assert _submission_status(None, None, False) == "not_started"
    assert _submission_status(None, None, None) == "not_started"
