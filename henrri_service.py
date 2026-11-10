"""Henrri: lecture seule du catalogue pour valoriser le stock StockPilot.

Aucune écriture dans Henrri ou dans la base StockPilot. Les clés restent
exclusivement dans les variables d'environnement du serveur Docker.
"""
import json
import os
import threading
import time
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API_URLS = {
    "sandbox": "https://api-sandbox.henrri.io",
    "production": "https://api.henrri.io",
}
CACHE_SECONDS = 3600
MAX_PAGES = 50
PAGE_SIZE = 100
_cache_lock = threading.Lock()
_catalog_cache = {"key": None, "at": 0, "items": None}


class HenrriError(Exception):
    """Erreur sûre à afficher, sans révéler les identifiants ou les réponses brutes."""


def config():
    client_id = os.environ.get("HENRRI_CLIENT_ID", "").strip()
    client_secret = os.environ.get("HENRRI_CLIENT_SECRET", "").strip()
    environment = os.environ.get("HENRRI_ENVIRONMENT", "sandbox").strip().lower()
    return {
        "configured": bool(client_id and client_secret),
        "environment": environment,
        "client_id": client_id,
        "client_secret": client_secret,
    }


def public_status():
    value = config()
    return {
        "configured": value["configured"],
        "environment": value["environment"],
        "status": "ready" if value["configured"] else "not_configured",
    }


def _json_request(url, payload=None, bearer=None):
    """Seul POST d'authentification ; toutes les requêtes métier sont GET."""
    headers = {"Accept": "application/json", "X-Version": "1.0"}
    method = "GET"
    body = None
    if payload is not None:
        method = "POST"
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    if bearer:
        headers["Authorization"] = "Bearer " + bearer
    req = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(req, timeout=12) as response:
            # Pas de récupération illimitée des données d'un service extérieur.
            raw = response.read(6 * 1024 * 1024 + 1)
        if len(raw) > 6 * 1024 * 1024:
            raise HenrriError("Réponse Henrri trop volumineuse.")
        return json.loads(raw)
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise HenrriError("Accès Henrri refusé : vérifiez les clés et leur environnement.") from None
        if exc.code == 429:
            raise HenrriError("Limite de requêtes Henrri atteinte. Réessayez plus tard.") from None
        raise HenrriError("Henrri ne répond pas correctement (HTTP %s)." % exc.code) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise HenrriError("Connexion à Henrri indisponible ou réponse invalide.") from None


def _fetch_catalog(settings):
    base = API_URLS.get(settings["environment"])
    if not base:
        raise HenrriError("HENRRI_ENVIRONMENT doit être sandbox ou production.")
    token = _json_request(
        base + "/v1/users/authenticate",
        {"clientId": settings["client_id"], "clientSecret": settings["client_secret"]},
    )
    access_token = token.get("accessToken") or token.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise HenrriError("Authentification Henrri : jeton absent.")
    items = []
    seen_pages = set()
    for page in range(1, MAX_PAGES + 2):
        response = _json_request(
            base + "/v1/items?" + urlencode({"page": page, "limit": PAGE_SIZE}),
            bearer=access_token,
        )
        if isinstance(response, dict):
            batch = response.get("elements")
            if batch is None:
                batch = response.get("data")
        else:
            batch = response
        if not isinstance(batch, list):
            raise HenrriError("Format du catalogue Henrri non reconnu.")
        if not batch:
            return items
        # Empêche de produire un total partiel si le serveur ignore la pagination.
        first_id = str(batch[0].get("id", "")) if isinstance(batch[0], dict) else ""
        marker = (len(batch), first_id)
        if marker in seen_pages:
            raise HenrriError("Pagination du catalogue Henrri incohérente.")
        seen_pages.add(marker)
        items.extend(batch)
        if len(batch) < PAGE_SIZE:
            return items
    raise HenrriError("Catalogue Henrri trop volumineux pour une valorisation fiable.")


def _catalog(settings, force=False):
    # La clé n'est jamais envoyée au navigateur ni enregistrée en base.
    key = (settings["client_id"], settings["client_secret"], settings["environment"])
    now = time.time()
    with _cache_lock:
        if not force and _catalog_cache["key"] == key and _catalog_cache["items"] is not None \
                and now - _catalog_cache["at"] < CACHE_SECONDS:
            return _catalog_cache["items"], _catalog_cache["at"]
        items = _fetch_catalog(settings)
        _catalog_cache.update(key=key, at=time.time(), items=items)
        return items, _catalog_cache["at"]


def _money(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not amount.is_finite() or amount <= 0:
        return None
    return amount


def _amount(value):
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _reference(value):
    return str(value or "").strip().casefold()


def calculate_valuation(products, stock_items, catalog):
    """Rapproche les références, jamais les noms ; les montants inconnus restent inconnus."""
    by_reference = {}
    ambiguous = set()
    for item in catalog:
        if not isinstance(item, dict):
            continue
        ref = _reference(item.get("reference"))
        if not ref:
            continue
        if ref in by_reference:
            ambiguous.add(ref)
        by_reference[ref] = item
    for ref in ambiguous:
        by_reference.pop(ref, None)

    quantities = {}
    excluded = 0
    for item in stock_items:
        condition = str(item.get("condition", "")).casefold()
        if "sav" in condition or "répar" in condition or "repar" in condition:
            excluded += 1
            continue
        pid = item.get("pid")
        quantities[pid] = quantities.get(pid, 0) + 1

    purchase_total = Decimal("0")
    selling_total = Decimal("0")
    rows = []
    matched = 0
    purchase_priced = 0
    selling_priced = 0
    for p in products:
        qty = quantities.get(p["id"], 0)
        if not qty:
            continue
        found = by_reference.get(_reference(p.get("ref")))
        purchase = _money(found.get("purchasePrice", found.get("purchase_price"))) if found else None
        selling = _money(found.get("sellingPriceWithoutTax", found.get("selling_price_without_tax"))) if found else None
        if found:
            matched += 1
        if purchase is not None:
            purchase_priced += 1
            purchase_total += purchase * qty
        if selling is not None:
            selling_priced += 1
            selling_total += selling * qty
        rows.append({
            "reference": p.get("ref", ""),
            "name": (p.get("brand", "") + " " + p.get("model", "")).strip(),
            "quantity": qty,
            "matched": bool(found),
            "purchaseUnit": _amount(purchase) if purchase is not None else None,
            "sellingUnit": _amount(selling) if selling is not None else None,
            "purchaseValue": _amount(purchase * qty) if purchase is not None else None,
            "sellingValue": _amount(selling * qty) if selling is not None else None,
        })
    return {
        "purchaseTotal": _amount(purchase_total),
        "sellingTotal": _amount(selling_total),
        "matchedProducts": matched,
        "purchasePricedProducts": purchase_priced,
        "sellingPricedProducts": selling_priced,
        "totalProducts": len(rows),
        "excludedUnits": excluded,
        "rows": rows,
    }



def _catalog_reference(item):
    """Référence de facturation, ou clé locale stable si Henrri n'en fournit aucune."""
    reference = str(item.get("reference") or "").strip()
    if reference:
        return reference[:80]
    identifier = str(item.get("id") or "").strip()
    if not identifier or len(identifier) > 60:
        return ""
    return "HENRRI-ID-" + identifier


def _product_result(item):
    """Exposition limitée aux attributs de l'article, sans jeton ni credentials."""
    reference = _catalog_reference(item)
    description = str(item.get("description") or "").strip()
    if not reference or not description or item.get("isAGroup", item.get("is_a_group", False)):
        return None
    def price(*keys):
        raw = next((item[key] for key in keys if key in item), None)
        amount = _money(raw)
        # Le prix zéro est un prix défini (article offert).
        if amount is None and raw in (0, 0.0, "0", "0.00"):
            return 0.0
        return _amount(amount) if amount is not None else None
    return {
        "id": str(item.get("id") or ""),
        "reference": reference,
        "description": description[:120],
        "purchasePrice": price("purchasePrice", "purchase_price"),
        "sellingPrice": price("sellingPriceWithoutTax", "selling_price_without_tax"),
        "sellingPriceTtc": price("sellingPriceWithTax", "selling_price_with_tax"),
        "vatPercent": price("vatPercent", "vat_percent"),
    }


def search_items(query, limit=8):
    """Recherche le catalogue Henrri sans l'écrire ni l'enregistrer en base."""
    if not isinstance(query, str) or len(query.strip()) < 2 or len(query) > 120:
        return []
    settings = config()
    if not settings["configured"]:
        raise HenrriError("Henrri n'est pas configuré.")
    catalog, _ = _catalog(settings)
    needle = query.strip().casefold()
    terms = needle.split()
    ranked = []
    for item in catalog:
        if not isinstance(item, dict):
            continue
        result = _product_result(item)
        if not result or not result["id"]:
            continue
        ref = result["reference"].casefold()
        name = result["description"].casefold()
        if not all(t in (ref + " " + name) for t in terms):
            continue
        rank = (0 if ref == needle else
                1 if ref.startswith(needle) else
                2 if name.startswith(needle) else
                3 if needle in ref else 4)
        ranked.append((rank, name, result))
    ranked.sort(key=lambda value: (value[0], value[1]))
    return [row[2] for row in ranked[:max(1, min(int(limit), 20))]]


def find_item(identifier):
    """Vérifie côté serveur la sélection du catalogue avant une entrée locale."""
    settings = config()
    if not settings["configured"]:
        raise HenrriError("Henrri n'est pas configuré.")
    if not identifier or len(str(identifier)) > 80:
        raise HenrriError("Identifiant Henrri invalide.")
    catalog, _ = _catalog(settings)
    for item in catalog:
        if isinstance(item, dict) and str(item.get("id")) == str(identifier):
            result = _product_result(item)
            if result:
                return result
    raise HenrriError("Article Henrri introuvable. Actualisez la recherche.")

def valuation(products, stock_items, force=False):
    settings = config()
    result = public_status()
    if not result["configured"]:
        return result
    catalog, fetched_at = _catalog(settings, force)
    result.update(
        status="connected",
        updatedAt=int(fetched_at * 1000),
        **calculate_valuation(products, stock_items, catalog),
    )
    return result
