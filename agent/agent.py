#!/usr/bin/env python3
"""
C-Store Back Office Agent
=========================
Connects to Verifone Commander at https://192.168.31.11
Pulls transaction data and sends it to your cloud dashboard.

Version: 1.1.0
"""

import os
import sys
import time
import json
import logging
import hashlib
import requests
import urllib3
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime, date
from typing import Optional

# Disable SSL warnings — Commander uses a self-signed certificate
# This is normal and expected for local network hardware
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

CONFIG_FILE = Path(__file__).parent / "config.json"
LOG_FILE    = Path(__file__).parent / "agent.log"
VERSION     = "1.1.0"

COMMANDER_IP  = "192.168.31.11"
COMMANDER_URL = f"https://{COMMANDER_IP}"
POLL_INTERVAL = 10  # seconds between checks

# ── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("cstore-agent")


# ── Config ───────────────────────────────────────────────────
def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    return run_setup()


def run_setup() -> dict:
    print("\n" + "="*60)
    print("  C-Store Back Office Agent — Setup")
    print("="*60)
    print()

    dashboard_url = input("Your dashboard URL (e.g. https://yourapp.vercel.app): ").strip().rstrip("/")
    api_key       = input("Your Store API Key: ").strip()
    cmd_user      = input("Commander username (default: CSPPOS): ").strip() or "CSPPOS"
    cmd_pass      = input("Commander password (default: Welcome1234): ").strip() or "Welcome1234"

    config = {
        "dashboard_url":   dashboard_url,
        "api_key":         api_key,
        "commander_url":   COMMANDER_URL,
        "commander_ip":    COMMANDER_IP,
        "commander_user":  cmd_user,
        "commander_pass":  cmd_pass,
        "poll_interval":   POLL_INTERVAL,
        "version":         VERSION,
    }

    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)

    print(f"\n✓ Setup saved.")
    return config


# ── Commander Client ─────────────────────────────────────────
class CommanderClient:
    """
    Connects to the Verifone Commander's built-in web interface
    at https://192.168.31.11 and pulls transaction data.

    The Commander exposes transaction data via its internal
    XML-based reporting API used by all back office software.
    """

    def __init__(self, base_url: str, username: str, password: str):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.session  = requests.Session()
        # Must skip SSL verification — Commander uses self-signed cert
        self.session.verify = False
        self._logged_in = False

    def test_connection(self) -> bool:
        """Check if the Commander is reachable on the network."""
        try:
            r = self.session.get(
                f"{self.base_url}/ConfigClient.html",
                timeout=5,
                verify=False
            )
            return r.status_code in (200, 302, 401)
        except Exception as e:
            log.warning(f"Commander not reachable at {self.base_url}: {e}")
            return False

    def login(self) -> bool:
        """Log into the Commander web interface."""
        try:
            r = self.session.post(
                f"{self.base_url}/api/login",
                json={"username": self.username, "password": self.password},
                verify=False,
                timeout=10
            )
            if r.status_code == 200:
                self._logged_in = True
                log.info("✓ Logged into Commander successfully")
                return True

            # Some Commander versions use form-based login
            r = self.session.post(
                f"{self.base_url}/ConfigClient.html",
                data={"username": self.username, "password": self.password},
                verify=False,
                timeout=10
            )
            if r.status_code in (200, 302):
                self._logged_in = True
                log.info("✓ Logged into Commander (form auth)")
                return True

            log.error(f"Commander login failed: {r.status_code}")
            return False
        except Exception as e:
            log.error(f"Commander login error: {e}")
            return False

    def get_transactions(self, since_date: Optional[str] = None) -> list[dict]:
        """
        Pull transactions from the Commander.
        The Commander provides transaction data via its reporting API.
        Returns a list of parsed transaction dicts.
        """
        transactions = []

        # Method 1: XML transaction report API (standard Commander interface)
        try:
            today = since_date or str(date.today())
            report_url = f"{self.base_url}/api/report/transactions"

            r = self.session.get(
                report_url,
                params={"date": today, "format": "xml"},
                verify=False,
                timeout=30
            )

            if r.status_code == 200 and r.text.strip().startswith("<"):
                transactions = self._parse_xml_report(r.text)
                if transactions:
                    log.info(f"Pulled {len(transactions)} transactions via XML API")
                    return transactions

        except Exception as e:
            log.debug(f"XML API attempt: {e}")

        # Method 2: Transaction log files via Commander file API
        try:
            files_url = f"{self.base_url}/api/backoffice/transactions"
            r = self.session.get(
                files_url,
                verify=False,
                timeout=30
            )
            if r.status_code == 200:
                data = r.json()
                transactions = self._normalize_api_response(data)
                if transactions:
                    log.info(f"Pulled {len(transactions)} transactions via backoffice API")
                    return transactions
        except Exception as e:
            log.debug(f"Backoffice API attempt: {e}")

        # Method 3: SMS Report Navigator (older Commander interface)
        try:
            sms_url = f"{self.base_url}/sms/report"
            r = self.session.get(
                sms_url,
                params={"type": "transaction", "date": str(date.today())},
                verify=False,
                timeout=30
            )
            if r.status_code == 200:
                transactions = self._parse_sms_report(r.text)
                if transactions:
                    log.info(f"Pulled {len(transactions)} transactions via SMS report")
                    return transactions
        except Exception as e:
            log.debug(f"SMS report attempt: {e}")

        return transactions

    def _parse_xml_report(self, xml_text: str) -> list[dict]:
        """Parse the Commander's XML transaction report."""
        transactions = []
        try:
            root = ET.fromstring(xml_text)
            for txn_el in root.findall(".//Transaction") + root.findall(".//TransactionRecord"):
                txn = self._parse_txn_element(txn_el)
                if txn:
                    transactions.append(txn)
        except ET.ParseError as e:
            log.error(f"XML parse error: {e}")
        return transactions

    def _parse_txn_element(self, el) -> Optional[dict]:
        """Parse a single transaction XML element."""
        def txt(tag, default=""):
            node = el.find(f".//{tag}")
            return node.text.strip() if node is not None and node.text else default

        txn_id = txt("TransactionNumber") or txt("TxnID") or txt("SequenceNumber")
        if not txn_id:
            return None

        txn_date = txt("TransactionDate") or txt("Date") or str(date.today())
        txn_time = txt("TransactionTime") or txt("Time") or "00:00:00"
        txn_type_raw = txt("TransactionType") or txt("TxnType") or "SALE"
        is_voided = txt("VoidFlag") in ("Y", "1", "true")

        txn_type = self._normalize_type(txn_type_raw, is_voided)

        # Build datetime
        try:
            if "/" in txn_date:
                dt = datetime.strptime(f"{txn_date} {txn_time}", "%m/%d/%Y %H:%M:%S")
            else:
                dt = datetime.strptime(f"{txn_date} {txn_time}", "%Y-%m-%d %H:%M:%S")
            txn_datetime = dt.isoformat()
        except Exception:
            txn_datetime = datetime.now().isoformat()

        # Line items
        items = []
        for item_el in el.findall(".//LineItem"):
            items.append({
                "line_number":    int(item_el.findtext("LineNumber") or len(items)+1),
                "upc":            (item_el.findtext("UPC") or "").strip(),
                "description":    (item_el.findtext("Description") or "").strip(),
                "quantity":       float(item_el.findtext("Quantity") or 1),
                "unit_price":     float(item_el.findtext("UnitPrice") or 0),
                "extended_price": float(item_el.findtext("ExtendedPrice") or 0),
                "department":     (item_el.findtext("Department") or "").strip(),
                "is_voided":      (item_el.findtext("VoidFlag") or "N") in ("Y","1"),
                "is_fuel":        False,
            })

        for fuel_el in el.findall(".//FuelItem") + el.findall(".//FuelSale"):
            items.append({
                "line_number":           len(items)+1,
                "description":           (fuel_el.findtext("GradeDescription") or "FUEL").strip(),
                "quantity":              1,
                "extended_price":        float(fuel_el.findtext("FuelAmount") or fuel_el.findtext("Amount") or 0),
                "department":            "FUEL",
                "is_voided":             False,
                "is_fuel":               True,
                "fuel_grade":            (fuel_el.findtext("GradeDescription") or fuel_el.findtext("Grade") or "").strip(),
                "fuel_gallons":          float(fuel_el.findtext("Gallons") or 0),
                "fuel_price_per_gallon": float(fuel_el.findtext("PPG") or fuel_el.findtext("PricePerGallon") or 0),
            })

        return {
            "transaction_id":   txn_id,
            "register_id":      txt("TerminalNumber") or txt("RegisterID") or "1",
            "cashier_id":       txt("OperatorID") or txt("CashierID") or "",
            "transaction_type": txn_type,
            "subtotal":         float(txt("SubTotal") or 0),
            "tax":              float(txt("Tax") or 0),
            "total_amount":     float(txt("TransactionTotal") or txt("Total") or 0),
            "change_amount":    float(txt("ChangeAmount") or txt("Change") or 0),
            "tender_type":      (txt("TenderType") or "CASH").upper(),
            "tender_amount":    float(txt("TenderAmount") or 0),
            "transaction_time": txn_datetime,
            "business_date":    txn_date if "-" in txn_date else str(date.today()),
            "shift_number":     int(txt("ShiftNumber") or 0) or None,
            "is_voided":        is_voided,
            "items":            items,
        }

    def _normalize_api_response(self, data) -> list[dict]:
        """Normalize JSON response from Commander API."""
        if isinstance(data, list):
            return [self._parse_txn_dict(t) for t in data if t]
        if isinstance(data, dict) and "transactions" in data:
            return [self._parse_txn_dict(t) for t in data["transactions"] if t]
        return []

    def _parse_txn_dict(self, t: dict) -> dict:
        """Parse a transaction from a Commander JSON response."""
        return {
            "transaction_id":   str(t.get("id") or t.get("transactionNumber") or ""),
            "register_id":      str(t.get("terminalNumber") or t.get("registerId") or "1"),
            "cashier_id":       str(t.get("operatorId") or t.get("cashierId") or ""),
            "transaction_type": self._normalize_type(t.get("type") or t.get("transactionType") or "SALE", False),
            "subtotal":         float(t.get("subtotal") or 0),
            "tax":              float(t.get("tax") or 0),
            "total_amount":     float(t.get("total") or t.get("totalAmount") or 0),
            "change_amount":    float(t.get("change") or 0),
            "tender_type":      (t.get("tenderType") or "CASH").upper(),
            "tender_amount":    float(t.get("tenderAmount") or 0),
            "transaction_time": t.get("time") or t.get("transactionTime") or datetime.now().isoformat(),
            "business_date":    t.get("businessDate") or str(date.today()),
            "shift_number":     t.get("shiftNumber"),
            "is_voided":        bool(t.get("isVoided") or t.get("voided")),
            "items":            [],
        }

    def _parse_sms_report(self, text: str) -> list[dict]:
        """Parse SMS Navigator report format (older Commander versions)."""
        # SMS reports are XML-wrapped — try parsing as XML first
        try:
            return self._parse_xml_report(text)
        except Exception:
            return []

    @staticmethod
    def _normalize_type(raw: str, is_voided: bool) -> str:
        raw = (raw or "").upper().strip()
        if is_voided or "VOID" in raw:  return "VOID"
        if "REFUND" in raw or "RETURN" in raw: return "REFUND"
        if "NO" in raw and "SALE" in raw: return "NO_SALE"
        if "FUEL" in raw: return "FUEL_ONLY"
        return "SALE"


# ── Cloud Sender ─────────────────────────────────────────────
class CloudSender:
    def __init__(self, dashboard_url: str, api_key: str):
        self.url     = dashboard_url.rstrip("/")
        self.headers = {"Content-Type": "application/json", "X-Api-Key": api_key}
        self.session = requests.Session()
        self.session.headers.update(self.headers)

    def heartbeat(self, commander_ip: str) -> bool:
        try:
            r = self.session.post(
                f"{self.url}/api/agent/heartbeat",
                json={"agent_version": VERSION, "commander_ip": commander_ip},
                timeout=10
            )
            return r.status_code == 200
        except Exception as e:
            log.warning(f"Heartbeat failed: {e}")
            return False

    def send(self, transactions: list, commander_ip: str) -> dict:
        try:
            r = self.session.post(
                f"{self.url}/api/agent/ingest",
                json={
                    "transactions":  transactions,
                    "agent_version": VERSION,
                    "commander_ip":  commander_ip,
                },
                timeout=30
            )
            return r.json() if r.status_code == 200 else {"inserted": 0, "error": r.text}
        except Exception as e:
            log.error(f"Send failed: {e}")
            return {"inserted": 0, "error": str(e)}


# ── Seen Transaction Tracker ─────────────────────────────────
class SeenTracker:
    """Remembers which transaction IDs we've already sent today."""
    def __init__(self):
        self.file = Path(__file__).parent / ".seen_transactions"
        self.seen = self._load()
        self._prune_old()

    def _load(self) -> dict:
        if self.file.exists():
            try:
                with open(self.file, "r") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save(self):
        with open(self.file, "w") as f:
            json.dump(self.seen, f)

    def _prune_old(self):
        """Remove entries older than 3 days to keep file small."""
        today = str(date.today())
        self.seen = {k: v for k, v in self.seen.items() if v >= today[:8]}
        self._save()

    def is_new(self, txn_id: str, biz_date: str) -> bool:
        key = f"{biz_date}:{txn_id}"
        return key not in self.seen

    def mark_seen(self, txn_id: str, biz_date: str):
        key = f"{biz_date}:{txn_id}"
        self.seen[key] = biz_date
        self._save()


# ── Main Loop ─────────────────────────────────────────────────
def main():
    log.info(f"C-Store Back Office Agent v{VERSION} starting...")
    config = load_config()

    commander  = CommanderClient(
        config["commander_url"],
        config["commander_user"],
        config["commander_pass"],
    )
    cloud      = CloudSender(config["dashboard_url"], config["api_key"])
    tracker    = SeenTracker()
    poll_secs  = config.get("poll_interval", POLL_INTERVAL)

    log.info(f"Commander: {config['commander_url']}")
    log.info(f"Dashboard: {config['dashboard_url']}")

    # Test Commander connection
    log.info("Testing connection to Commander...")
    if commander.test_connection():
        log.info(f"✓ Commander is reachable at {COMMANDER_IP}")
    else:
        log.warning(
            f"⚠ Cannot reach Commander at {COMMANDER_IP}. "
            "Make sure the ethernet cable is plugged into the Cybera router "
            "and the network route is configured. Will keep retrying..."
        )

    # Test dashboard connection
    if cloud.heartbeat(COMMANDER_IP):
        log.info("✓ Connected to dashboard successfully")
    else:
        log.warning("⚠ Cannot reach dashboard — check your internet connection")

    # Log into Commander
    commander.login()

    errors = 0
    while True:
        try:
            # Pull transactions from Commander
            all_txns = commander.get_transactions()

            # Filter to only ones we haven't sent yet
            new_txns = [
                t for t in all_txns
                if t.get("transaction_id") and
                   tracker.is_new(t["transaction_id"], t.get("business_date", str(date.today())))
            ]

            if new_txns:
                result = cloud.send(new_txns, COMMANDER_IP)
                inserted = result.get("inserted", 0)
                log.info(f"Sent {len(new_txns)} new transactions → {inserted} saved to dashboard")

                for t in new_txns:
                    tracker.mark_seen(
                        t["transaction_id"],
                        t.get("business_date", str(date.today()))
                    )
            else:
                # Nothing new — just send heartbeat
                cloud.heartbeat(COMMANDER_IP)

            errors = 0

        except KeyboardInterrupt:
            log.info("Agent stopped.")
            sys.exit(0)
        except Exception as e:
            errors += 1
            log.error(f"Error ({errors}): {e}")
            if errors > 10:
                log.critical("Too many errors. Waiting 5 minutes...")
                time.sleep(300)
                errors = 0
                commander.login()  # Re-authenticate after long pause

        time.sleep(poll_secs)


if __name__ == "__main__":
    main()
