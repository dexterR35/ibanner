"""PosterO-style layout contract: request bounds, prompt shape and SVG parsing (no model)."""
import unittest
from fastapi.testclient import TestClient
from services.sam3_server import create_app
from services.vision.layout import validate_request, build_messages, parse_layout

EXAMPLE = ('<svg width="300" height="250"><rect id="photo_0" x="0" y="100" width="300" height="150"/>'
           '<rect id="logo_0" x="80" y="8" width="140" height="30"/>'
           '<rect id="headline_0" x="20" y="44" width="260" height="30"/></svg>')


def target(**changes):
    return {"id": "BANNER1-300x250", "width": 300, "height": 250,
            "elements": [{"id": "photo_0"}, {"id": "logo_0"}, {"id": "headline_0", "chars": 21, "scenes": [1]}],
            "examples": [{"description": "300x250 reference", "svg": EXAMPLE}], **changes}


class LayoutContractTests(unittest.TestCase):
    def test_request_is_bounded_and_typed(self):
        request = validate_request({"targets": [target()], "samples": 3, "seed": 7})
        self.assertEqual(request["targets"][0]["ids"], ["photo_0", "logo_0", "headline_0"])
        for bad in ({"targets": []}, {"targets": [target(width=10)]},
                    {"targets": [target(elements=[{"id": "headline"}])]},
                    {"targets": [target(examples=[{"svg": "<svg><script>x</script></svg>"}])]},
                    {"targets": [target()], "samples": 9}):
            with self.assertRaises(ValueError):
                validate_request(bad)

    def test_prompt_lists_examples_then_the_new_canvas(self):
        request = validate_request({"targets": [target(width=320, height=480)]})
        messages = build_messages(request["targets"][0])
        user = messages[1]["content"][0]["text"]
        self.assertLess(user.index("Example 1."), user.index("New banner: 320x480"))
        self.assertIn("headline_0 (21 characters; scenes 1)", user)
        self.assertTrue(user.rstrip().endswith('<svg width="320" height="480">.'))

    def test_parse_keeps_requested_ids_and_clamps_into_the_canvas(self):
        request = validate_request({"targets": [target()]})["targets"][0]
        text = ('Sure! <svg width="300" height="250"><rect id="headline_0" width="400" height="30" x="-5" y="44"/>'
                '<rect id="logo_0" x="80" y="8" width="140" height="30"/><rect id="cta_9" x="1" y="1" width="9" height="9"/>'
                '<rect id="photo_0" x="0" y="100" width="300" height="200"/></svg> done')
        parsed = parse_layout(text, request)
        self.assertTrue(parsed["complete"])
        self.assertNotIn("cta_9", parsed["boxes"])
        self.assertEqual(parsed["boxes"]["headline_0"], {"x": 0.0, "y": 44.0, "width": 300.0, "height": 30.0})
        self.assertEqual(parsed["boxes"]["photo_0"]["height"], 150.0)
        self.assertFalse(parse_layout("no svg here", request)["complete"])

    def test_layout_and_roles_routes_are_exposed(self):
        class FakeSam:
            def health(self): return {"ready": False}
        class FakeVision:
            def capabilities(self): return {}
            def run(self, op, payload): return {"operation": op}
        client = TestClient(create_app(FakeSam(), vision=FakeVision()), base_url="http://127.0.0.1:5181")
        for op in ("layout", "roles"):
            self.assertEqual(client.post(f"/vision/{op}", json={}).json(), {"operation": op})


if __name__ == "__main__":
    unittest.main()
