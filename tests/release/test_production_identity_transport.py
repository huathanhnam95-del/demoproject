"""Exercise urllib's real redirect handling with an in-memory transport."""
import importlib.util
import io
import json
import os
import unittest
from argparse import Namespace
from email.message import Message
from pathlib import Path
from unittest.mock import patch
from urllib.response import addinfourl

spec = importlib.util.spec_from_file_location(
    "production_rehearsal", Path(__file__).parents[1] / "browser/bel-demo-online/production_rehearsal.py"
)
rehearsal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rehearsal)


class ProviderTransportTests(unittest.TestCase):
    def run_transport(self, destination=None, status=302):
        calls = []
        responses = []

        def transport(_handler, request):
            calls.append((request.full_url, request.get_header("Authorization")))
            headers = Message()
            headers["Content-Type"] = "application/json"
            code = 200
            if len(calls) == 1 and destination:
                headers["Location"] = destination
                code = status
            response = addinfourl(io.BytesIO(json.dumps({"state": {}}).encode()), headers, request.full_url, code)
            response.msg = "test response"
            responses.append(response)
            return response

        with patch.dict(os.environ, {"BEL_DEPLOYED_IDENTITIES_TOKEN": "test-secret"}), \
             patch("urllib.request.HTTPSHandler.https_open", transport), \
             patch("urllib.request.HTTPHandler.http_open", transport), \
             patch("socket.create_connection", side_effect=AssertionError("network forbidden")):
            if destination:
                with self.assertRaises(rehearsal.RehearsalError):
                    rehearsal.read_deployed_identities_provider(
                        Namespace(deployed_identities_url="https://provider.example/identity"), "test")
            else:
                result = rehearsal.read_deployed_identities_provider(
                    Namespace(deployed_identities_url="https://provider.example/identity"), "test")
                self.assertEqual(result["source"], "https://provider.example/identity")
        self.assertTrue(all(response.closed for response in responses), "provider responses must be closed")
        self.assertEqual(calls, [("https://provider.example/identity", "Bearer test-secret")])

    def test_no_redirect_can_forward_provider_credentials(self):
        for status in (301, 302, 303, 307, 308):
            for destination in ("https://attacker.example/collect", "http://provider.example/identity",
                                "https://provider.example/other", "https://provider.example:444/identity"):
                with self.subTest(status=status, destination=destination):
                    self.run_transport(destination, status)

    def test_direct_https_response_still_works(self):
        self.run_transport()


if __name__ == "__main__":
    unittest.main()
