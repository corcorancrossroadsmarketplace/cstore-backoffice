// api/agent/script.js
// GET /api/agent/script
// Serves the agent.py Python script
// Called by the installer to download the agent onto the back office PC

import { setCors } from '../_lib/db.js'

// The full agent.py content embedded so it can be downloaded
// from the dashboard by the installer

const AGENT_SCRIPT = `#!/usr/bin/env python3
"""
C-Store Back Office Agent v1.1.0
Connects to Verifone Commander at https://192.168.31.11
"""
import os, sys, time, json, logging, requests, urllib3, xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime, date
from typing import Optional

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

CONFIG_FILE   = Path(__file__).parent / "config.json"
LOG_FILE      = Path(__file__).parent / "agent.log"
VERSION       = "1.1.0"
COMMANDER_IP  = "192.168.31.11"
COMMANDER_URL = f"https://{COMMANDER_IP}"
POLL_INTERVAL = 10

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("cstore-agent")

def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return run_setup()

def run_setup():
    print("\\n" + "="*50)
    print("  C-Store Agent Setup")
    print("="*50 + "\\n")
    dashboard_url = input("Dashboard URL (e.g. https://yourapp.vercel.app): ").strip().rstrip("/")
    api_key       = input("Store API Key: ").strip()
    cmd_user      = input("Commander username (press Enter for CSPPOS): ").strip() or "CSPPOS"
    cmd_pass      = input("Commander password (press Enter for Welcome1234): ").strip() or "Welcome1234"
    config = {
        "dashboard_url": dashboard_url, "api_key": api_key,
        "commander_url": COMMANDER_URL, "commander_ip": COMMANDER_IP,
        "commander_user": cmd_user, "commander_pass": cmd_pass,
        "poll_interval": POLL_INTERVAL, "version": VERSION,
    }
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)
    print(f"\\n Setup saved. Starting agent...\\n")
    return config

class CommanderClient:
    def __init__(self, base_url, username, password):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.session  = requests.Session()
        self.session.verify = False
        self._logged_in = False

    def test_connection(self):
        try:
            r = self.session.get(f"{self.base_url}/ConfigClient.html", timeout=5, verify=False)
            return r.status_code in (200, 302, 401)
        except Exception as e:
            log.warning(f"Commander not reachable: {e}")
            return False

    def login(self):
        try:
            r = self.session.post(f"{self.base_url}/api/login",
                json={"username": self.username, "password": self.password},
                verify=False, timeout=10)
            if r.status_code == 200:
                self._logged_in = True
                log.info("Logged into Commander")
                return True
            r = self.session.post(f"{self.base_url}/ConfigClient.html",
                data={"username": self.username, "password": self.password},
                verify=False, timeout=10)
            if r.status_code in (200, 302):
                self._logged_in = True
                log.info("Logged into Commander (form auth)")
                return True
            log.error(f"Commander login failed: {r.status_code}")
            return False
        except Exception as e:
            log.error(f"Commander login error: {e}")
            return False

    def get_transactions(self):
        transactions = []
        for url, params in [
            (f"{self.base_url}/api/report/transactions", {"date": str(date.today()), "format": "xml"}),
            (f"{self.base_url}/api/backoffice/transactions", {}),
            (f"{self.base_url}/sms/report", {"type": "transaction", "date": str(date.today())}),
        ]:
            try:
                r = self.session.get(url, params=params, verify=False, timeout=30)
                if r.status_code == 200:
                    if r.text.strip().startswith("<"):
                        txns = self._parse_xml(r.text)
                    else:
                        txns = self._parse_json(r)
                    if txns:
                        log.debug(f"Got {len(txns)} transactions from {url}")
                        return txns
            except Exception as e:
                log.debug(f"Endpoint {url}: {e}")
        return transactions

    def _parse_xml(self, xml_text):
        results = []
        try:
            root = ET.fromstring(xml_text)
            for el in root.findall(".//Transaction") + root.findall(".//TransactionRecord"):
                t = self._parse_el(el)
                if t: results.append(t)
        except Exception as e:
            log.debug(f"XML parse: {e}")
        return results

    def _parse_json(self, r):
        try:
            data = r.json()
            items = data if isinstance(data, list) else data.get("transactions", [])
            return [self._parse_dict(t) for t in items if t]
        except Exception:
            return []

    def _parse_el(self, el):
        def txt(tag, d=""):
            n = el.find(f".//{tag}")
            return n.text.strip() if n is not None and n.text else d
        txn_id = txt("TransactionNumber") or txt("TxnID") or txt("SequenceNumber")
        if not txn_id: return None
        txn_date = txt("TransactionDate") or str(date.today())
        txn_time = txt("TransactionTime") or "00:00:00"
        is_voided = txt("VoidFlag") in ("Y","1","true")
        try:
            fmt = "%m/%d/%Y %H:%M:%S" if "/" in txn_date else "%Y-%m-%d %H:%M:%S"
            txn_dt = datetime.strptime(f"{txn_date} {txn_time}", fmt).isoformat()
        except Exception:
            txn_dt = datetime.now().isoformat()
        items = []
        for item_el in el.findall(".//LineItem"):
            items.append({
                "line_number": int(item_el.findtext("LineNumber") or len(items)+1),
                "upc": (item_el.findtext("UPC") or "").strip(),
                "description": (item_el.findtext("Description") or "").strip(),
                "quantity": float(item_el.findtext("Quantity") or 1),
                "unit_price": float(item_el.findtext("UnitPrice") or 0),
                "extended_price": float(item_el.findtext("ExtendedPrice") or 0),
                "department": (item_el.findtext("Department") or "").strip(),
                "is_voided": (item_el.findtext("VoidFlag") or "N") in ("Y","1"),
                "is_fuel": False,
            })
        for fuel_el in el.findall(".//FuelItem") + el.findall(".//FuelSale"):
            items.append({
                "line_number": len(items)+1,
                "description": (fuel_el.findtext("GradeDescription") or "FUEL").strip(),
                "quantity": 1,
                "extended_price": float(fuel_el.findtext("FuelAmount") or fuel_el.findtext("Amount") or 0),
                "department": "FUEL", "is_voided": False, "is_fuel": True,
                "fuel_grade": (fuel_el.findtext("GradeDescription") or "").strip(),
                "fuel_gallons": float(fuel_el.findtext("Gallons") or 0),
                "fuel_price_per_gallon": float(fuel_el.findtext("PPG") or 0),
            })
        raw = txt("TransactionType") or "SALE"
        t = "VOID" if (is_voided or "VOID" in raw.upper()) else \
            "REFUND" if ("REFUND" in raw.upper() or "RETURN" in raw.upper()) else \
            "NO_SALE" if ("NO" in raw.upper() and "SALE" in raw.upper()) else \
            "FUEL_ONLY" if "FUEL" in raw.upper() else "SALE"
        return {
            "transaction_id": txn_id,
            "register_id": txt("TerminalNumber") or "1",
            "cashier_id": txt("OperatorID") or "",
            "transaction_type": t,
            "subtotal": float(txt("SubTotal") or 0),
            "tax": float(txt("Tax") or 0),
            "total_amount": float(txt("TransactionTotal") or txt("Total") or 0),
            "change_amount": float(txt("ChangeAmount") or 0),
            "tender_type": (txt("TenderType") or "CASH").upper(),
            "tender_amount": float(txt("TenderAmount") or 0),
            "transaction_time": txn_dt,
            "business_date": txn_date if "-" in txn_date else str(date.today()),
            "shift_number": int(txt("ShiftNumber") or 0) or None,
            "is_voided": is_voided,
            "items": items,
        }

    def _parse_dict(self, t):
        return {
            "transaction_id": str(t.get("id") or t.get("transactionNumber") or ""),
            "register_id": str(t.get("terminalNumber") or "1"),
            "cashier_id": str(t.get("operatorId") or ""),
            "transaction_type": "SALE",
            "subtotal": float(t.get("subtotal") or 0),
            "tax": float(t.get("tax") or 0),
            "total_amount": float(t.get("total") or 0),
            "change_amount": float(t.get("change") or 0),
            "tender_type": (t.get("tenderType") or "CASH").upper(),
            "tender_amount": float(t.get("tenderAmount") or 0),
            "transaction_time": t.get("time") or datetime.now().isoformat(),
            "business_date": t.get("businessDate") or str(date.today()),
            "shift_number": t.get("shiftNumber"),
            "is_voided": bool(t.get("isVoided")),
            "items": [],
        }

class CloudSender:
    def __init__(self, url, api_key):
        self.url = url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json", "X-Api-Key": api_key})

    def heartbeat(self, ip):
        try:
            r = self.session.post(f"{self.url}/api/agent/heartbeat",
                json={"agent_version": VERSION, "commander_ip": ip}, timeout=10)
            return r.status_code == 200
        except Exception as e:
            log.warning(f"Heartbeat failed: {e}")
            return False

    def send(self, transactions, ip):
        try:
            r = self.session.post(f"{self.url}/api/agent/ingest",
                json={"transactions": transactions, "agent_version": VERSION, "commander_ip": ip},
                timeout=30)
            return r.json() if r.status_code == 200 else {"inserted": 0, "error": r.text}
        except Exception as e:
            return {"inserted": 0, "error": str(e)}

class SeenTracker:
    def __init__(self):
        self.file = Path(__file__).parent / ".seen_transactions"
        self.seen = self._load()

    def _load(self):
        if self.file.exists():
            try:
                with open(self.file) as f: return json.load(f)
            except Exception: return {}
        return {}

    def _save(self):
        with open(self.file, "w") as f: json.dump(self.seen, f)

    def is_new(self, txn_id, biz_date):
        return f"{biz_date}:{txn_id}" not in self.seen

    def mark_seen(self, txn_id, biz_date):
        self.seen[f"{biz_date}:{txn_id}"] = biz_date
        self._save()

def main():
    log.info(f"C-Store Agent v{VERSION} starting...")
    config    = load_config()
    commander = CommanderClient(config["commander_url"], config["commander_user"], config["commander_pass"])
    cloud     = CloudSender(config["dashboard_url"], config["api_key"])
    tracker   = SeenTracker()
    poll_secs = config.get("poll_interval", POLL_INTERVAL)

    log.info(f"Commander: {config['commander_url']}")
    log.info(f"Dashboard: {config['dashboard_url']}")

    if commander.test_connection():
        log.info(f"Commander is reachable at {COMMANDER_IP}")
    else:
        log.warning(f"Cannot reach Commander at {COMMANDER_IP} — check ethernet cable into Cybera router")

    if cloud.heartbeat(COMMANDER_IP):
        log.info("Connected to dashboard")
    else:
        log.warning("Cannot reach dashboard — check internet connection")

    commander.login()
    errors = 0

    while True:
        try:
            all_txns = commander.get_transactions()
            new_txns = [t for t in all_txns if t.get("transaction_id") and
                        tracker.is_new(t["transaction_id"], t.get("business_date", str(date.today())))]
            if new_txns:
                result = cloud.send(new_txns, COMMANDER_IP)
                log.info(f"Sent {len(new_txns)} transactions -> {result.get('inserted',0)} saved")
                for t in new_txns:
                    tracker.mark_seen(t["transaction_id"], t.get("business_date", str(date.today())))
            else:
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
                commander.login()
        time.sleep(poll_secs)

if __name__ == "__main__":
    main()
`

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  // No auth required — installer needs to download this
  res.setHeader('Content-Type', 'text/plain')
  res.setHeader('Content-Disposition', 'attachment; filename="agent.py"')
  res.status(200).send(AGENT_SCRIPT)
}
