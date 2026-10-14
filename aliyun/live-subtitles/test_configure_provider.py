import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("configure_provider", Path(__file__).with_name("configure-provider.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProviderSetupTest(unittest.TestCase):
    def test_qianwen_dotted_key_and_matching_url(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "provider.env"
            module.write_config(target, None, "sk-ws-H.synthetic-only")
            content = target.read_text()
            self.assertIn('CHAT_SUBTITLES_BASE_URL="https://maas.qianwenaiapi.com/compatible-mode/v1"', content)
            self.assertIn('CHAT_SUBTITLES_API_KEY="sk-ws-H.synthetic-only"', content)
            self.assertIn('CHAT_SUBTITLES_ENABLED="false"', content)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_private_file_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "provider.env"
            module.write_config(target, "ws-test", "sk-synthetic-only")
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            content = target.read_text()
            self.assertIn('CHAT_SUBTITLES_ENABLED="false"', content)
            self.assertIn('https://ws-test.cn-beijing.maas.aliyuncs.com', content)
            with self.assertRaises(FileExistsError):
                module.write_config(target, "ws-test", "sk-other-synthetic")
            self.assertEqual(target.read_text(), content)

    def test_bad_input_leaves_no_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "provider.env"
            for workspace, key in [(None, "sk-sp-synthetic"), (None, "sk-ws-H.synthetic\n"), ("ws-test", "sk-sp-synthetic"), ("ws-test", "sk-synthetic\n"), ("evil.example", "sk-synthetic-only"), ("", "sk-synthetic-only")]:
                with self.assertRaises(ValueError):
                    module.write_config(target, workspace, key)
                self.assertFalse(target.exists())

    def test_symlink_is_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            existing = Path(directory) / "existing"
            existing.write_text("unchanged")
            link = Path(directory) / "provider.env"
            os.symlink(existing, link)
            with self.assertRaises(FileExistsError):
                module.write_config(link, "ws-test", "sk-synthetic-only")
            self.assertEqual(existing.read_text(), "unchanged")


if __name__ == "__main__":
    unittest.main()
