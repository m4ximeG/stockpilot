"""Tests du connecteur Henrri sans accès réseau ni identifiants réels."""
import os
import unittest
from unittest.mock import patch

import henrri_service as henrri


class HenrriReadOnlyTests(unittest.TestCase):
    def setUp(self):
        henrri._catalog_cache.update(key=None, at=0, items=None)

    def test_no_credentials_disables_integration(self):
        with patch.dict(os.environ, {"HENRRI_CLIENT_ID": "", "HENRRI_CLIENT_SECRET": ""}):
            with patch.object(henrri, "_json_request", side_effect=AssertionError("Network call")):
                result = henrri.valuation([], [])
        self.assertEqual(result["status"], "not_configured")
        self.assertNotIn("client_secret", result)
        self.assertFalse(result["configured"])

    def test_reference_matching_and_partial_price_coverage(self):
        products = [
            {"id": "a", "brand": "TERRA", "model": "1417", "ref": "PC-001"},
            {"id": "b", "brand": "Dell", "model": "Écran", "ref": "ECRAN-002"},
            {"id": "c", "brand": "HP", "model": "Souris", "ref": "INCONNUE"},
        ]
        units = [
            {"pid": "a", "condition": "Neuf"},
            {"pid": "a", "condition": "Neuf"},
            {"pid": "a", "condition": "Retour SAV"},
            {"pid": "b", "condition": "Neuf"},
            {"pid": "c", "condition": "Neuf"},
        ]
        catalog = [
            {"reference": " pc-001 ", "purchasePrice": 300, "sellingPriceWithoutTax": 450},
            {"reference": "ECRAN-002", "purchasePrice": None, "sellingPriceWithoutTax": 150},
        ]
        result = henrri.calculate_valuation(products, units, catalog)
        self.assertEqual(result["purchaseTotal"], 600.0)
        self.assertEqual(result["sellingTotal"], 1050.0)
        self.assertEqual(result["totalProducts"], 3)
        self.assertEqual(result["matchedProducts"], 2)
        self.assertEqual(result["purchasePricedProducts"], 1)
        self.assertEqual(result["sellingPricedProducts"], 2)
        self.assertEqual(result["excludedUnits"], 1)
        self.assertIsNone(result["rows"][2]["purchaseValue"])

    def test_duplicate_reference_is_not_assigned_arbitrarily(self):
        data = henrri.calculate_valuation(
            [{"id": "1", "brand": "HP", "model": "One", "ref": "A"}],
            [{"pid": "1", "condition": "Neuf"}],
            [{"reference": "A", "purchasePrice": 1}, {"reference": "a", "purchasePrice": 100}],
        )
        self.assertEqual(data["matchedProducts"], 0)
        self.assertEqual(data["purchaseTotal"], 0.0)

    def test_catalog_calls_only_post_authenticate_and_get_items(self):
        fake_data = [
            {"accessToken": "temporary-jwt"},
            {"elements": [
                {"id": 42, "reference": "SKU-100", "purchasePrice": 12.5,
                 "sellingPriceWithoutTax": 20.0}
            ]},
        ]
        with patch.dict(os.environ, {
            "HENRRI_CLIENT_ID": "test-client", "HENRRI_CLIENT_SECRET": "test-secret",
            "HENRRI_ENVIRONMENT": "production",
        }):
            with patch.object(henrri, "_json_request", side_effect=fake_data) as fetch:
                result = henrri.valuation(
                    [{"id": "sku", "brand": "ACME", "model": "100", "ref": "SKU-100"}],
                    [{"pid": "sku", "condition": "Neuf"}],
                )
                self.assertEqual(fetch.call_count, 2)
                auth_args = fetch.call_args_list[0]
                item_args = fetch.call_args_list[1]
                self.assertEqual(auth_args.args[0], "https://api.henrri.io/v1/users/authenticate")
                self.assertTrue(item_args.args[0].startswith("https://api.henrri.io/v1/items?"))
                self.assertEqual(item_args.kwargs["bearer"], "temporary-jwt")
                self.assertEqual(result["purchaseTotal"], 12.5)
                self.assertEqual(result["sellingTotal"], 20.0)
                self.assertNotIn("test-secret", repr(result))
            # Un second appel sur le catalogue ne réauthentifie pas pendant 1 h.
            with patch.object(henrri, "_json_request", side_effect=AssertionError("Network call")):
                cached = henrri.valuation(
                    [{"id": "sku", "brand": "ACME", "model": "100", "ref": "SKU-100"}],
                    [{"pid": "sku", "condition": "Neuf"}],
                )
            self.assertEqual(cached["purchaseTotal"], 12.5)

    def test_invalid_environment_never_calls_network(self):
        with patch.dict(os.environ, {
            "HENRRI_CLIENT_ID": "x", "HENRRI_CLIENT_SECRET": "y",
            "HENRRI_ENVIRONMENT": "https://untrusted.example",
        }):
            with patch.object(henrri, "_json_request", side_effect=AssertionError("Network call")):
                with self.assertRaises(henrri.HenrriError):
                    henrri.valuation([], [])


if __name__ == "__main__":
    unittest.main()
