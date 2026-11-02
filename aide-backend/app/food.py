"""Food orders: plan and check a cart in Aide, then hand it to Claude to place.

Swiggy and Zomato don't allow third-party apps on their ordering connections yet, so
Aide never talks to them directly. Instead:

1. parse_request() turns "2 paneer butter masala and 3 butter naan from Punjabi Rasoi
   on swiggy under 600" into a planned cart you can edit.
2. checks() verifies it against your food preferences (diet, foods to avoid, budget cap,
   odd quantities). A "block" check stops approval.
3. handoff_prompt() writes precise instructions for Claude (with the official Swiggy or
   Zomato connector): build exactly this cart, show it with prices and point out every
   difference, and only place the order after an explicit "yes, place it".

The parser is deliberately rule-based, so it never invents dishes. You can fix anything
it gets wrong on the cart card before approving.
"""
from __future__ import annotations

import re

APPS = ("swiggy", "zomato")
DIETS = ("no preference", "vegetarian", "eggetarian", "vegan")
SPICE = ("mild", "medium", "spicy")
APP_LABEL = {"swiggy": "Swiggy", "zomato": "Zomato"}

NUMBER_WORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
                "seven": 7, "eight": 8, "nine": 9, "ten": 10, "dozen": 12, "half dozen": 6}

MEAT = r"\b(chicken|mutton|lamb|goat|fish|prawns?|shrimps?|crab|beef|pork|bacon|ham|keema|meat|tuna|salmon|seafood|pepperoni|sausages?|kebab)\b"
EGG = r"\b(eggs?|omelett?e|anda)\b"
DAIRY = r"\b(paneer|cheese|butter|ghee|cream|curd|dahi|lassi|milk|raita|kheer|malai|makhani|mayo|yogurt|yoghurt)\b"

# Bits of a request that are instructions for the whole order, not dishes.
GLOBAL_NOTE = re.compile(r"^(less|no|extra|more|make (it|them)|without|not too|mild|medium|spicy|cutlery|don'?t)\b", re.I)
FILLER = re.compile(r"^(please\s+)?(order|get( me)?|i want|i'?d like|can you order|buy)\s+(me\s+)?", re.I)


AMOUNT = r"(?:\d{1,3}(?:,\d{3})+|\d+)"  # 600, 1,200 (but not the comma in "600, less spicy")


def _money(s: str) -> int | None:
    m = re.search(AMOUNT, s)
    return int(m.group().replace(",", "")) if m else None


def _cut(t: str, m: re.Match) -> str:
    """Remove a matched span, leaving a separator so neighbouring parts don't merge."""
    return f"{t[: m.start()]}, {t[m.end():]}".strip(" ,")


def _parse_item(part: str) -> dict | None:
    part = FILLER.sub("", part.strip(" .")).strip()
    if not part:
        return None
    notes = ""
    m = re.search(r"\(([^)]*)\)\s*$", part)
    if m:
        notes, part = m.group(1).strip(), part[: m.start()].strip()
    qty = 1
    m = re.match(r"^(\d{1,2})\s*(?:x|×|nos?\.?|pcs?\.?|plates?\s+of)?\s+(.+)$", part, re.I)
    if m:
        qty, part = int(m.group(1)), m.group(2)
    else:
        m = re.match(r"^(half dozen|dozen|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:plates?\s+of\s+)?(.+)$", part, re.I)
        if m:
            qty, part = NUMBER_WORDS[m.group(1).lower()], m.group(2)
        else:
            m = re.match(r"^(.+?)\s*(?:x|×)\s*(\d{1,2})$", part, re.I)
            if m:
                part, qty = m.group(1), int(m.group(2))
    name = " ".join(part.split()).strip(" -")
    if not name:
        return None
    return {"name": name[:1].upper() + name[1:], "qty": qty, "notes": notes}


def parse_request(text: str, profile: dict) -> dict:
    """Plain-language request -> {app, restaurant, budget, notes, items[]}."""
    t = " ".join(text.split())
    app = None
    m = re.search(r"\b(?:on|via|using|through|from)?\s*\b(swiggy|zomato)\b", t, re.I)
    if m:
        app, t = m.group(1).lower(), _cut(t, m)
    budget = None
    m = re.search(rf"\b(?:under|below|within|max(?:imum)?|budget(?: of| is)?|up ?to|upto|less than)\s*(?:₹|rs\.?|inr)?\s*{AMOUNT}(?:\s*(?:rs|rupees|₹))?", t, re.I)
    if m:
        budget, t = _money(m.group()), _cut(t, m)
    restaurant = ""
    m = re.search(r"\bfrom\s+(.+?)(?=\s*(?:,|$|\bfor\b|\bwith\b|\bat\b))", t, re.I)
    if m:
        restaurant, t = m.group(1).strip(" ."), _cut(t, m)

    items, notes = [], []
    for part in re.split(r",|;|\n|\+|\band\b|\s&\s", t, flags=re.I):
        part = part.strip(" .")
        if not part:
            continue
        if GLOBAL_NOTE.match(part):
            notes.append(part)
            continue
        item = _parse_item(part)
        if item:
            items.append(item)
    return {
        "app": app or profile.get("preferred_app") or "swiggy",
        "restaurant": restaurant[:1].upper() + restaurant[1:] if restaurant else "",
        "budget": budget,
        "notes": "; ".join(notes),
        "items": items,
    }


def checks(order: dict, profile: dict) -> list[dict]:
    """Verify a planned cart against your preferences.
    Levels: ok, info, warn (worth a look), block (can't approve until fixed)."""
    out = []
    add = lambda level, text: out.append({"level": level, "text": text})  # noqa: E731
    items = order.get("items") or []
    diet = (profile.get("diet") or "no preference").lower()
    avoid = [a.strip().lower() for a in profile.get("avoid", []) if a.strip()]
    cap = profile.get("budget_cap")
    budget = order.get("budget")

    if not items:
        add("block", "The cart is empty. Add at least one dish.")
    for it in items:
        name = it.get("name", "")
        low = f"{name} {it.get('notes', '')}".lower()
        q = it.get("qty", 1)
        if not isinstance(q, int) or q < 1:
            add("block", f"{name}: quantity must be at least 1.")
        elif q > 10:
            add("warn", f"{name}: {q} is a lot. Double-check the quantity.")
        if diet in ("vegetarian", "eggetarian", "vegan") and re.search(MEAT, low):
            add("block", f"{name} looks non-vegetarian, but your preference is {diet}.")
        if diet in ("vegetarian", "vegan") and re.search(EGG, low):
            add("block", f"{name} looks like it has egg, but your preference is {diet}.")
        if diet == "vegan" and re.search(DAIRY, low):
            add("warn", f"{name} usually has dairy, and you're vegan. Ask for a vegan version or swap it.")
        for a in avoid:
            if re.search(rf"\b{re.escape(a)}\b", low):
                add("block", f"{name} has {a}, which is on your avoid list.")

    if budget is None:
        if cap:
            add("info", f"No budget given, so your usual cap of ₹{cap} applies.")
    elif cap and budget > cap:
        add("warn", f"Budget ₹{budget} is above your usual cap of ₹{cap}.")
    if not (profile.get("area") or "").strip():
        add("warn", "Your delivery area isn't set. Add it in Food preferences so Claude searches near you.")
    if not order.get("restaurant"):
        add("info", "No restaurant named. Claude will suggest a few nearby and ask you to pick.")
    if order.get("app") == "swiggy":
        add("info", "Swiggy orders through Claude are cash on delivery and can't be cancelled once placed.")
    elif order.get("app") == "zomato":
        add("info", "Zomato orders through Claude are paid by QR code.")
    if not any(c["level"] in ("warn", "block") for c in out):
        add("ok", "Matches your preferences.")
    return out


def can_approve(order: dict, profile: dict) -> bool:
    return not any(c["level"] == "block" for c in checks(order, profile))


def handoff_prompt(order: dict, profile: dict) -> str:
    """Instructions for Claude + the official connector. Placing the order always needs your yes."""
    app = APP_LABEL.get(order.get("app"), "Swiggy")
    budget = order.get("budget") or profile.get("budget_cap")
    diet = profile.get("diet") or "no preference"
    area = (profile.get("area") or "").strip()
    avoid = [a for a in profile.get("avoid", []) if a.strip()]
    lines = [f"- {it['qty']} × {it['name']}" + (f" ({it['notes']})" if it.get("notes") else "") for it in order["items"]]
    where = (f"from {order['restaurant']}" if order.get("restaurant")
             else f"from a well-rated restaurant {'near ' + area if area else 'near my delivery address'} that has all of these. Show me 2-3 options first and let me pick")

    prefs = [f"spice level: {profile.get('spice', 'medium')}"]
    if diet != "no preference":
        prefs.append(f"diet: {diet}")
    if avoid:
        prefs.append(f"avoid: {', '.join(avoid)}")
    if order.get("notes"):
        prefs.append(f"notes: {order['notes']}")
    if profile.get("notes"):
        prefs.append(profile["notes"])

    steps = [
        f"Use the {app} connector to order food for me {where}.",
        "Build a cart with exactly these items and quantities:\n" + "\n".join(lines),
        f"Do NOT place the order yet. First show me the actual {app} cart: each item exactly as named on the menu "
        "with its price, quantity and customizations; delivery fee, taxes, discounts and the final total; "
        "estimated delivery time; the delivery address; and the payment method.",
        "Check it against my list above and tell me clearly about any item that's missing, unavailable, "
        "substituted or named differently, and any quantity that doesn't match"
        + (f", anything that isn't {diet}" if diet != "no preference" else "")
        + (f", anything containing {', '.join(avoid)}" if avoid else "")
        + (f", and whether the final total is within ₹{budget}" if budget else "") + ".",
        "Only place the order after I reply with an explicit \"yes, place it\". If anything changes after that, show me the cart again.",
    ]
    if order.get("app") == "swiggy":
        steps.append("Before I confirm, remind me that this is cash on delivery and that Swiggy orders placed this way can't be cancelled.")
    text = "\n\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1))
    return f"{text}\n\nMy preferences: {'; '.join(prefs)}."
