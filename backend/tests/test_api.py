"""HTTP-level tests: contract, error envelope, orders, accounts, admin, access control."""

import io
import json
from pathlib import Path

import numpy as np
import pytest
import trimesh
from conftest import ADMIN_KEY, SECRET, design, order_payload, post_order
from synth import encode, render

from optiframe.geometry.pipeline import sign_design

ADMIN = {"X-Admin-Key": ADMIN_KEY}


def _generate(client, d=None):
    d = d or design()
    r = client.post("/api/generate", json=d)
    assert r.status_code == 200, r.text
    return d, r


def _place_order(client, **kw):
    d, g = _generate(client)
    payload = order_payload(d, g.headers["X-Design-Signature"], **kw)
    return post_order(client, g.content, payload), g


def _auth(client, email="user@example.org", password="correct horse"):
    r = client.post("/api/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ---------------------------------------------------------------------------- meta & envelope


def test_health_and_options(client):
    assert client.get("/api/health").json() == {"status": "ok", "model_loaded": True}
    o = client.get("/api/options").json()
    assert {p["id"] for p in o["patterns"]} == {"none", "woven", "honeycomb", "brushed", "dots"}
    assert len(o["colors"]) >= 6
    assert {m["id"] for m in o["materials"]} == {"petg", "pla", "asa"}
    assert o["params"]["bridge_mm"] == {"min": 12.0, "max": 30.0, "step": 0.5, "default": 18.0}
    assert o["engraving"]["max_chars"] == 8
    assert o["references"]["credit_card"]["width_mm"] == 85.60


def test_health_degraded_without_model(client_no_model):
    assert client_no_model.get("/api/health").json()["model_loaded"] is False
    files = {"left_image": ("l.jpg", b"x", "image/jpeg"), "right_image": ("r.jpg", b"x", "image/jpeg")}
    r = client_no_model.post("/api/measure", files=files, data={"reference": '{"type":"credit_card"}'})
    assert r.status_code == 503 and r.json()["error"]["code"] == "SERVICE_UNAVAILABLE"


def test_error_envelope_and_request_id(client):
    r = client.post("/api/generate", json={"bridge_mm": 99})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "VALIDATION_ERROR" and err["details"]["fields"]
    assert r.headers["X-Request-ID"]
    assert client.get("/api/health", headers={"X-Request-ID": "abc"}).headers["X-Request-ID"] == "abc"
    assert client.delete("/api/health").json()["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_cors_exposes_stl_headers(client):
    d = design()
    r = client.post("/api/generate", json=d, headers={"Origin": "http://localhost:5173"})
    exposed = r.headers["access-control-expose-headers"]
    for h in ("X-Design-Signature", "X-Volume-Mm3", "X-Lens-Centers-Mm"):
        assert h in exposed
    pre = client.options("/api/orders", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
                                                  "Access-Control-Request-Headers": "idempotency-key,authorization"})
    assert pre.status_code == 200
    assert client.get("/api/health", headers={"Origin": "https://evil.example"}).headers.get(
        "access-control-allow-origin") is None


# ---------------------------------------------------------------------------- measurement


def test_measure_both_lenses(client):
    left, right = render(30, lens_a=50, lens_b=36), render(31, lens_a=56, lens_b=37, tilt_deg=15)
    r = client.post("/api/measure", files={
        "left_image": ("l.jpg", encode(left.image), "image/jpeg"),
        "right_image": ("r.jpg", encode(right.image), "image/jpeg"),
    }, data={"reference": json.dumps({"type": "credit_card"}), "left_hint": json.dumps(left.hint),
             "right_hint": json.dumps(right.hint)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert abs(body["left"]["A"] - left.A) < 0.5 and abs(body["right"]["A"] - right.A) < 0.5
    assert body["asymmetric"] is True  # ΔA ≈ 6 mm
    assert body["warnings"] == []


def test_measure_single_lens_and_contour_feeds_generate(client):
    sc = render(32, ref="aruco")
    r = client.post("/api/measure/lens", files={"image": ("a.jpg", encode(sc.image), "image/jpeg")}, data={
        "side": "right", "reference": json.dumps({"type": "aruco", "dictionary": "DICT_4X4_50", "marker_size_mm": 40}),
    })
    assert r.status_code == 200, r.text
    lens = r.json()["lens"]
    assert abs(lens["A"] - sc.A) < 0.5
    g = client.post("/api/generate", json=design(left_contour_mm=lens["contour_mm"], right_contour_mm=lens["contour_mm"]))
    assert g.status_code == 200


@pytest.mark.parametrize("filename", [
    "Gemini_Generated_Image_hhigiihhigiihhig.jpg",
    "Gemini_Generated_Image_1naf0e1naf0e1naf.jpg",
    "Gemini_Generated_Image_vf2jlhvf2jlhvf2j.jpg",
    "Gemini_Generated_Image_4a4qfv4a4qfv4a4q.jpg",
    "Gemini_Generated_Image_b6ws07b6ws07b6ws.jpg",
    "Gemini_Generated_Image_nxvhrenxvhrenxvh.jpg",
    "hard_blue_card_light.jpg",
])
def test_repository_lens_photo_feeds_generate(client, filename):
    """Every checked-in real-photo fixture must make it through preview generation."""
    image = Path(__file__).parents[2] / "test" / filename
    r = client.post("/api/measure/lens", files={"image": (filename, image.read_bytes(), "image/jpeg")}, data={
        "side": "left", "reference": '{"type":"credit_card"}',
    })
    assert r.status_code == 200, r.text
    lens = r.json()["lens"]
    g = client.post("/api/generate", json=design(left_contour_mm=lens["contour_mm"], right_contour_mm=lens["contour_mm"]))
    assert g.status_code == 200, g.text


def test_measure_errors_name_the_side(client):
    good = encode(render(33).image)
    r = client.post("/api/measure", files={"left_image": ("l.jpg", good, "image/jpeg"),
                                           "right_image": ("r.jpg", b"garbage", "image/jpeg")},
                    data={"reference": '{"type":"credit_card"}'})
    assert r.status_code == 422
    assert r.json()["error"] | {"message": ""} == {"code": "INVALID_IMAGE", "side": "right", "message": ""}


@pytest.mark.parametrize(("reference", "hint"), [
    ('{"type":"bogus"}', None),
    ('{"type":"aruco","dictionary":"DICT_NOPE","marker_size_mm":40}', None),
    ('{"type":"custom","width_mm":5,"height_mm":50}', None),
    ("not json", None),
    ('{"type":"a4"}', "[0.5, 0.5, 0.2, 0.9]"),
])
def test_measure_input_validation(client, reference, hint):
    data = {"reference": reference} | ({"left_hint": hint} if hint else {})
    r = client.post("/api/measure", files={"left_image": ("l.jpg", b"x", "image/jpeg"),
                                           "right_image": ("r.jpg", b"x", "image/jpeg")}, data=data)
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_upload_size_limit(client):
    big = b"\xff" * (client.app.state.settings.max_image_bytes + 1)
    r = client.post("/api/measure", files={"left_image": ("l.jpg", big, "image/jpeg"),
                                           "right_image": ("r.jpg", b"x", "image/jpeg")},
                    data={"reference": '{"type":"credit_card"}'})
    assert r.status_code == 413 and r.json()["error"] == {
        "code": "IMAGE_TOO_LARGE", "side": "left", "message": r.json()["error"]["message"]}


# ---------------------------------------------------------------------------- generation


def test_generate_returns_valid_stl_with_metadata(client):
    d, r = _generate(client, design(pattern="woven", engraving_text="Zoé"))
    assert r.headers["content-type"] == "model/stl"
    mesh = trimesh.load(io.BytesIO(r.content), file_type="stl")
    assert mesh.is_watertight
    assert float(r.headers["X-Volume-Mm3"]) == pytest.approx(mesh.volume, rel=1e-3)
    assert float(r.headers["X-Max-Deviation-Mm"]) == pytest.approx(0.2, abs=0.05)
    centers = json.loads(r.headers["X-Lens-Centers-Mm"])
    assert centers["right"][0] < 0 < centers["left"][0]
    assert r.headers["X-Design-Signature"] == sign_design(SECRET, r.content, d)
    # cached: identical bytes
    assert client.post("/api/generate", json=d).content == r.content


@pytest.mark.parametrize(("text", "code"), [("ABCDEFGHI", "VALIDATION_ERROR"), ("日本", "ENGRAVING_INVALID"),
                                            ("a@b", "ENGRAVING_INVALID")])
def test_generate_engraving_rules(client, text, code):
    r = client.post("/api/generate", json=design(engraving_text=text))
    assert r.status_code == 422 and r.json()["error"]["code"] == code


def test_generate_rejects_unknown_fields_and_bad_contours(client):
    assert client.post("/api/generate", json=design(color="navy")).status_code == 422
    bow = [[float(np.cos(t) * 25), float(np.sin(2 * t) * 15)] for t in np.linspace(0, 2 * np.pi, 40, endpoint=False)]
    r = client.post("/api/generate", json=design(right_contour_mm=bow))
    assert r.json()["error"]["code"] == "INVALID_CONTOUR" and r.json()["error"]["side"] == "right"


def test_rate_limit(tmp_path, segmenter):
    from conftest import make_settings
    from fastapi.testclient import TestClient

    from optiframe.main import create_app

    app = create_app(make_settings(tmp_path, rate_limit_per_minute=2), load_model=False)
    with TestClient(app) as c:
        codes = [c.post("/api/generate", json={}).status_code for _ in range(3)]
    assert codes == [422, 422, 429]


# ---------------------------------------------------------------------------- quote & orders


def test_quote(client):
    q = client.post("/api/quote", json={"volume_mm3": 6000, "material": "petg"}).json()
    # 6 cm³ × 1.27 g/cm³ = 7.6 g × 0.12 = 0.91 + 6.90 shipping
    assert q["grams"] == 7.6 and q["material_cost"] == 0.91 and q["shipping"] == 6.9 and q["total"] == 7.81
    assert q["currency"] == "EUR" and q["sponsored"] is False


def test_guest_order_flow(client, settings):
    r, g = _place_order(client)
    assert r.status_code == 201, r.text
    o = r.json()
    oid, token = o["order_id"], o["access_token"]
    assert oid.startswith("OF-") and o["status"] == "received" and o["can_cancel"]
    assert o["email"] == "awa@example.org" and o["shipping_address"]["country"] == "SN"
    assert o["specs"]["material"] == "petg" and o["specs"]["left_lens"]["A"] == 52.0
    assert o["estimated_delivery"]["from"] < o["estimated_delivery"]["to"]
    vol = float(g.headers["X-Volume-Mm3"])
    assert o["pricing"]["total"] == client.post("/api/quote", json={"volume_mm3": vol, "material": "petg"}).json()["total"]

    # access control: token required, wrong token looks like a missing order
    assert client.get(f"/api/orders/{oid}").status_code == 404
    assert client.get(f"/api/orders/{oid}", params={"t": "wrong"}).status_code == 404
    assert client.get(f"/api/orders/{oid}", params={"t": token}).json()["order_id"] == oid
    assert client.get(f"/api/orders/{oid.lower()}", headers={"X-Order-Token": token}).status_code == 200
    stl = client.get(f"/api/orders/{oid}/stl", params={"t": token})
    assert stl.content == g.content
    assert client.get(f"/api/orders/{oid}/stl").status_code == 404


def test_order_validation_before_charge(client):
    d, g = _generate(client)
    sig = g.headers["X-Design-Signature"]
    # tampered STL / design
    assert post_order(client, g.content[:-50] + b"\0" * 50, order_payload(d, sig)).json()["error"]["code"] == \
        "DESIGN_SIGNATURE_INVALID"
    assert post_order(client, g.content, order_payload(design(bridge_mm=20.0), sig)).json()["error"]["code"] == \
        "DESIGN_SIGNATURE_INVALID"
    # correctly signed but non-manifold mesh (only reachable if the signing key leaked)
    tri = trimesh.Trimesh(vertices=[[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces=[[0, 1, 2]]).export(file_type="stl")
    r = post_order(client, tri, order_payload(d, sign_design(SECRET, tri, d)))
    assert r.status_code == 422 and r.json()["error"]["code"] == "MESH_INVALID"
    assert r.json()["error"]["message"] == "Frame mesh is invalid — please regenerate."
    # payment
    assert post_order(client, g.content, order_payload(d, sig, payment=None)).json()["error"]["code"] == "PAYMENT_REQUIRED"
    r = post_order(client, g.content, order_payload(d, sig, payment={"provider": "fake", "token": "tok_fail"}))
    assert r.status_code == 402 and r.json()["error"]["code"] == "PAYMENT_FAILED"
    # snapshot / face data is not part of the contract
    assert post_order(client, g.content, order_payload(d, sig, snapshot="data:image/png;base64,AAAA")).status_code == 201


def test_idempotency(client):
    d, g = _generate(client)
    payload = order_payload(d, g.headers["X-Design-Signature"])
    h = {"Idempotency-Key": "abc-123"}
    first = post_order(client, g.content, payload, h)
    again = post_order(client, g.content, payload, h)
    assert first.status_code == 201 and again.status_code == 200
    assert first.json()["order_id"] == again.json()["order_id"]
    assert again.json()["access_token"] == first.json()["access_token"]
    conflict = post_order(client, g.content, {**payload, "color": "olive"}, h)
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_cancel_and_fulfilment(client):
    o = _place_order(client)[0].json()
    oid, t = o["order_id"], {"t": o["access_token"]}
    c = client.post(f"/api/orders/{oid}/cancel", params=t).json()
    assert c["status"] == "cancelled" and not c["can_cancel"]
    assert [e["status"] for e in c["timeline"]] == ["received", "cancelled"]
    assert client.post(f"/api/orders/{oid}/cancel", params=t).json()["error"]["code"] == "ORDER_NOT_CANCELLABLE"
    assert client.patch(f"/api/admin/orders/{oid}", json={"status": "printing"}, headers=ADMIN).status_code == 409

    o2 = _place_order(client)[0].json()
    oid2, t2 = o2["order_id"], {"t": o2["access_token"]}
    assert client.patch(f"/api/admin/orders/{oid2}", json={"status": "printing"}, headers=ADMIN).json()["status"] == "printing"
    assert client.post(f"/api/orders/{oid2}/cancel", params=t2).status_code == 409
    assert client.patch(f"/api/admin/orders/{oid2}", json={"status": "printing"}, headers=ADMIN).status_code == 200
    r = client.patch(f"/api/admin/orders/{oid2}", json={"status": "shipped", "tracking_number": "TRK1"}, headers=ADMIN)
    assert r.json()["tracking_number"] == "TRK1"
    back = client.patch(f"/api/admin/orders/{oid2}", json={"status": "printing"}, headers=ADMIN)
    assert back.status_code == 409 and back.json()["error"]["code"] == "INVALID_STATUS_TRANSITION"
    final = client.patch(f"/api/admin/orders/{oid2}", json={"status": "delivered"}, headers=ADMIN).json()
    assert [e["status"] for e in final["timeline"]] == ["received", "printing", "shipped", "delivered"]
    assert client.get(f"/api/orders/{oid2}/stl", params=t2).status_code == 200  # re-download at any status


def test_admin_requires_key(client, tmp_path, segmenter):
    assert client.get("/api/admin/orders").status_code == 403
    assert client.get("/api/admin/orders", headers={"X-Admin-Key": "nope"}).status_code == 403
    assert client.get("/api/admin/orders", headers=ADMIN).status_code == 200
    from conftest import make_settings
    from fastapi.testclient import TestClient

    from optiframe.main import create_app

    with TestClient(create_app(make_settings(tmp_path / "x", admin_api_key=""), load_model=False)) as c:
        assert c.get("/api/admin/orders", headers={"X-Admin-Key": ""}).status_code == 403


def test_admin_queue_and_stl(client):
    o = _place_order(client)[0].json()
    q = client.get("/api/admin/orders", params={"status": "received"}, headers=ADMIN).json()
    assert [x["order_id"] for x in q] == [o["order_id"]]
    assert client.get(f"/api/admin/orders/{o['order_id']}/stl", headers=ADMIN).status_code == 200
    assert client.get("/api/admin/orders", params={"status": "lost"}, headers=ADMIN).status_code == 422


# ---------------------------------------------------------------------------- sponsorship


def test_sponsored_orders(client):
    code = client.post("/api/admin/sponsor-codes", json={"sponsor_name": "SN-SF", "code": "snsf-2026", "max_uses": 1},
                       headers=ADMIN).json()
    assert code["code"] == "SNSF-2026" and code["uses"] == 0
    q = client.post("/api/quote", json={"volume_mm3": 6000, "material": "pla", "sponsor_code": "snsf-2026"}).json()
    assert q["total"] == 0 and q["sponsored"] and q["discount"] > 0

    r, _ = _place_order(client, sponsor_code="snsf-2026", payment=None)
    assert r.status_code == 201, r.text
    assert r.json()["pricing"]["total"] == 0 and r.json()["pricing"]["sponsored"]
    assert client.get("/api/admin/sponsor-codes", headers=ADMIN).json()[0]["uses"] == 1

    r2, _ = _place_order(client, sponsor_code="SNSF-2026", payment=None)
    assert r2.json()["error"]["code"] == "SPONSOR_CODE_INVALID"  # exhausted

    # cancelling releases the use
    o = r.json()
    client.post(f"/api/orders/{o['order_id']}/cancel", params={"t": o["access_token"]})
    assert client.get("/api/admin/sponsor-codes", headers=ADMIN).json()[0]["uses"] == 0

    client.patch("/api/admin/sponsor-codes/snsf-2026", json={"active": False}, headers=ADMIN)
    r3 = client.post("/api/quote", json={"volume_mm3": 6000, "material": "pla", "sponsor_code": "SNSF-2026"})
    assert r3.json()["error"]["code"] == "SPONSOR_CODE_INVALID"


def test_expired_sponsor_code(client):
    client.post("/api/admin/sponsor-codes", json={"sponsor_name": "NGO", "code": "OLD1", "max_uses": 5,
                                                  "expires_at": "2020-01-01T00:00:00Z"}, headers=ADMIN)
    assert client.post("/api/quote", json={"volume_mm3": 1, "material": "pla", "sponsor_code": "OLD1"}).status_code == 422


def test_sponsorship_disabled(tmp_path, segmenter):
    from conftest import make_settings
    from fastapi.testclient import TestClient

    from optiframe.main import create_app

    app = create_app(make_settings(tmp_path, sponsorship_enabled=False), load_model=False)
    with TestClient(app) as c:
        assert c.get("/api/options").json()["sponsorship_enabled"] is False
        r = c.post("/api/quote", json={"volume_mm3": 6000, "material": "pla", "sponsor_code": "X"})
        assert r.json()["error"]["code"] == "SPONSORSHIP_DISABLED"


# ---------------------------------------------------------------------------- accounts


def test_accounts(client):
    h = _auth(client, "Buyer@Example.org")
    assert client.post("/api/auth/register", json={"email": "buyer@example.org", "password": "another pw"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "buyer@example.org", "password": "wrong pw!"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "nobody@example.org", "password": "wrong pw!"}).status_code == 401
    login = client.post("/api/auth/login", json={"email": "BUYER@example.org", "password": "correct horse"})
    assert login.status_code == 200
    assert client.get("/api/me", headers=h).json()["email"] == "buyer@example.org"
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer junk"}).status_code == 401
    assert client.post("/api/auth/register", json={"email": "x@example.org", "password": "short"}).status_code == 422

    # account checkout links the order and saves the address
    r, _ = _place_order(client, email="buyer@example.org")  # guest checkout with the account's email
    guest_order = r.json()
    d, g = _generate(client)
    mine = client.post("/api/orders", files={"stl": ("f.stl", g.content, "model/stl")},
                       data={"order": json.dumps(order_payload(d, g.headers["X-Design-Signature"]))}, headers=h).json()
    assert client.get(f"/api/orders/{mine['order_id']}", headers=h).status_code == 200  # no token needed for owner
    assert client.get("/api/me", headers=h).json()["shipping_address"]["city"] == "Dakar"
    assert [x["order_id"] for x in client.get("/api/me/orders", headers=h).json()] == [mine["order_id"]]

    # a guest order with the same email is NOT auto-attached; it must be claimed with its access token
    assert client.get(f"/api/orders/{guest_order['order_id']}", headers=h).status_code == 404
    bad = client.post("/api/me/orders/claim", json={"order_id": guest_order["order_id"], "access_token": "x"}, headers=h)
    assert bad.status_code == 404
    ok = client.post("/api/me/orders/claim", json={"order_id": guest_order["order_id"],
                                                   "access_token": guest_order["access_token"]}, headers=h)
    assert ok.status_code == 200
    assert len(client.get("/api/me/orders", headers=h).json()) == 2

    # another account can't claim or view it
    other = _auth(client, "other@example.org")
    assert client.get(f"/api/orders/{mine['order_id']}", headers=other).status_code == 404
    steal = client.post("/api/me/orders/claim", json={"order_id": guest_order["order_id"],
                                                      "access_token": guest_order["access_token"]}, headers=other)
    assert steal.status_code == 403

    upd = client.patch("/api/me", json={"name": "Buyer"}, headers=h).json()
    assert upd["name"] == "Buyer" and upd["shipping_address"]["city"] == "Dakar"
