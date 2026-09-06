"""One-shot fd/rg adapter (Python 3.9+); no shell, pi runtime, or downloads.

stdin: one JSON object, op=find|grep, absolute path, and native search options.
stdout: exactly {"ok": true, "value": ...} or {"ok": false, "error": ...}.
The caller unwraps this envelope and treats framing/SSH errors as failures.
"""

import base64
from contextlib import contextmanager
import json
import os
import select
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading


STDERR_LIMIT = 16 * 1024


class Cancelled(BaseException):
    """Not an OS read error: must never become an unreadable-context result."""


def locate_tool(name, *, which=shutil.which, extra_dirs=None):
    """Dependency injection is for tests; no request may choose an executable."""
    names = ("fd", "fdfind") if name == "fd" else ("rg",)
    for candidate in names:
        found = which(candidate)
        if found:
            return found
    if extra_dirs is None:
        extra_dirs = ("/opt/homebrew/bin", "/usr/local/bin", os.path.expanduser("~/.pi/agent/bin"))
    for directory in extra_dirs:
        for candidate in names:
            found = os.path.join(directory, candidate)
            if os.path.isfile(found) and os.access(found, os.X_OK):
                return found
    label = "fd (or fdfind)" if name == "fd" else "ripgrep (rg)"
    raise RuntimeError(
        f"Remote search requires {label}. Install it on the selected host and make it "
        "available on PATH, in /opt/homebrew/bin, /usr/local/bin, or ~/.pi/agent/bin. "
        "pi-ssh does not download remote utilities."
    )


def stop_child(child):
    """Always reap; escalate if the utility ignores SIGTERM."""
    if child.poll() is None:
        child.terminate()
    try:
        child.wait(timeout=1)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()


@contextmanager
def search_child(executable, args, label):
    # A temporary file avoids both stderr pipe deadlocks and unbounded in-memory
    # stderr accumulation. Only a bounded prefix enters the error envelope.
    with tempfile.TemporaryFile() as stderr:
        try:
            child = subprocess.Popen(
                [executable, *args], stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=stderr,
            )
        except OSError as error:
            raise RuntimeError(f"Failed to run {label}: {error}") from error
        try:
            yield child, stderr
        finally:
            stop_child(child)
            child.stdout.close()


def process_error(stderr, label, code):
    stderr.seek(0)
    data = stderr.read(STDERR_LIMIT + 1)
    message = data[:STDERR_LIMIT].decode("utf-8", errors="replace").strip()
    if len(data) > STDERR_LIMIT:
        message += "\n[stderr truncated]"
    return message or f"{label} exited with code {code}"


def nul_records(stream):
    pending = b""
    while True:
        chunk = stream.read(65536)
        if not chunk:
            break
        pieces = (pending + chunk).split(b"\0")
        pending = pieces.pop()
        yield from pieces
    if pending:
        raise RuntimeError("Invalid fd output: missing NUL record terminator")


def find_args(request):
    search_path = request["path"]
    args = ["--glob", "--color=never", "--hidden", "--print0"]
    # Match pi 0.85.1: --no-require-git only outside a repository, so parent
    # ignore rules stop at nested repo boundaries. .git may be a file/worktree.
    current = search_path
    while not os.path.exists(os.path.join(current, ".git")):
        parent = os.path.dirname(current)
        if parent == current:
            args.append("--no-require-git")
            break
        current = parent
    args.extend(["--max-results", str(request.get("limit", 1000))])
    pattern = request["pattern"]
    if "/" in pattern:
        args.append("--full-path")
        if not pattern.startswith(("/", "**/")) and pattern != "**":
            pattern = "**/" + pattern
    args.extend(["--", pattern, search_path])
    return args


def remote_find(request, locate=locate_tool):
    executable = locate("fd")
    with search_child(executable, find_args(request), "fd") as (child, stderr):
        paths = [record.decode("utf-8", errors="replace") for record in nul_records(child.stdout) if record]
        code = child.wait()
        # Native fd preserves partial results on a nonzero exit, but never
        # converts an error with no output into a successful no-match result.
        if code != 0 and not paths:
            raise RuntimeError(process_error(stderr, "fd", code))
    return {"paths": paths}


def grep_args(request):
    args = ["--json", "--line-number", "--color=never", "--hidden"]
    if request.get("ignoreCase"):
        args.append("--ignore-case")
    if request.get("literal"):
        args.append("--fixed-strings")
    if request.get("glob"):
        args.extend(["--glob", request["glob"]])
    args.extend(["--", request["pattern"], request["path"]])
    return args


def remote_grep(request, locate=locate_tool):
    executable = locate("rg")
    try:
        is_directory = stat.S_ISDIR(os.stat(request["path"]).st_mode)
    except OSError as error:
        raise RuntimeError(f"Path not found: {request['path']}") from error
    effective_limit = max(1, request.get("limit", 100))
    context = request.get("context", 0)
    matches = []
    match_count = 0
    limit_reached = False
    with search_child(executable, grep_args(request), "ripgrep") as (child, stderr):
        # Iterate bytes on LF only: Unicode separators and CR inside JSON text
        # are data, not record delimiters. rg --json escapes embedded newlines.
        for raw_line in child.stdout:
            if not raw_line.strip():
                continue
            try:
                event = json.loads(raw_line)
            except (ValueError, UnicodeError) as error:
                raise RuntimeError("Invalid ripgrep JSON output") from error
            if not isinstance(event, dict):
                raise RuntimeError("Invalid ripgrep JSON event")
            if event.get("type") != "match":
                continue
            match_count += 1
            data = event.get("data") or {}
            file_path = (data.get("path") or {}).get("text")
            line_number = data.get("line_number")
            line_text = (data.get("lines") or {}).get("text")
            # Match native handling of rg's text/bytes union: byte-only path
            # events count toward the limit but are not formatted; byte-only
            # line events fall back to a file read (Node UTF-8 replacement).
            if file_path and isinstance(line_number, (int, float)):
                match = {"filePath": file_path, "lineNumber": line_number}
                if line_text is not None:
                    match["lineText"] = line_text
                matches.append(match)
            if match_count >= effective_limit:
                limit_reached = True
                stop_child(child)
                break
        code = child.wait()
        if not limit_reached and code not in (0, 1):
            raise RuntimeError(process_error(stderr, "ripgrep", code))

    files = []
    cached = set()
    for match in matches:
        file_path = match["filePath"]
        if (context <= 0 and "lineText" in match) or file_path in cached:
            continue
        cached.add(file_path)
        try:
            with open(file_path, "rb") as source:
                content = base64.b64encode(source.read()).decode("ascii")
        except OSError:
            # Only an actual remote OS read failure gets the native fallback.
            # Cancellation, protocol errors, and SSH failures are not caught.
            content = None
        files.append({"filePath": file_path, "content": content})
    return {
        "isDirectory": is_directory, "matches": matches, "matchCount": match_count,
        "matchLimitReached": limit_reached, "files": files,
    }


def dispatch(request, locate=locate_tool):
    if not isinstance(request, dict):
        raise ValueError("Remote search request must be a JSON object")
    search_path = request.get("path")
    if not isinstance(search_path, str) or not os.path.isabs(search_path) or "\0" in search_path:
        raise ValueError("Remote search requires an absolute POSIX path without NUL bytes")
    if not isinstance(request.get("pattern"), str):
        raise ValueError("Remote search pattern must be a string")
    if request.get("op") == "find":
        return remote_find(request, locate)
    if request.get("op") == "grep":
        return remote_grep(request, locate)
    raise ValueError("Unknown remote search operation")


def watch_disconnect(done):
    # OpenSSH may close its output pipe without signalling a non-PTY command.
    # POLLERR/POLLHUP on stdout detects that even while rg is not producing any
    # output. Do not watch stdin: EOF there is normal after the JSON request.
    if not hasattr(select, "poll"):
        return
    poller = select.poll()
    # macOS poll reports a closed pipe/socket only when POLLOUT is requested.
    poller.register(sys.stdout.fileno(), select.POLLOUT)
    while not done.wait(0.1):
        if any(flags & (select.POLLERR | select.POLLHUP | select.POLLNVAL)
               for _, flags in poller.poll(0)):
            os.kill(os.getpid(), signal.SIGTERM)
            return


def main(locate=locate_tool):
    signals = (signal.SIGTERM, signal.SIGHUP, signal.SIGINT)
    previous = {sig: signal.getsignal(sig) for sig in signals}

    def on_signal(signum, _frame):
        # A second termination signal must not interrupt child cleanup/reaping.
        for sig in signals:
            signal.signal(sig, signal.SIG_IGN)
        raise Cancelled(f"Remote search cancelled (signal {signum})")

    for sig in signals:
        signal.signal(sig, on_signal)
    done = threading.Event()
    watcher = threading.Thread(target=watch_disconnect, args=(done,), daemon=True)
    watcher.start()
    try:
        try:
            request = json.load(sys.stdin)
            response = {"ok": True, "value": dispatch(request, locate)}
        except (Exception, Cancelled) as error:
            response = {"ok": False, "error": str(error)}
        try:
            sys.stdout.write(json.dumps(response, ensure_ascii=True, separators=(",", ":")) + "\n")
            sys.stdout.flush()
        except BrokenPipeError:
            # The child has already been reaped. Avoid a second flush failure
            # when Python shuts down after an SSH disconnect.
            with open(os.devnull, "w") as sink:
                os.dup2(sink.fileno(), sys.stdout.fileno())
    finally:
        done.set()
        watcher.join()
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == "__main__":
    main()
