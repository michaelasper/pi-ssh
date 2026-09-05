#!/usr/bin/env python3
"""Install the production tarball in an isolated pi directory; never publish."""
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="pi-ssh-package-") as temporary:
    work = Path(temporary)
    packed = subprocess.run(["npm", "pack", "--json", "--pack-destination", str(work)], cwd=ROOT,
                            check=True, capture_output=True, text=True)
    data = json.loads(packed.stdout)
    package_name = json.loads((ROOT / 'package.json').read_text())['name']
    info = data[0] if isinstance(data, list) else data[package_name]
    for item in info["files"]:
        name = item["path"]
        assert name in ("package.json", "README.md", "LICENSE") or name.startswith(("src/", "docs/")), name
    with tarfile.open(work / info["filename"]) as archive:
        archive.extractall(work, filter="data")
    package = work / "package"
    installed = subprocess.run(["npm", "install", "--omit=dev", "--no-fund"],
                               cwd=package, check=True, capture_output=True, text=True, timeout=120)
    assert 'npm warn' not in (installed.stdout + installed.stderr).lower(), (installed.stdout, installed.stderr)
    dependencies = package / "node_modules"
    assert not dependencies.exists() or not any(path.name != '.package-lock.json' for path in dependencies.iterdir()), "Production install pulled dependencies that pi already bundles"
    audit = subprocess.run(["npm", "audit", "--omit=dev", "--json"], cwd=package,
                           check=True, capture_output=True, text=True, timeout=30)
    assert json.loads(audit.stdout)["metadata"]["vulnerabilities"]["total"] == 0
    smoke = work / "smoke.ts"
    smoke.write_text('''export default function(pi) {
  pi.on("session_start", () => {
    const tool = pi.getAllTools().find(t => t.name === "bash");
    const ok = tool?.parameters?.properties?.host && tool?.parameters?.properties?.cwd
      && tool.sourceInfo.source !== "builtin";
    console.log(ok ? "PI_SSH_PACKAGE_SMOKE_OK" : "PI_SSH_PACKAGE_SMOKE_FAILED");
    process.exit(ok ? 0 : 1);
  });
}
''')
    env = {key: os.environ[key] for key in ("HOME", "PATH", "TMPDIR", "LANG") if key in os.environ}
    env.update({"PI_CODING_AGENT_DIR": str(work / "agent"), "PI_OFFLINE": "1", "PI_TELEMETRY": "0"})
    subprocess.run(["pi", "install", str(package)], cwd=work, env=env, check=True,
                   capture_output=True, text=True, timeout=30)
    result = subprocess.run(["pi", "-e", str(smoke), "--no-skills", "--no-prompt-templates", "--no-themes",
                             "--no-context-files", "--no-approve", "--no-session", "--offline", "-p", "unused"],
                            cwd=work, env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0 and "PI_SSH_PACKAGE_SMOKE_OK" in result.stdout + result.stderr, (result.stdout, result.stderr)
    assert not result.stderr.replace("PI_SSH_PACKAGE_SMOKE_OK", "").strip(), result.stderr
    print(f"PASS production tarball: {len(info['files'])} allowlisted files; zero installed production dependencies; zero audit findings; isolated pi install and bash schema registration")
