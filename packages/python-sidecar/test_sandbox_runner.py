"""
test_sandbox_runner.py — End-to-end tests for sandbox_runner.py.

Spawns sandbox_runner.py as a subprocess and communicates via stdin/stdout
JSON to verify the full protocol end-to-end.

Run with:
    python -m unittest test_sandbox_runner -v
    python test_sandbox_runner.py
"""

import json
import os
import subprocess
import sys
import unittest


# Resolve path to sandbox_runner.py (same directory as this test file)
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_RUNNER = os.path.join(_THIS_DIR, "sandbox_runner.py")


def send_request(proc, request_dict):
    """Send a JSON request to the worker and read one JSON response."""
    line = json.dumps(request_dict) + "\n"
    proc.stdin.write(line)
    proc.stdin.flush()
    response_line = proc.stdout.readline()
    return json.loads(response_line)


def _spawn():
    """Spawn a fresh sandbox_runner.py subprocess."""
    return subprocess.Popen(
        [sys.executable, "-u", _RUNNER],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )


class TestSandboxRunner(unittest.TestCase):
    """Integration tests against a single long-lived sandbox_runner subprocess."""

    @classmethod
    def setUpClass(cls):
        cls.proc = _spawn()

    @classmethod
    def tearDownClass(cls):
        cls.proc.stdin.close()
        cls.proc.terminate()
        cls.proc.wait(timeout=5)

    # ------------------------------------------------------------------
    # Happy-path tests
    # ------------------------------------------------------------------

    def test_happy_path_returns_true(self):
        """Success response with correct outputs when execute() returns True."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    outputs["greeting"] = "hello " + inputs.get("name", "world")\n'
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {
                "request_id": "t-happy",
                "source_code": source,
                "inputs": {"name": "Alice"},
                "outputs": {},
            },
        )
        self.assertTrue(resp["success"])
        self.assertTrue(resp["return_value"])
        self.assertEqual(resp["outputs"]["greeting"], "hello Alice")

    def test_return_false_for_hold(self):
        """Return value False signals code-initiated hold; success is still True."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            "    return False\n"
        )
        resp = send_request(
            self.proc,
            {"request_id": "t-false", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertTrue(resp["success"])
        self.assertFalse(resp["return_value"])

    # ------------------------------------------------------------------
    # Error-path tests
    # ------------------------------------------------------------------

    def test_syntax_error(self):
        """Syntax errors in user code produce error_type SYNTAX_ERROR."""
        # Missing colon after function signature
        source = "def execute(inputs, outputs, props, action_props)\n    return True\n"
        resp = send_request(
            self.proc,
            {"request_id": "t-syntax", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error_type"], "SYNTAX_ERROR")
        self.assertIn("SyntaxError", resp["error"])
        self.assertTrue(len(resp["traceback"]) > 0)

    def test_runtime_error(self):
        """Runtime exceptions produce error_type RUNTIME_ERROR with details."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    raise ValueError("bad input")\n'
        )
        resp = send_request(
            self.proc,
            {"request_id": "t-runtime", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error_type"], "RUNTIME_ERROR")
        self.assertIn("ValueError", resp["error"])
        self.assertIn("bad input", resp["error"])
        self.assertTrue(len(resp["traceback"]) > 0)

    def test_missing_execute_function(self):
        """Code without execute() function produces RUNTIME_ERROR mentioning 'execute'."""
        source = "x = 42\n"
        resp = send_request(
            self.proc,
            {"request_id": "t-noexec", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error_type"], "RUNTIME_ERROR")
        self.assertIn("execute", resp["error"])

    # ------------------------------------------------------------------
    # Capture tests
    # ------------------------------------------------------------------

    def test_stdout_capture(self):
        """print() output is captured in stdout_capture, not mixed into JSON protocol."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    print("debug info")\n'
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {"request_id": "t-stdout", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertTrue(resp["success"])
        self.assertEqual(resp["stdout_capture"], "debug info\n")

    def test_stderr_capture(self):
        """stderr output (print(..., file=sys.stderr)) is captured in stderr_capture."""
        source = (
            "import sys\n"
            "def execute(inputs, outputs, props, action_props):\n"
            '    print("warning", file=sys.stderr)\n'
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {"request_id": "t-stderr", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertTrue(resp["success"])
        self.assertEqual(resp["stderr_capture"], "warning\n")

    # ------------------------------------------------------------------
    # Outputs accumulation tests
    # ------------------------------------------------------------------

    def test_outputs_mutation(self):
        """User code mutations to outputs dict are reflected in the response."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    outputs["a"] = "1"\n'
            '    outputs["b"] = "2"\n'
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {"request_id": "t-mut", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertTrue(resp["success"])
        self.assertEqual(resp["outputs"], {"a": "1", "b": "2"})

    def test_outputs_accumulation(self):
        """Accumulated outputs from prior states are passed through and extendable."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    outputs["new"] = outputs.get("prior", "") + "_extended"\n'
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {
                "request_id": "t-accum",
                "source_code": source,
                "inputs": {},
                "outputs": {"prior": "value"},
            },
        )
        self.assertTrue(resp["success"])
        self.assertEqual(resp["outputs"]["prior"], "value")
        self.assertEqual(resp["outputs"]["new"], "value_extended")

    def test_outputs_preserved_on_runtime_error(self):
        """Outputs mutations made before a raise survive into the error response.

        Bug: previously the RUNTIME_ERROR branch returned outputs: {}, so user
        code that set outputs['status']='1' then raised would lose that status
        — the engine had no way to know what the action achieved before failure.
        """
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    outputs["status"] = "1"\n'
            '    outputs["progress"] = "reached"\n'
            '    raise RuntimeError("boom")\n'
        )
        resp = send_request(
            self.proc,
            {
                "request_id": "t-mut-on-raise",
                "source_code": source,
                "inputs": {},
                "outputs": {},
            },
        )
        self.assertFalse(resp["success"])
        self.assertEqual(resp["error_type"], "RUNTIME_ERROR")
        self.assertIn("RuntimeError", resp["error"])
        self.assertIn("boom", resp["error"])
        self.assertEqual(resp["outputs"], {"status": "1", "progress": "reached"})

    # ------------------------------------------------------------------
    # Worker loop / protocol tests
    # ------------------------------------------------------------------

    def test_multiple_sequential_requests(self):
        """Worker handles multiple sequential requests without restarting."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    outputs["n"] = inputs.get("n", "?")\n'
            "    return True\n"
        )
        for i in range(3):
            resp = send_request(
                self.proc,
                {
                    "request_id": f"t-multi-{i}",
                    "source_code": source,
                    "inputs": {"n": str(i)},
                    "outputs": {},
                },
            )
            self.assertTrue(resp["success"], f"Request {i} failed")
            self.assertEqual(resp["outputs"]["n"], str(i), f"Wrong output for request {i}")

    def test_execution_time_ms(self):
        """execution_time_ms is a non-negative number."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {"request_id": "t-timing", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertTrue(resp["success"])
        self.assertIsInstance(resp["execution_time_ms"], (int, float))
        self.assertGreaterEqual(resp["execution_time_ms"], 0)

    def test_request_id_passthrough(self):
        """Response request_id matches the sent request_id."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {"request_id": "my-test-id", "source_code": source, "inputs": {}, "outputs": {}},
        )
        self.assertEqual(resp["request_id"], "my-test-id")

    def test_props_and_action_props_passed(self):
        """environment_action_properties and action_properties are accessible in user code."""
        source = (
            "def execute(inputs, outputs, props, action_props):\n"
            '    outputs["env_prop"] = str(props.get("Config", {}).get("Host", ""))\n'
            '    outputs["act_prop"] = str(action_props.get("Setting", {}).get("Value", ""))\n'
            "    return True\n"
        )
        resp = send_request(
            self.proc,
            {
                "request_id": "t-props",
                "source_code": source,
                "inputs": {},
                "outputs": {},
                "environment_action_properties": {"Config": {"Host": "my-host"}},
                "action_properties": {"Setting": {"Value": "my-value"}},
            },
        )
        self.assertTrue(resp["success"])
        self.assertEqual(resp["outputs"]["env_prop"], "my-host")
        self.assertEqual(resp["outputs"]["act_prop"], "my-value")

    def test_invalid_json_request(self):
        """Non-JSON input produces an error response with request_id null, not a crash."""
        # Write invalid JSON directly to the process stdin
        self.proc.stdin.write("this is not json\n")
        self.proc.stdin.flush()
        response_line = self.proc.stdout.readline()
        resp = json.loads(response_line)
        self.assertFalse(resp["success"])
        self.assertIsNone(resp["request_id"])
        self.assertEqual(resp["error_type"], "RUNTIME_ERROR")


if __name__ == "__main__":
    unittest.main(verbosity=2)
