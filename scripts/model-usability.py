#!/usr/bin/env python3
"""Opt-in, bounded real-model tests. Raw evidence stays in ignored .artifacts/."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
HOST = os.environ.get("PI_SSH_TEST_HOST")
MODEL = "gpt-5.6-luna"
if not HOST:
    raise SystemExit("Set PI_SSH_TEST_HOST to an authorized SSH target")

source_dir = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi/agent"))
credential = json.loads((source_dir / "auth.json").read_text()).get("openai-codex")
if not credential:
    raise SystemExit("Log in to openai-codex with pi first")

artifacts = ROOT / ".artifacts" / "model-usability"
artifacts.mkdir(parents=True, exist_ok=True, mode=0o700)
summary = []
for scenario in ("explicit-host", "configured-default"):
    with tempfile.TemporaryDirectory(prefix="pi-ssh-model-") as temporary:
        isolated = Path(temporary)
        agent = isolated / "agent"
        agent.mkdir(mode=0o700)
        auth = agent / "auth.json"
        auth.write_text(json.dumps({"openai-codex": credential}))
        auth.chmod(0o600)
        (agent / "settings.json").write_text(json.dumps({"quietStartup": True, "enableAutoSummary": False}))
        env = {key: os.environ[key] for key in ("HOME", "PATH", "SSH_AUTH_SOCK", "TMPDIR", "LANG", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY") if key in os.environ}
        env.update({"PI_CODING_AGENT_DIR": str(agent), "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "PI_SSH_TEST_HOST": HOST})
        location = f"SSH target {HOST}" if scenario == "explicit-host" else "the configured default machine"
        prompt = (
            f"Use the available bash tool to run exactly `printf 'REMOTE_OK\\n'` on {location}. "
            f"Then run exactly `printf 'EXPECTED_FAILURE\\n' >&2; exit 7` on that same machine. "
            "That failure is intentional: do not retry or change it. "
            "Finally, on the LOCAL machine running pi, run exactly `printf 'LOCAL_OK\\n'`. "
            "Do not run any other commands or inspect any files. Briefly report the three outcomes and where each ran."
        )
        command = ["pi", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
                   "--no-context-files", "--no-approve", "--no-session", "--offline", "--no-builtin-tools", "--tools", "bash",
                   "-e", str(ROOT / "src/index.ts"), "-e", str(ROOT / "test/model-guard.ts"),
                   "--provider", "openai-codex", "--model", MODEL, "--thinking", "low", "--mode", "json", "--print"]
        if scenario == "configured-default":
            command += ["--ssh-host", HOST]
        command.append(prompt)
        result = subprocess.run(command, cwd=isolated, env=env, capture_output=True, text=True, timeout=120)
        (artifacts / f"{scenario}.jsonl").write_text(result.stdout)
        (artifacts / f"{scenario}.stderr").write_text(result.stderr)
        (artifacts / f"{scenario}.prompt.txt").write_text(prompt)
        if result.returncode:
            raise SystemExit(f"{scenario}: pi exited {result.returncode}; inspect ignored evidence")
        events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        starts = [event for event in events if event.get("type") == "tool_execution_start"]
        ends = {event["toolCallId"]: event for event in events if event.get("type") == "tool_execution_end"}
        assert len(starts) == 3, f"{scenario}: expected exactly 3 calls, got {len(starts)}"
        checks = []
        for start, expected, is_error in zip(starts, ["REMOTE_OK", "EXPECTED_FAILURE", "LOCAL_OK"], [False, True, False]):
            args = start["args"]
            target = args.get("host", HOST if scenario == "configured-default" else "local")
            assert target == ("local" if expected == "LOCAL_OK" else HOST), (scenario, expected, "wrong target")
            if expected == "LOCAL_OK":
                assert args.get("host") == "local", "Must demonstrate explicit local override"
            end = ends[start["toolCallId"]]
            assert end["isError"] == is_error, (scenario, expected, "wrong error status")
            output = "".join(c.get("text", "") for c in end["result"]["content"])
            assert expected in output, (scenario, expected, "missing output")
            if is_error:
                assert "code 7" in output
            checks.append({"probe": expected, "hostArgument": "<test-host>" if args.get("host") == HOST else args.get("host"), "isError": end["isError"]})
        assistants = [e["message"] for e in events if e.get("type") == "message_end" and e.get("message", {}).get("role") == "assistant"]
        assert assistants and all(m.get("model") == MODEL and m.get("provider") == "openai-codex" for m in assistants), "Unexpected model"
        assert not any(m.get("stopReason") in ("error", "aborted") for m in assistants), "Model session did not finish successfully"
        final = "".join(c.get("text", "") for c in assistants[-1]["content"] if c["type"] == "text")
        assert all(token in final for token in ["REMOTE_OK", "EXPECTED_FAILURE", "LOCAL_OK"]), "Final report omitted an outcome"
        summary.append({"scenario": scenario, "model": f"openai-codex/{MODEL}", "thinking": "low", "checks": checks,
                        "final": final.replace(HOST, "<test-host>")})
        print(f"PASS {scenario}: 3 verified calls, requested model, correct targeting and error handling")

(artifacts / "summary.json").write_text(json.dumps(summary, indent=2))
