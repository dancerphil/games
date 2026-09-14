from .config import ELO_K
from .db import ensure_elo_models


def expected_score(rating, opponent_rating):
    return 1.0 / (1.0 + 10.0 ** ((opponent_rating - rating) / 400.0))


def apply_elo(con, black_model, white_model, winner):
    ensure_elo_models(con, black_model, white_model)
    if winner == "draw":
        black_score, white_score = 0.5, 0.5
        black_result, white_result = "draw", "draw"
    elif winner == "black":
        black_score, white_score = 1.0, 0.0
        black_result, white_result = "win", "loss"
    else:
        black_score, white_score = 0.0, 1.0
        black_result, white_result = "loss", "win"
    _move_elo(con, black_model, white_model, black_score, black_result)
    _move_elo(con, white_model, black_model, white_score, white_result)


def _move_elo(con, model, opponent, actual, result):
    rating = con.execute("SELECT rating FROM elo_ratings WHERE model = ?", (model,)).fetchone()[0]
    opponent_rating = con.execute(
        "SELECT rating FROM elo_ratings WHERE model = ?", (opponent,)
    ).fetchone()[0]
    new_rating = rating + ELO_K * (actual - expected_score(rating, opponent_rating))
    column = {"win": "wins", "loss": "losses", "draw": "draws"}[result]
    con.execute(
        f"UPDATE elo_ratings SET rating = ?, games = games + 1, {column} = {column} + 1, "
        "updated_at = datetime('now') WHERE model = ?",
        (new_rating, model),
    )
