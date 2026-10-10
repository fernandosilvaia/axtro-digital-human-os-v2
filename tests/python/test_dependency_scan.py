from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCANNER = ROOT / "scripts" / "dependency_scan.py"


class DependencyScanTests(unittest.TestCase):
    def test_empty_corpus_cannot_claim_a_clean_regression_result(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory)
            self._write_locks(fixture)
            advisory_path = fixture / "advisories.json"
            advisory_path.write_text(json.dumps({"schema_version": "1.0.0", "advisories": []}), encoding="utf-8")
            completed = self._run_fixture(fixture, advisory_path)
            self.assertNotEqual(0, completed.returncode)
            self.assertIn("cannot be empty", completed.stdout)

    def test_committed_corpus_blocks_known_vulnerable_versions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory)
            self._write_locks(fixture)
            advisory_path = ROOT / "security" / "dependency-advisories.json"
            # 16.3.6 deixou de ser "limpo" quando o advisory de SSRF na
            # otimização de imagem (GHSA-cjq9-62q9-8jv4) saiu, corrigido em 16.3.8.
            for package, vulnerable, patched in (
                ("next", "16.3.0", "16.3.8"),
                ("next", "16.3.6", "16.3.8"),
                ("sharp", "0.35.3", "0.35.4"),
                ("source-map-js", "1.2.1", "1.2.2"),
            ):
                for version, expected_clean in ((vulnerable, False), (patched, True)):
                    (fixture / "pnpm-lock.yaml").write_text(
                        f"lockfileVersion: '9.0'\n\npackages:\n  '{package}@{version}':\n    resolution: {{integrity: sha512-test}}\n",
                        encoding="utf-8",
                    )
                    completed = self._run_fixture(fixture, advisory_path)
                    self.assertEqual(expected_clean, completed.returncode == 0, completed.stdout + completed.stderr)

    def test_committed_locks_pass_the_deterministic_gate(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(SCANNER)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(0, completed.returncode, completed.stdout + completed.stderr)
        self.assertIn("DEPENDENCY SCAN PASSED", completed.stdout)

    def test_high_and_critical_findings_block_but_moderate_does_not(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory)
            self._write_locks(fixture)
            advisory_path = fixture / "advisories.json"
            for severity in ("high", "critical"):
                self._write_advisories(advisory_path, severity)
                blocking = self._run_fixture(fixture, advisory_path)
                self.assertNotEqual(0, blocking.returncode)
                self.assertIn("DEPENDENCY SCAN FAILED", blocking.stdout)
                self.assertIn("AXTRO-DEPENDENCY-001", blocking.stdout)

            self._write_advisories(advisory_path, "moderate")
            moderate = self._run_fixture(fixture, advisory_path)
            self.assertEqual(0, moderate.returncode, moderate.stdout + moderate.stderr)

    def test_malformed_snapshot_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory)
            self._write_locks(fixture)
            advisory_path = fixture / "advisories.json"
            advisory_path.write_text("{not-json", encoding="utf-8")
            completed = self._run_fixture(fixture, advisory_path)
            self.assertNotEqual(0, completed.returncode)
            self.assertIn("DEPENDENCY SCAN FAILED", completed.stdout)
            self.assertIn("unreadable", completed.stdout)

    def test_peer_dependency_blocks_are_not_misread_as_package_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory)
            (fixture / "pnpm-lock.yaml").write_text(
                "lockfileVersion: '9.0'\n\n"
                "packages:\n"
                "  'safe-package@1.0.0':\n"
                "    resolution: {integrity: sha512-test}\n"
                "    peerDependencies:\n"
                "      react: '>=19'\n"
                "    peerDependenciesMeta:\n"
                "      '@opentelemetry/api':\n"
                "        optional: true\n",
                encoding="utf-8",
            )
            (fixture / "uv.lock").write_text(
                'version = 1\n\n[[package]]\nname = "safe-package"\nversion = "1.0.0"\nsource = { registry = "https://example.invalid/simple" }\n',
                encoding="utf-8",
            )
            advisory_path = fixture / "advisories.json"
            self._write_advisories(advisory_path, "high")
            completed = self._run_fixture(fixture, advisory_path)
            self.assertEqual(0, completed.returncode, completed.stdout + completed.stderr)
            self.assertIn("DEPENDENCY SCAN PASSED", completed.stdout)

    def test_ci_runs_the_dependency_gate_before_workspace_install(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "docs-qa.yml").read_text(encoding="utf-8")
        scan_index = workflow.index("python3 scripts/dependency_scan.py")
        install_index = workflow.index("pnpm install --frozen-lockfile")
        self.assertLess(scan_index, install_index)
        audit_index = workflow.index("run: pnpm audit --audit-level high")
        self.assertLess(audit_index, install_index)
        self.assertNotIn("continue-on-error", workflow[scan_index:install_index])

    def test_python_ci_exports_the_frozen_lock_and_audits_without_bypass(self) -> None:
        import yaml
        workflow = yaml.safe_load((ROOT / ".github/workflows/docs-qa.yml").read_text(encoding="utf-8"))
        steps = workflow["jobs"]["validate-foundation"]["steps"]
        audit = next(step for step in steps if "uvx pip-audit" in step.get("run", ""))
        self.assertNotIn("continue-on-error", audit)
        command = audit["run"]
        self.assertIn("uv export --frozen --all-groups", command)
        self.assertIn("--no-emit-project --no-emit-workspace", command)
        self.assertIn("uvx pip-audit==2.10.1", command)
        self.assertIn("--disable-pip --no-deps", command)
        for bypass in ("--ignore-vuln", "||", "--no-audit"):
            self.assertNotIn(bypass, command)

    def test_python_export_contains_locked_fixed_pytest_and_no_local_projects(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            exported = Path(temporary_directory) / "requirements.txt"
            completed = subprocess.run(["uv", "export", "--frozen", "--offline", "--all-groups",
                "--format", "requirements-txt", "--no-hashes", "--no-emit-project", "--no-emit-workspace",
                "--output-file", str(exported)], cwd=ROOT, text=True, capture_output=True, check=False)
            self.assertEqual(0, completed.returncode, completed.stdout + completed.stderr)
            requirements = exported.read_text(encoding="utf-8")
            self.assertIn("pytest==9.0.3", requirements)
            self.assertNotIn("pytest==8.4.2", requirements)
            self.assertNotIn("-e ", requirements)
            self.assertNotIn("file://", requirements)

    def _run_fixture(self, fixture: Path, advisory_path: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCANNER), "--root", str(fixture), "--advisories", str(advisory_path)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def _write_locks(self, fixture: Path) -> None:
        (fixture / "pnpm-lock.yaml").write_text(
            "lockfileVersion: '9.0'\n\npackages:\n  'vulnerable-package@1.2.3':\n    resolution: {integrity: sha512-test}\n",
            encoding="utf-8",
        )
        (fixture / "uv.lock").write_text(
            'version = 1\n\n[[package]]\nname = "safe-package"\nversion = "1.0.0"\nsource = { registry = "https://example.invalid/simple" }\n',
            encoding="utf-8",
        )

    def _write_advisories(self, path: Path, severity: str) -> None:
        path.write_text(
            json.dumps(
                {
                    "schema_version": "1.0.0",
                    "advisories": [
                        {
                            "id": "AXTRO-DEPENDENCY-001",
                            "ecosystem": "npm",
                            "package": "vulnerable-package",
                            "affected_versions": ["1.2.3"],
                            "severity": severity,
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )


if __name__ == "__main__":
    unittest.main()
