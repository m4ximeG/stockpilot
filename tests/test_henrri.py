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


    def test_search_by_name_and_reference_returns_prices(self):
        catalog = [
            {"id": 1, "reference": "SOU-01", "description": "Souris Logitech sans fil",
             "purchasePrice": 12.4, "sellingPriceWithoutTax": 21.5,
             "sellingPriceWithTax": 25.8, "vatPercent": 20},
            {"id": 2, "reference": "PC-888", "description": "TERRA PC fixe",
             "purchasePrice": 500, "sellingPriceWithoutTax": 720},
            {"id": 3, "reference": "SOUS-77", "description": "Sous-main bureau",
             "purchasePrice": 4, "sellingPriceWithoutTax": 9},
        ]
        with patch.dict(os.environ, {"HENRRI_CLIENT_ID": "test", "HENRRI_CLIENT_SECRET": "test"}):
            with patch.object(henrri, "_catalog", return_value=(catalog, 10)) as loader:
                results = henrri.search_items("souris")
                self.assertEqual(len(results), 1)
                self.assertEqual(results[0]["reference"], "SOU-01")
                self.assertEqual(results[0]["purchasePrice"], 12.4)
                self.assertEqual(results[0]["sellingPrice"], 21.5)
                self.assertEqual(results[0]["sellingPriceTtc"], 25.8)
                self.assertEqual(henrri.search_items("pc-888")[0]["description"], "TERRA PC fixe")
                self.assertEqual(henrri.search_items("sou")[0]["id"], "1")
                loader.assert_called()
                self.assertNotIn("test", repr(results))

    def test_henrri_item_by_id_is_validated_on_server(self):
        catalog = [
            {"id": 17, "reference": "MON-17", "description": "Écran 27 pouces",
             "purchasePrice": 99.0, "sellingPriceWithoutTax": 160.0},
            {"id": 18, "reference": "", "description": "Adaptateur USB C",
             "purchasePrice": 5, "sellingPriceWithoutTax": 12},
        ]
        with patch.dict(os.environ, {"HENRRI_CLIENT_ID": "test", "HENRRI_CLIENT_SECRET": "test"}):
            with patch.object(henrri, "_catalog", return_value=(catalog, 10)):
                self.assertEqual(henrri.find_item("17")["reference"], "MON-17")
                self.assertEqual(henrri.find_item("18")["reference"], "HENRRI-ID-18")
                with self.assertRaises(henrri.HenrriError):
                    henrri.find_item("19")
        self.assertEqual(henrri.calculate_valuation(
            [{"id": "local-18", "brand": "", "model": "Adaptateur", "ref": "HENRRI-ID-18"}],
            [{"pid": "local-18", "condition": "Neuf"}], catalog
        )["matchedProducts"], 1)

    def test_search_is_read_only_and_ignores_groups(self):
        catalog = [
            {"id": 40, "reference": "PACK", "description": "Pack imprimante", "isAGroup": True},
            {"id": 41, "reference": "IMP-1", "description": "Imprimante laser",
             "purchasePrice": 0, "sellingPriceWithoutTax": 95},
        ]
        with patch.dict(os.environ, {"HENRRI_CLIENT_ID": "test", "HENRRI_CLIENT_SECRET": "test"}):
            with patch.object(henrri, "_catalog", return_value=(catalog, 3)):
                results = henrri.search_items("imp")
                self.assertEqual([r["id"] for r in results], ["41"])
                self.assertEqual(results[0]["purchasePrice"], 0.0)

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
