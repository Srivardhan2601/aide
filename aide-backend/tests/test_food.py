"""Food: plan a cart in Aide, check it, approve it, hand it to Claude."""
import json
import shutil

import pytest

from app import food
from app.config import CONFIG_DIR

PREFS = {"area": "Indiranagar, Bengaluru", "diet": "no preference", "spice": "medium", "budget_cap": 500,
         "preferred_app": "swiggy", "favorites": [], "avoid": [], "notes": ""}


@pytest.fixture(autouse=True)
def temp_config(tmp_path, monkeypatch):
    d = tmp_path / "config"
    shutil.copytree(CONFIG_DIR, d)
    monkeypatch.setenv("AIDE_CONFIG_DIR", str(d))
    return d


# ----- parser ---------------------------------------------------------------

def test_parse_full_request():
    p = food.parse_request("2 paneer butter masala and 3 butter naan from Punjabi Rasoi on zomato under ₹600, less spicy", PREFS)
    assert p["app"] == "zomato"
    assert p["restaurant"] == "Punjabi Rasoi"
    assert p["budget"] == 600
    assert p["notes"] == "less spicy"
    assert p["items"] == [{"name": "Paneer butter masala", "qty": 2, "notes": ""},
                          {"name": "Butter naan", "qty": 3, "notes": ""}]


@pytest.mark.parametrize("text,expected", [
    ("one masala dosa", [("Masala dosa", 1)]),
    ("get me two veg biryani, a coke", [("Veg biryani", 2), ("Coke", 1)]),
    ("chicken 65 x2", [("Chicken 65", 2)]),
    ("1 pizza (extra cheese)", [("Pizza", 1)]),
    ("idli + vada", [("Idli", 1), ("Vada", 1)]),
])
def test_parse_quantities(text, expected):
    items = food.parse_request(text, PREFS)["items"]
    assert [(i["name"], i["qty"]) for i in items] == expected


def test_parse_amounts_with_commas():
    p = food.parse_request("4 thali from Rajdhani on swiggy under ₹1,200, no onion", PREFS)
    assert (p["budget"], p["restaurant"], p["notes"], p["app"]) == (1200, "Rajdhani", "no onion", "swiggy")
    assert p["items"] == [{"name": "Thali", "qty": 4, "notes": ""}]


def test_parse_item_notes_and_defaults():
    p = food.parse_request("1 pizza (extra cheese)", PREFS)
    assert p["items"][0]["notes"] == "extra cheese"
    assert p["app"] == "swiggy" and p["budget"] is None and p["restaurant"] == ""


# ----- checks ---------------------------------------------------------------

def levels(order, prefs):
    return {c["level"] for c in food.checks(order, prefs)}


def test_vegetarian_blocks_meat_and_egg():
    prefs = {**PREFS, "diet": "vegetarian"}
    order = {"app": "swiggy", "items": [{"name": "Chicken biryani", "qty": 1, "notes": ""}], "budget": 300, "restaurant": "X"}
    assert "block" in levels(order, prefs) and not food.can_approve(order, prefs)
    order["items"] = [{"name": "Egg curry", "qty": 1, "notes": ""}]
    assert not food.can_approve(order, prefs)
    assert food.can_approve(order, {**PREFS, "diet": "eggetarian"})


def test_avoid_list_blocks():
    prefs = {**PREFS, "avoid": ["mushroom"]}
    order = {"app": "swiggy", "items": [{"name": "Mushroom pizza", "qty": 1, "notes": ""}], "budget": 300, "restaurant": "X"}
    assert not food.can_approve(order, prefs)


def test_budget_and_quantity_warnings():
    order = {"app": "zomato", "items": [{"name": "Samosa", "qty": 20, "notes": ""}], "budget": 900, "restaurant": "X"}
    texts = " ".join(c["text"] for c in food.checks(order, PREFS))
    assert "above your usual cap of ₹500" in texts and "20 is a lot" in texts
    assert food.can_approve(order, PREFS)  # warnings don't block


def test_empty_cart_blocks():
    assert not food.can_approve({"app": "swiggy", "items": [], "budget": None, "restaurant": ""}, PREFS)


def test_clean_order_is_ok():
    order = {"app": "zomato", "items": [{"name": "Masala dosa", "qty": 1, "notes": ""}], "budget": 200, "restaurant": "MTR"}
    assert [c["level"] for c in food.checks(order, PREFS)] == ["info", "ok"]


# ----- handoff prompt -------------------------------------------------------

def test_handoff_prompt_requires_explicit_yes():
    order = {"app": "swiggy", "restaurant": "Punjabi Rasoi", "budget": 600, "notes": "less spicy",
             "items": [{"name": "Paneer butter masala", "qty": 2, "notes": ""}, {"name": "Butter naan", "qty": 3, "notes": "extra butter"}]}
    p = food.handoff_prompt(order, {**PREFS, "diet": "vegetarian", "avoid": ["mushroom"]})
    assert "Swiggy connector" in p and "from Punjabi Rasoi" in p
    assert "- 2 × Paneer butter masala" in p and "- 3 × Butter naan (extra butter)" in p
    assert "Do NOT place the order yet" in p
    assert '"yes, place it"' in p
    assert "within ₹600" in p and "isn't vegetarian" in p and "mushroom" in p
    assert "can't be cancelled" in p
    assert "Indiranagar" not in p  # restaurant given, so the area isn't needed


def test_handoff_without_restaurant_asks_to_pick():
    order = {"app": "zomato", "restaurant": "", "budget": None, "notes": "",
             "items": [{"name": "Masala dosa", "qty": 1, "notes": ""}]}
    p = food.handoff_prompt(order, PREFS)
    assert "near Indiranagar, Bengaluru" in p and "let me pick" in p
    assert "within ₹500" in p           # falls back to the cap
    assert "cash on delivery" not in p  # that's Swiggy only


# ----- API flow -------------------------------------------------------------

def test_plan_edit_approve_order_flow(client):
    o = client.post("/api/food/orders", json={"text": "2 veg biryani from Meghana on swiggy under 700"}).json()
    assert o["status"] == "planned" and o["canApprove"] and o["handoffPrompt"] is None
    assert o["items"] == [{"name": "Veg biryani", "qty": 2, "notes": ""}]

    o = client.patch(f"/api/food/orders/{o['id']}", json={
        "items": [{"name": "Veg biryani", "qty": 1}, {"name": "Raita", "qty": 1, "notes": "no onion"}],
        "budget": 500}).json()
    assert [i["name"] for i in o["items"]] == ["Veg biryani", "Raita"] and o["budget"] == 500

    a = client.post(f"/api/food/orders/{o['id']}/approve").json()
    assert a["status"] == "approved"
    assert "- 1 × Raita (no onion)" in a["handoffPrompt"] and "within ₹500" in a["handoffPrompt"]

    # Approved plans are locked: changes would no longer match what Claude was told.
    assert client.patch(f"/api/food/orders/{o['id']}", json={"budget": 900}).status_code == 409
    assert client.post(f"/api/food/orders/{o['id']}/ordered").json()["status"] == "ordered"
    assert client.post(f"/api/food/orders/{o['id']}/cancel").status_code == 409


def test_blocked_plan_cannot_be_approved(client):
    client.patch("/api/food/profile", json={"diet": "vegetarian"})
    o = client.post("/api/food/orders", json={"text": "1 chicken biryani"}).json()
    assert not o["canApprove"]
    assert client.post(f"/api/food/orders/{o['id']}/approve").status_code == 409
    o = client.patch(f"/api/food/orders/{o['id']}", json={"items": [{"name": "Veg biryani", "qty": 1}]}).json()
    assert o["canApprove"]


def test_cancel_and_list(client):
    o = client.post("/api/food/orders", json={"text": "1 coffee", "app": "zomato"}).json()
    assert o["app"] == "zomato"
    assert client.post(f"/api/food/orders/{o['id']}/cancel").json()["status"] == "cancelled"
    assert [x["status"] for x in client.get("/api/food/orders").json()] == ["cancelled"]


def test_food_profile_update(client, temp_config):
    p = client.patch("/api/food/profile", json={"area": "  Koramangala,  Bengaluru ", "budgetCap": 400,
                                                "avoid": ["mushroom", "Mushroom", "peanuts"], "preferredApp": "zomato"}).json()
    assert p["area"] == "Koramangala, Bengaluru" and p["budgetCap"] == 400
    assert p["avoid"] == ["mushroom", "peanuts"] and p["preferredApp"] == "zomato"
    saved = json.loads((temp_config / "food_profile.json").read_text(encoding="utf-8"))
    assert saved["budget_cap"] == 400 and saved["diet"] == "no preference"
    assert client.patch("/api/food/profile", json={"diet": "carnivore"}).status_code == 422


def test_validation(client):
    assert client.post("/api/food/orders", json={"text": ""}).status_code == 422
    assert client.post("/api/food/orders", json={"text": "x", "app": "ubereats"}).status_code == 422
    assert client.post("/api/food/orders/999/approve").status_code == 404
