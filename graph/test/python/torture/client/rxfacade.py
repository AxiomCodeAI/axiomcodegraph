"""Three re-export shapes, all of them module members bound by ASSIGNMENT."""
from rxaccel import boost
from rxlib import fallback, slow

# 1. one assignment — the plainest re-export, and it did not resolve either
alias = slow

# 2. the optional-dependency idiom: one name, two origins, both reachable
try:
    from rxaccel import boost as chosen
except ImportError:  # pragma: no cover - rxaccel is present in this fixture
    chosen = fallback

# 3. two assignments to one name
picked = boost
picked = fallback
