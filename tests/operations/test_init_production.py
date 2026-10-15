"""No network or real credentials: test the first-install secret file boundary."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "init_production", Path(__file__).resolve().parents[2] / "infrastructure/scripts/init-production.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProductionConfigTests(unittest.TestCase):
    def test_private_complete_configuration_and_unique_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            files = [Path(directory) / name for name in ["first.env", "second.env"]]
            for path in files:
                module.create_config(path, "CHAT.example.com", "admin@example.com")
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            values = [dict(line.split("=", 1) for line in p.read_text().splitlines()) for p in files]
            self.assertEqual(values[0]["APP_ORIGIN"], "https://chat.example.com")
            self.assertEqual(values[0]["OPENAI_API_KEY"], "")
            self.assertEqual(len(values[0]["MASTER_KEY"]), 64)
            for key in ["MASTER_KEY", "POSTGRES_PASSWORD", "ADMIN_PASSWORD"]:
                self.assertNotEqual(values[0][key], values[1][key])

    def test_never_overwrites_an_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("existing secrets")
            with self.assertRaises(FileExistsError):
                module.create_config(path, "chat.example.com", "admin@example.com")
            self.assertEqual(path.read_text(), "existing secrets")

    def test_rejects_unsafe_values_before_creating_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            for domain, email, key in [
                ("https://chat.example.com/path", "admin@example.com", ""),
                ("chat.example.com", "admin@example.com\nINJECTED=yes", ""),
                ("chat.example.com", "admin@example.com", "key\nINJECTED=yes"),
            ]:
                with self.assertRaises(ValueError):
                    module.create_config(path, domain, email, key)
                self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
