"""An alias with the SAME NAME as one in deps.py, marking a different provider.

handlers.py imports `CartDep` from deps, so check_other must stay unreached: the
alias is followed through the import, never matched by its name.
"""
from typing import Annotated

from fastapi import Depends


def check_other():
    return None


CartDep = Annotated[dict, Depends(check_other)]
