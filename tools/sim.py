#!/usr/bin/env python3
"""
Python mirror of the Level 1 rule engine (game.js) used for balance testing.

The JS engine is authoritative; this file keeps the same numbers so policies can
be simulated thousands of times. If you change RULES / LEVELS in game.js,
change them here too (the test prints a warning when the tables drift).

Usage:
    python tools/sim.py            # 400 runs per policy, prints a table
    python tools/sim.py --runs 800 # more runs

Policies:
    random         random allocation + random EVA/shelter choices
    even           even cell split, no EVA, no shelter
    always_shelter even split, shelter ordered as soon as a storm is known
    always_work    even split, never shelters
    never_eva      even split, no EVA, shelters via the console order
    good           scripted mixed strategy (the "intended" play)
"""

from __future__ import annotations

import argparse
import json
import os
import random
from dataclasses import dataclass, field

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "sim_results.json")

# ---------------------------------------------------------------- constants
R = {
    "budget": 6, "max_draw": 2, "battery_cap": 6,
    "crew_o2": 10, "crew_water": 6,
    "o2_per_cell": 10, "water_per_cell": 9, "water_recovery": 0.98,
    "electrolysis": 2, "shield_per_cell": 4, "surface_per_cell": 8,
    "research_per_cell": 3,
    "leak": 30, "leak_isolated": 0.40, "leak_taped": 0.15,
    "patch_needed": 2, "ration_cut": 0.40, "ration_heart_after": 3,
    "storm_power": 70, "storm_shield_cut": 0.65, "bunker_cut": 0.90,
    "background_dose": 2.5, "dose_limit": 60,
    "ice_water": 14, "ice_o2": 8, "ice_dose": 6,
    "eva": 3, "max_hearts": 3, "critical": 20,
}

LEVELS = {
    "1.1": dict(rows=["o2", "water", "battery"], start={"o2": 38, "water": 48, "battery": 0},
                goals={"o2": 70, "water": 60, "battery": 3}, goals_sol=5, max_slip=2,
                schedule=["calm", "calm", "longshadow", "calm", "calm", "dust", "calm"]),
    "1.2": dict(rows=["o2", "water", "repair"], start={"o2": 65, "water": 68}, max_sols=6,
                schedule=["calm", "calm", "dust", "cold", "calm", "calm"]),
    "1.3": dict(rows=["o2", "shielding", "surface"], start={"o2": 75, "shielding": 30},
                max_sols=6, schedule=["calm", "cme", "calm", "calm", "calm", "calm"]),
}


@dataclass
class Run:
    level: str
    rows: list
    res: dict
    sol: int = 1
    hearts: int = 3
    battery: int = 0
    dose: float = 0
    dose_peak: float = 0
    research: int = 0
    budget: int = 6
    penalty: int = 0
    next_penalty: int = 0
    draws: int = 0
    panel: bool = False
    carrying_panel: bool = False
    carrying_tape: bool = False
    isolated: bool = False
    taped: bool = False
    patched: bool = False
    reopened: bool = False
    patch: int = 0
    ration: bool = False
    ration_sols: int = 0
    eva: int = 3
    ice_used: int = 0
    storm_arrival: int = 0
    storm_duration: int = 1
    storm_known: bool = False
    sheltered: bool = False
    shelter_sol: int = 0
    slip: int = 0
    delayed: bool = False
    lowest: dict = field(default_factory=dict)
    hearts_lost: int = 0
    dead: bool = False
    fail_reason: str = ""
    won: bool = False
    log: list = field(default_factory=list)


def new_run(level_id: str, rng: random.Random) -> Run:
    L = LEVELS[level_id]
    res = {row: L["start"].get(row, 0) for row in L["rows"]}
    r = Run(level=level_id, rows=L["rows"], res=res)
    if level_id == "1.1":
        r.battery = 1
    if level_id == "1.2":
        pass
    if level_id == "1.3":
        r.storm_arrival = rng.choice([3, 4, 5])
        r.storm_duration = 2 if rng.random() < 0.8 else 1
    return r


def sol_wear(st: Run) -> dict:
    w = {}
    for row in st.rows:
        if row in ("battery", "surface", "repair"):
            continue
        if row == "o2":
            w[row] = 5 + round(0.5 * st.sol)
        elif row == "water":
            w[row] = 3 + round(0.4 * st.sol)
        else:
            w[row] = 4
    return w


def apply_actions(st: Run, actions: list) -> None:
    for a in actions:
        if a == "sweep" and st.penalty > 0:
            st.budget += st.penalty
            st.penalty = 0
        elif a == "fetch_panel":
            st.carrying_panel = True
        elif a == "install_panel" and st.carrying_panel:
            st.carrying_panel = False
            st.panel = True
            st.budget += 1
        elif a == "isolate":
            st.isolated = True
        elif a == "fetch_tape":
            st.carrying_tape = True
        elif a == "tape" and st.carrying_tape:
            st.taped = True
        elif a == "reopen" and st.patched:
            st.reopened = True
            st.isolated = False
        elif a == "dish":
            st.storm_known = True
        elif a == "shelter":
            st.sheltered = True
            st.shelter_sol = st.sol
        elif a == "ice":
            st.ice_used = st.sol
            if st.level == "1.3":
                st.res["o2"] = min(100, st.res["o2"] + R["ice_o2"])
                if st.storm_arrival <= st.sol < st.storm_arrival + st.storm_duration:
                    st.dose = min(100, st.dose + R["ice_dose"])
            else:
                st.res["water"] = min(100, st.res["water"] + R["ice_water"])


def resolve(st: Run, alloc: dict, actions: list, ration: bool, rng: random.Random) -> None:
    if st.dead or st.won:
        return
    st.ration = ration
    apply_actions(st, actions)

    # gains
    for row in st.rows:
        cells = alloc.get(row, 0)
        if row == "battery":
            st.battery = min(R["battery_cap"], st.battery + cells)
        elif row == "repair":
            pass
        elif row == "surface":
            if not st.sheltered:
                st.res[row] = min(100, st.res.get(row, 0) + cells * R["surface_per_cell"])
        elif row == "shielding":
            st.res[row] = min(100, st.res.get(row, 0) + cells * R["shield_per_cell"])
        elif row == "water":
            if not (st.level == "1.2" and st.isolated):
                st.res[row] = min(100, st.res.get(row, 0) + cells * R["water_per_cell"])
        elif row == "o2":
            if not st.sheltered:
                st.res[row] = min(100, st.res.get(row, 0) + cells * R["o2_per_cell"])
            elif cells >= 1:
                st.res[row] = min(100, st.res.get(row, 0) + cells * R["o2_per_cell"])
            else:
                st.res[row] = max(0, st.res.get(row, 0) - 6)

    # electrolysis + crew
    if st.rows and "water" in st.res and alloc.get("o2", 0):
        st.res["water"] = max(0, st.res["water"] - alloc["o2"] * R["electrolysis"])
    if "o2" in st.res:
        st.res["o2"] = max(0, st.res["o2"] - R["crew_o2"])
    if "water" in st.res:
        cut = st.ration
        use = R["crew_water"] * (1 - R["ration_cut"] if cut else 1)
        st.res["water"] = max(0, st.res["water"] - use)

    # wear
    for row, w in sol_wear(st).items():
        st.res[row] = max(0, st.res[row] - w)
        st.lowest[row] = min(st.lowest.get(row, 100), round(st.res[row]))

    # leak
    if st.level == "1.2":
        if not st.reopened:
            rate = R["leak"] * (R["leak_taped"] if st.taped else R["leak_isolated"] if st.isolated else 1)
            st.res["water"] = max(0, st.res["water"] - rate)
        if st.isolated and st.taped and not st.patched:
            st.patch = min(R["patch_needed"], st.patch + (alloc.get("repair", 0)))
            if st.patch >= R["patch_needed"]:
                st.patched = True
        if st.ration:
            if st.reopened:
                st.ration = False
            elif st.res["water"] < 50:
                st.ration_sols += 1
                if st.ration_sols >= R["ration_heart_after"]:
                    st.ration_sols = 0
                    st.hearts -= 1

    # events
    if st.level == "1.1" or st.level == "1.2":
        ev = LEVELS[st.level]["schedule"][min(st.sol - 1, len(LEVELS[st.level]["schedule"]) - 1)]
        if ev == "dust":
            st.next_penalty = max(st.next_penalty, 1)
        elif ev == "longshadow":
            st.next_penalty = max(st.next_penalty, 2)
        elif ev == "cold":
            st.res["o2"] = max(0, st.res["o2"] - 8)

    # dose / research
    if st.level == "1.3":
        shield = st.res.get("shielding", 0)
        storm = st.storm_arrival <= st.sol < st.storm_arrival + st.storm_duration
        dose = R["background_dose"] * (1 - 0.3 * shield / 100)
        if storm:
            power = R["storm_power"] * (1 - R["storm_shield_cut"] * shield / 100)
            if st.sheltered:
                early = st.shelter_sol < st.storm_arrival
                dose += power * ((1 - R["bunker_cut"]) if early else 0.85)
            else:
                dose += power * 1.1          # crew outside adds exposure
        st.dose = min(100, st.dose + dose)
        st.dose_peak = max(st.dose_peak, st.dose)
        if st.dose > R["dose_limit"]:
            st.hearts -= 1
            st.hearts_lost += 1
        if not st.sheltered:
            st.research += alloc.get("surface", 0) * R["research_per_cell"]

    # leftover cells -> battery
    spent = sum(alloc.get(r, 0) for r in st.rows)
    leftover = max(0, st.budget - spent)
    if leftover:
        st.battery = min(R["battery_cap"], st.battery + leftover)
    if "battery" in st.res:
        st.res["battery"] = st.battery

    # clamp + hearts
    danger = [r for r in st.rows if r in ("o2", "water", "shielding")]
    for row in danger:
        st.res[row] = max(0, min(100, st.res.get(row, 0)))
    low = [r for r in danger if st.res.get(r, 100) < R["critical"]]
    if low:
        st.hearts -= 1
        st.hearts_lost += 1

    # outcome
    empty = [r for r in danger if st.res.get(r, 100) <= 0]
    if empty:
        st.dead = True
        st.fail_reason = f"ran out of {empty[0]}"
        return
    if st.hearts <= 0:
        st.dead = True
        st.fail_reason = "no hearts"
        return

    if st.level == "1.1":
        ready = (st.res["o2"] >= 70 and st.res["water"] >= 60 and st.res["battery"] >= 3)
        if st.sol >= 5:
            if ready:
                st.won = True
                return
            if st.slip < 2:
                st.slip += 1
                st.delayed = True
            else:
                st.dead = True
                st.fail_reason = "landing failed"
                return
    elif st.level == "1.2":
        if st.sol >= 6:
            if st.reopened and st.res["water"] >= 40:
                st.won = True
            else:
                st.dead = True
                st.fail_reason = "leak/water"
            return
    elif st.level == "1.3":
        if st.sol >= 6:
            if st.dose <= R["dose_limit"] and st.res["o2"] >= 30:
                st.won = True
            else:
                st.dead = True
                st.fail_reason = "dose/o2"
            return


def score(st: Run) -> int:
    s = 0
    for row in st.rows:
        if row == "battery":
            s += int(round(st.res.get("battery", st.battery))) * 10
        elif row != "repair":
            s += int(round(st.res.get(row, 0)))
    s += st.research
    s += st.hearts * 25
    if st.level == "1.1" and not st.delayed:
        s += 40
    if st.level == "1.2" and st.reopened:
        s += 30
    if st.level == "1.3" and st.sheltered:
        s += 20
    return s


def stars(st: Run) -> int:
    if not st.won:
        return 0
    n = max(1, min(3, st.hearts))
    par = {"1.1": 340, "1.2": 205, "1.3": 250}.get(st.level, 260)
    if st.delayed:
        n = min(n, 2)
    if score(st) < par:
        n = min(n, 2)
    if st.lowest and min(st.lowest.values()) < 30:
        n = min(n, 2)
    if st.dose_peak > 40:
        n = min(n, 2)
    if st.hearts_lost > 0:
        n = min(n, 2)
    return n


# ------------------------------------------------------------------ policies
def even_split(rows, budget):
    base = budget // len(rows)
    extra = budget - base * len(rows)
    return {row: base + (1 if i < extra else 0) for i, row in enumerate(rows)}


def random_split(rows, budget, rng):
    alloc = {row: 0 for row in rows}
    for _ in range(budget):
        alloc[rng.choice(rows)] += 1
    return alloc


def available_actions(st: Run) -> list:
    acts = []
    if st.level == "1.1":
        if st.penalty > 0:
            acts.append("sweep")
        if not st.panel:
            acts += ["fetch_panel"] if not st.carrying_panel else ["install_panel"]
            if st.carrying_panel:
                acts.append("install_panel")
    if st.level == "1.2":
        if st.reopened:
            pass
        elif not st.isolated:
            acts.append("isolate")
            if not st.carrying_tape and not st.taped:
                acts.append("fetch_tape")
        elif not st.taped:
            acts += ["fetch_tape"] if not st.carrying_tape else ["tape"]
        elif st.patched and not st.reopened:
            acts.append("reopen")
        if st.res.get("water", 100) < 45 and st.ice_used != st.sol:
            acts.append("ice")
    if st.level == "1.3":
        if not st.storm_known:
            acts.append("dish")
        if st.ice_used != st.sol:
            acts.append("ice")
    return acts


def act_cost(a: str) -> int:
    return {"sweep": 1, "fetch_panel": 1, "install_panel": 1, "isolate": 2,
            "fetch_tape": 1, "tape": 1, "reopen": 1, "dish": 1, "shelter": 1, "ice": 2}[a]


def policy_actions(name: str, st: Run, rng: random.Random) -> list:
    if name in ("even", "always_shelter", "always_work", "never_eva"):
        if name in ("always_shelter", "never_eva") and st.level == "1.3" and st.storm_arrival and st.sol >= 2 and not st.sheltered:
            return ["shelter"]
        return []
    acts = available_actions(st)
    minutes = st.eva
    chosen = []
    if name == "random":
        # random choices: not every available task gets done
        rng.shuffle(acts)
        for a in acts:
            if rng.random() < 0.55 and act_cost(a) <= minutes:
                chosen.append(a)
                minutes -= act_cost(a)
        if st.level == "1.3" and st.storm_arrival and st.sol == st.storm_arrival and not st.sheltered and rng.random() < 0.5:
            chosen.append("shelter")
        return chosen
    # good
    if st.level == "1.3" and st.storm_arrival and st.sol >= 2 and not st.sheltered:
        acts.append("shelter")
    order = []
    if st.level == "1.1":
        order = ["sweep", "fetch_panel", "install_panel"]
    elif st.level == "1.2":
        order = ["isolate", "fetch_tape", "tape", "ice", "reopen"]
    else:
        order = ["dish", "shelter", "ice"]
    for a in order:
        if a in acts and act_cost(a) <= minutes:
            chosen.append(a)
            minutes -= act_cost(a)
    return chosen


def policy_alloc(name: str, st: Run, budget: int) -> dict:
    rows = st.rows
    if name == "random":
        return random_split(rows, budget, rng)
    if name in ("even", "always_shelter", "always_work", "never_eva"):
        return even_split(rows, budget)
    # good
    if st.level == "1.1":
        cells = {"o2": 3, "water": 3, "battery": max(0, budget - 6)}
        return cells
    if st.level == "1.2":
        if st.reopened:
            return {"o2": 2, "water": max(0, budget - 2), "repair": 0}
        if not st.isolated:
            return {"o2": 2, "water": 0, "repair": 1}
        if not st.taped:
            # tape is applied in EVA before resolve, so repair cells can cure now
            return {"o2": 2, "water": 0, "repair": max(0, budget - 2) if st.carrying_tape else 1}
        if not st.patched:
            return {"o2": 2, "water": 0, "repair": max(0, budget - 2)}
        return {"o2": 2, "water": 0, "repair": 0}
    # 1.3
    storm_window = st.storm_arrival and st.sol >= st.storm_arrival - 1
    if storm_window:
        return {"o2": 2, "shielding": budget - 2, "surface": 0}
    return {"o2": 2, "shielding": 2, "surface": max(0, budget - 4)}


def run_one(level_id: str, policy: str, seed: int) -> Run:
    global rng
    rng = random.Random(seed)
    st = new_run(level_id, rng)
    L = LEVELS[level_id]
    safety = 0
    while not st.dead and not st.won and safety < 10:
        safety += 1
        st.penalty = st.next_penalty
        st.next_penalty = 0
        st.draws = 0
        st.eva = R["eva"]
        st.budget = max(2, R["budget"] - st.penalty + (1 if st.panel else 0))
        # battery draw when short (good/random sometimes)
        while st.battery > 0 and st.draws < R["max_draw"] and st.budget < 5 and (policy == "good" or rng.random() < 0.4):
            st.battery -= 1
            st.draws += 1
            st.budget += 1

        alloc = policy_alloc(policy, st, st.budget)
        # keep within budget
        while sum(alloc.values()) > st.budget:
            k = max(alloc, key=alloc.get)
            alloc[k] -= 1
        actions = policy_actions(policy, st, rng)
        # ration only when it matters and the policy wants it
        ration = policy == "good" and st.level == "1.2" and st.res.get("water", 100) < 50 and not st.reopened
        resolve(st, alloc, actions, ration, rng)
        if st.won or st.dead:
            break
        st.sol += 1
    return st


# ---------------------------------------------------------------- strategies
# Three distinct winning plans per sublevel (checked by the report).
STRATEGIES = {
    "1.1": {
        "balanced": lambda st, b: {"o2": 3, "water": 3, "battery": max(0, b - 6)},
        "o2_first": lambda st, b: ({"o2": 4, "water": 3, "battery": 0} if st.sol <= 2 else {"o2": 3, "water": 3, "battery": max(0, b - 6)}),
        "water_first": lambda st, b: ({"o2": 3, "water": 4, "battery": 0} if st.sol <= 2 else {"o2": 3, "water": 3, "battery": max(0, b - 6)}),
    },
    "1.2": {
        "fast_isolation": lambda st, b: (
            {"o2": 2, "water": max(0, b - 2), "repair": 0} if st.reopened else
            {"o2": 2, "water": 0, "repair": max(0, b - 2)} if (st.taped or st.carrying_tape) else
            {"o2": 2, "water": 0, "repair": 1}),
        "water_stockpile": lambda st, b: (
            {"o2": 2, "water": max(0, b - 2), "repair": 0} if st.reopened else
            {"o2": 1, "water": 0, "repair": 1}),
        "repair_heavy": lambda st, b: (
            {"o2": 2, "water": max(0, b - 2), "repair": 0} if st.patched else
            {"o2": 2, "water": 0, "repair": max(0, b - 3)}),
    },
    "1.3": {
        "shelter_balanced": lambda st, b: {"o2": 2, "shielding": 2, "surface": max(0, b - 4)},
        "shield_wall": lambda st, b: {"o2": 2, "shielding": max(0, b - 2), "surface": 0},
        "research_focus": lambda st, b: {"o2": 2, "shielding": 1, "surface": max(0, b - 3)},
    },
}


def run_strategy(level, name, alloc_fn, seed):
    rng = random.Random(seed)
    st = new_run(level, rng)
    while not st.dead and not st.won and st.sol <= 8:
        st.penalty = st.next_penalty
        st.next_penalty = 0
        st.draws = 0
        st.eva = R["eva"]
        st.budget = max(2, R["budget"] - st.penalty + (1 if st.panel else 0))
        alloc = alloc_fn(st, st.budget)
        while sum(alloc.values()) > st.budget:
            k = max(alloc, key=alloc.get); alloc[k] -= 1
        acts = []
        mins = st.eva
        if level == "1.1":
            order = ["sweep", "fetch_panel", "install_panel"]
        elif level == "1.2":
            order = ["isolate", "fetch_tape", "tape", "ice", "reopen"]
        else:
            order = ["dish", "ice"]
        if level == "1.3" and st.sol >= 2 and st.storm_arrival and not st.sheltered:
            acts.append("shelter")
        avail = available_actions(st)
        for a in order:
            if a in avail and act_cost(a) <= mins:
                acts.append(a)
                mins -= act_cost(a)
        ration = st.level == "1.2" and st.res.get("water", 100) < 50 and not st.reopened
        resolve(st, alloc, acts, ration, rng)
        if st.won or st.dead:
            break
        st.sol += 1
    return st


POLICIES = ["random", "even", "always_shelter", "always_work", "never_eva", "good"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=400)
    args = ap.parse_args()

    table = {}
    failures = []
    for level in ["1.1", "1.2", "1.3"]:
        table[level] = {}
        for policy in POLICIES:
            wins = 0
            threes = 0
            scores = 0
            for i in range(args.runs):
                st = run_one(level, policy, seed=hash((level, policy, i)) & 0xFFFFFFFF)
                if st.won:
                    wins += 1
                    threes += 1 if stars(st) == 3 else 0
                    scores += score(st)
            win_pct = 100.0 * wins / args.runs
            three_pct = 100.0 * threes / args.runs
            avg = scores / wins if wins else 0
            table[level][policy] = {"win": round(win_pct, 1), "three": round(three_pct, 1), "avg_score": round(avg, 1)}
            failures.append((level, policy, win_pct, three_pct))

    print(f"\nBalance sim — {args.runs} runs per policy\n")
    header = f"{'level':5} {'policy':15} {'win%':>6} {'3*%':>6} {'score':>7}"
    print(header)
    print("-" * len(header))
    for level in ["1.1", "1.2", "1.3"]:
        for policy in POLICIES:
            row = table[level][policy]
            print(f"{level:5} {policy:15} {row['win']:6.1f} {row['three']:6.1f} {row['avg_score']:7.1f}")
        print()

    checks = []
    for level in ["1.1", "1.2", "1.3"]:
        checks.append((f"{level} random win <= 30%", table[level]["random"]["win"] <= 30.0))
        checks.append((f"{level} random 3* <= 5%", table[level]["random"]["three"] <= 5.0))
        checks.append((f"{level} good win >= 85%", table[level]["good"]["win"] >= 85.0))
        checks.append((f"{level} good 3* >= 40%", table[level]["good"]["three"] >= 40.0))
    checks.append(("even split fails at least one sublevel", any(table[l]["even"]["win"] < 90 for l in table)))
    checks.append(("always_shelter beaten by good", all(table[l]["good"]["win"] >= table[l]["always_shelter"]["win"] for l in table)))
    checks.append(("always_work beaten by good", all(table[l]["good"]["win"] >= table[l]["always_work"]["win"] for l in table)))
    checks.append(("never_eva beaten by good", all(table[l]["good"]["win"] >= table[l]["never_eva"]["win"] for l in table)))
    checks.append(("good out-scores always_shelter", all(table[l]["good"]["avg_score"] >= table[l]["always_shelter"]["avg_score"] for l in table)))
    checks.append(("good out-scores always_work", all(table[l]["good"]["avg_score"] >= table[l]["always_work"]["avg_score"] for l in table)))
    checks.append(("good out-scores never_eva", all(table[l]["good"]["avg_score"] >= table[l]["never_eva"]["avg_score"] for l in table)))

    # three distinct winning strategies per sublevel
    strategy_rows = {}
    for level, defs in STRATEGIES.items():
        strategy_rows[level] = {}
        for name, fn in defs.items():
            wins = 0
            threes = 0
            runs = max(60, args.runs // 4)
            for i in range(runs):
                st = run_strategy(level, name, fn, seed=(hash((level, name, i)) & 0xFFFFFFFF))
                if st.won:
                    wins += 1
                    threes += 1 if stars(st) == 3 else 0
            strategy_rows[level][name] = {"win": round(100.0 * wins / runs, 1), "three": round(100.0 * threes / runs, 1)}
        ok = sum(1 for r in strategy_rows[level].values() if r["win"] >= 50) >= 3
        checks.append((f"{level} has 3 winning strategies >=50%", ok))
    print("\nDistinct strategies")
    for level, rows in strategy_rows.items():
        for name, r in rows.items():
            print(f"  {level} {name:18} win {r['win']:5.1f}%  3* {r['three']:5.1f}%")

    print("Targets")
    for label, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"runs": args.runs, "table": table, "strategies": strategy_rows, "checks": [{"label": l, "pass": p} for l, p in checks]}, f, indent=1)
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
