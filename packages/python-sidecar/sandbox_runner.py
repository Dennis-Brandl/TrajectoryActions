"""
sandbox_runner.py — Python sidecar worker subprocess.

Reads JSON execution requests from stdin one line at a time, executes
user-written Python code via compile()+exec(), captures stdout/stderr,
and writes JSON responses to stdout. Handles multiple sequential requests
in a long-lived worker loop without restarting.

Protocol: ExecutionEngineSpec.md §2.2
"""

import sys
import json
import io
import contextlib
import traceback
import time

# Cap stdout/stderr capture to prevent memory issues from chatty code (~64KB)
MAX_OUTPUT_BYTES = 64 * 1024


class _PropertyWriteError(RuntimeError):
    """Raised by set_property() when the write target is invalid."""
    pass


def run_user_code(source_code, inputs, outputs, props, action_props):
    """
    Compile and execute user-written Python code.

    Steps:
      1. compile() — raises SyntaxError on structural issues
      2. exec() the compiled code to define execute() in a namespace
      3. Call execute(inputs, outputs, props, action_props)
      4. Return (return_value, stdout_text, stderr_text)

    The outputs dict is passed by reference; user code may mutate it.
    stdout/stderr are captured and capped at MAX_OUTPUT_BYTES.

    Raises:
        SyntaxError:   if source_code cannot be compiled
        RuntimeError:  if execute() is not defined or not callable
        Exception:     any exception raised by user code
    """
    # Step 1: compile first so SyntaxError is distinct from RuntimeError
    code_obj = compile(source_code, "<action_code>", "exec")

    # Step 2: set up capture buffers
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    # Step 3: create namespace with full builtins access
    namespace = {"__builtins__": __builtins__}

    # Step 4: exec the compiled code (defines execute() in the namespace)
    with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
        exec(code_obj, namespace)  # noqa: S102

    # Step 5: extract execute() function
    execute_fn = namespace.get("execute")
    if not callable(execute_fn):
        raise RuntimeError(
            "User code must define a callable 'execute' function"
        )

    # Step 6: call execute(inputs, outputs, props, action_props) with capture still active
    with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
        return_value = execute_fn(inputs, outputs, props, action_props)

    # Step 7: read and cap captured output
    stdout_text = stdout_buf.getvalue()
    stderr_text = stderr_buf.getvalue()

    if len(stdout_text.encode("utf-8")) > MAX_OUTPUT_BYTES:
        stdout_text = stdout_text.encode("utf-8")[:MAX_OUTPUT_BYTES].decode(
            "utf-8", errors="replace"
        ) + "\n[stdout truncated]"

    if len(stderr_text.encode("utf-8")) > MAX_OUTPUT_BYTES:
        stderr_text = stderr_text.encode("utf-8")[:MAX_OUTPUT_BYTES].decode(
            "utf-8", errors="replace"
        ) + "\n[stderr truncated]"

    # Step 8: return tuple
    return return_value, stdout_text, stderr_text


def run_user_code_with_mutations(source_code, inputs, outputs, props, action_props):
    """
    Same as run_user_code but also returns the property_mutations list
    populated by user-code calls to set_property(spec, entry, value).

    Returns: (return_value, stdout_text, stderr_text, mutations)

    Raises:
        SyntaxError:         if source_code cannot be compiled
        RuntimeError:        if execute() is not defined or not callable
        _PropertyWriteError: if set_property() is called with an unknown spec_name
        Exception:           any other exception raised by user code
    """
    # Step 1: compile first so SyntaxError is distinct from RuntimeError
    code_obj = compile(source_code, "<action_code>", "exec")

    # Step 2: set up capture buffers
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    # Step 3: build mutation log and set_property closure
    mutations = []

    def set_property(spec_name, entry_name, value):
        if not isinstance(spec_name, str):
            raise TypeError("spec_name must be str")
        if not isinstance(entry_name, str):
            raise TypeError("entry_name must be str")
        if not isinstance(value, str):
            raise TypeError("value must be str")
        if spec_name not in props:
            raise _PropertyWriteError(f"unknown property: {spec_name!r}")
        # Permissive: entry_name is created if missing
        props[spec_name][entry_name] = value
        mutations.append({"spec_name": spec_name, "entry_name": entry_name, "value": value})

    # Step 4: create namespace — same builtins access as run_user_code, plus new globals
    namespace = {
        "__builtins__": __builtins__,
        "properties": props,
        "action_properties": action_props,
        "set_property": set_property,
    }

    # Step 5: exec the compiled code (defines execute() in the namespace)
    with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
        exec(code_obj, namespace)  # noqa: S102

    # Step 6: extract execute() function
    execute_fn = namespace.get("execute")
    if not callable(execute_fn):
        raise RuntimeError(
            "User code must define a callable 'execute' function"
        )

    # Step 7: call execute(inputs, outputs, props, action_props) with capture still active
    with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
        return_value = execute_fn(inputs, outputs, props, action_props)

    # Step 8: read and cap captured output
    stdout_text = stdout_buf.getvalue()
    stderr_text = stderr_buf.getvalue()

    if len(stdout_text.encode("utf-8")) > MAX_OUTPUT_BYTES:
        stdout_text = stdout_text.encode("utf-8")[:MAX_OUTPUT_BYTES].decode(
            "utf-8", errors="replace"
        ) + "\n[stdout truncated]"

    if len(stderr_text.encode("utf-8")) > MAX_OUTPUT_BYTES:
        stderr_text = stderr_text.encode("utf-8")[:MAX_OUTPUT_BYTES].decode(
            "utf-8", errors="replace"
        ) + "\n[stderr truncated]"

    # Step 9: return tuple (return_value, stdout, stderr, mutations)
    return return_value, stdout_text, stderr_text, mutations


def main():
    """
    Worker main loop.

    Reads newline-delimited JSON requests from stdin and writes JSON
    responses to stdout. Processes requests sequentially; one response
    per request. Runs until stdin is closed (EOF).
    """
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        start_ms = time.time() * 1000

        # Parse JSON request
        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            response = {
                "request_id": None,
                "success": False,
                "error_type": "RUNTIME_ERROR",
                "error": f"JSONDecodeError: {e}",
                "traceback": traceback.format_exc(),
                "outputs": {},
                "return_value": None,
                "execution_time_ms": round(time.time() * 1000 - start_ms, 3),
                "stdout_capture": "",
                "stderr_capture": "",
                "property_mutations": [],
            }
            print(json.dumps(response), flush=True)
            continue

        # Extract request fields
        request_id = request.get("request_id")
        source_code = request.get("source_code", "")
        inputs = request.get("inputs", {})
        # outputs starts with accumulated outputs from prior states (passed by engine)
        outputs = dict(request.get("outputs", {}))
        props = request.get("environment_action_properties", {})
        action_props = request.get("action_properties", {})

        # Execute user code
        try:
            return_value, stdout_text, stderr_text, mutations = run_user_code_with_mutations(
                source_code, inputs, outputs, props, action_props
            )
            response = {
                "request_id": request_id,
                "success": True,
                "outputs": outputs,
                "return_value": return_value,
                "execution_time_ms": round(time.time() * 1000 - start_ms, 3),
                "stdout_capture": stdout_text,
                "stderr_capture": stderr_text,
                "property_mutations": mutations,
            }
        except SyntaxError as e:
            response = {
                "request_id": request_id,
                "success": False,
                "error_type": "SYNTAX_ERROR",
                "error": f"{type(e).__name__}: {e}",
                "traceback": traceback.format_exc(),
                "outputs": outputs,
                "return_value": None,
                "execution_time_ms": round(time.time() * 1000 - start_ms, 3),
                "stdout_capture": "",
                "stderr_capture": "",
                "property_mutations": [],
            }
        except _PropertyWriteError as e:
            response = {
                "request_id": request_id,
                "success": False,
                "error_type": "PROPERTY_WRITE_ERROR",
                "error": f"{type(e).__name__}: {e}",
                "traceback": traceback.format_exc(),
                "outputs": outputs,
                "return_value": None,
                "execution_time_ms": round(time.time() * 1000 - start_ms, 3),
                "stdout_capture": "",
                "stderr_capture": "",
                "property_mutations": [],
            }
        except Exception as e:  # noqa: BLE001
            response = {
                "request_id": request_id,
                "success": False,
                "error_type": "RUNTIME_ERROR",
                "error": f"{type(e).__name__}: {e}",
                "traceback": traceback.format_exc(),
                "outputs": outputs,
                "return_value": None,
                "execution_time_ms": round(time.time() * 1000 - start_ms, 3),
                "stdout_capture": "",
                "stderr_capture": "",
                "property_mutations": [],
            }

        # flush=True is critical so the Node.js parent receives output immediately
        print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
