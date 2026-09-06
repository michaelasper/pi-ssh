import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
	createFindTool,
	createGrepTool,
	truncateHead,
	type FindToolInput,
	type GrepToolInput,
} from "@earendil-works/pi-coding-agent";
import { remoteFind, remoteGrep, type RemoteSearchCall } from "../src/search.ts";

const script = fileURLToPath(new URL("../src/remote-search.py", import.meta.url));
const load = "import runpy,sys; m=runpy.run_path(sys.argv[1]); ";
const injected = `${load}m['main'](locate=lambda _: sys.argv[2])`;
let python: string;
let fd: string;
let rg: string;

before(() => {
	// Native ensureTool must never download as a side effect of this test suite.
	process.env.PI_OFFLINE = "1";
	const probe = spawnSync("python3", ["-B", "-c", `${load}import json; print(json.dumps([sys.executable,m['locate_tool']('fd'),m['locate_tool']('rg')]))`, script], { encoding: "utf8" });
	assert.equal(probe.status, 0, `Tests need local Python 3.9+, fd/fdfind, and rg: ${probe.stderr}`);
	[python, fd, rg] = JSON.parse(probe.stdout);
	// Native also needs to find utilities located by our documented fallback paths.
	process.env.PATH = `${path.dirname(fd)}:${path.dirname(rg)}:${process.env.PATH ?? ""}`;
});

async function fixture(t: TestContext, files: Record<string, string | Buffer> = {}): Promise<string> {
	const directory = await realpath(await mkdtemp(path.join(tmpdir(), "pi-ssh-search-")));
	t.after(() => rm(directory, { recursive: true, force: true }));
	for (const [name, text] of Object.entries(files)) {
		await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
		await writeFile(path.join(directory, name), text);
	}
	return directory;
}

function runPython(request: Record<string, unknown>, args: string[] = [script]): Promise<any> {
	return new Promise((resolve, reject) => {
		const child = spawn(python, ["-B", ...args]);
		const output: Buffer[] = [];
		const errors: Buffer[] = [];
		const timeout = setTimeout(() => child.kill("SIGTERM"), 15_000);
		child.stdout.on("data", (data) => output.push(data));
		child.stderr.on("data", (data) => errors.push(data));
		child.on("error", reject);
		child.stdin.on("error", reject);
		child.on("close", (code) => {
			clearTimeout(timeout);
			try {
				assert.equal(code, 0, Buffer.concat(errors).toString());
				const text = Buffer.concat(output).toString();
				assert.equal(text.split("\n").length, 2, "one JSON response, not raw file text");
				resolve(JSON.parse(text));
			} catch (error) { reject(error); }
		});
		child.stdin.end(JSON.stringify(request));
	});
}

function callPython(args?: string[]): RemoteSearchCall {
	return async (request) => {
		const response = await runPython(request, args);
		if (!response.ok) throw new Error(response.error);
		return response.value;
	};
}
const call: RemoteSearchCall = (request) => callPython()(request);

function text(result: { content: { type: string; text?: string }[] }): string {
	assert.equal(result.content.length, 1);
	assert.equal(result.content[0].type, "text");
	return result.content[0].text!;
}

async function compareFind(root: string, input: FindToolInput) {
	const [actual, expected] = await Promise.all([
		remoteFind(input, root, call), createFindTool(root).execute("native", { ...input, path: root }),
	]);
	assert.deepEqual(actual.details, expected.details);
	// fd traverses concurrently and does not promise ordering.
	assert.deepEqual(text(actual).split("\n").sort(), text(expected).split("\n").sort());
	return actual;
}

async function compareGrep(root: string, input: GrepToolInput, unordered = false) {
	const [actual, expected] = await Promise.all([
		remoteGrep(input, root, call), createGrepTool(path.dirname(root)).execute("native", { ...input, path: root }),
	]);
	assert.deepEqual(actual.details, expected.details);
	if (unordered) assert.deepEqual(text(actual).split("\n").sort(), text(expected).split("\n").sort());
	else assert.deepEqual(actual, expected);
	return actual;
}

async function fakeUtility(t: TestContext, body: string): Promise<string> {
	const root = await fixture(t);
	const executable = path.join(root, "utility");
	await writeFile(executable, `#!${python}\n${body}\n`);
	await chmod(executable, 0o700);
	return executable;
}

function injectedCall(executable: string): RemoteSearchCall {
	return callPython(["-c", injected, script, executable]);
}

// This is deliberately a local execution test of the exact shipped Python script,
// not a mock SSH server. Host routing/framing/cancellation belong to the parent.
test("find matches native glob rewriting, hidden files, directories and ignored files outside repositories", async (t) => {
	const root = await fixture(t, {
		"a.ts": "needle", ".hidden.ts": "needle", "a.json": "needle", "src/a.spec.ts": "needle",
		"src/deep/b.spec.ts": "needle", "other/src/c.spec.ts": "needle", "node_modules/unignored.ts": "needle",
		".gitignore": "ignored/\n*.omit.ts\n", "ignored/no.ts": "needle", "a.omit.ts": "needle",
		".ignore": "fd-ignored.ts\n", "fd-ignored.ts": "needle",
	});
	for (const pattern of ["*.ts", "**/*.ts", "src/**/*.spec.ts", "**/src/*.spec.ts", "**", "src", `${root}/src/**/*.spec.ts`, "absent.*"]) {
		await compareFind(root, { pattern });
	}
	const found = text(await remoteFind({ pattern: "*.ts" }, root, call));
	assert.match(found, /\.hidden.ts/);
	assert.match(found, /node_modules\/unignored.ts/);
	assert.doesNotMatch(found, /ignored\/no|a.omit|fd-ignored/);
});

test("find repository boundaries, nested repositories, git files and subdirectory search roots match native", async (t) => {
	const root = await fixture(t, {
		".gitignore": "*.drop\n", "parent.drop": "x", "parent.keep": "x",
		"sub/a.drop": "x", "sub/a.keep": "x", "nested/a.drop": "x", "nested/a.keep": "x",
	});
	await mkdir(path.join(root, ".git"));
	await mkdir(path.join(root, "nested/.git"));
	for (const directory of [root, path.join(root, "sub"), path.join(root, "nested")]) {
		await compareFind(directory, { pattern: "*" });
	}
	const found = text(await remoteFind({ pattern: "*.drop" }, root, call));
	assert.match(found, /nested\/a.drop/);
	assert.doesNotMatch(found, /parent.drop|sub\/a.drop/);
	await rm(path.join(root, "nested/.git"), { recursive: true });
	await writeFile(path.join(root, "nested/.git"), "gitdir: /not-followed-by-this-test\n");
	await compareFind(root, { pattern: "*.drop" });
});

test("find keeps symlinks and directory suffixes without following directory symlinks", async (t) => {
	const root = await fixture(t, { "dir/file": "x" });
	await symlink("dir", path.join(root, "link"));
	await symlink("missing", path.join(root, "broken"));
	await compareFind(root, { pattern: "*" });
	const value = await call({ op: "find", path: root, pattern: "*" });
	assert.ok(value.paths.includes(`${root}/dir/`));
	assert.ok(value.paths.includes(`${root}/link`));
	assert.ok(!value.paths.includes(`${root}/link/file`));
});

test("find passes limits to fd and preserves default-backend notices", async (t) => {
	const root = await fixture(t, { a: "x", b: "x", c: "x" });
	await compareFind(root, { pattern: "*", limit: 3 });
	await compareFind(root, { pattern: "*", limit: 0 }); // fd's zero means unlimited, native still adds a notice.
	const limited = await remoteFind({ pattern: "*", limit: 1 }, root, call);
	assert.deepEqual(limited.details, { resultLimitReached: 1 });
	assert.match(text(limited), /^[abc]\n\n\[1 results limit reached\. Use limit=2 for more, or refine pattern\]$/);
	for (const limit of [-1, 1.5]) {
		await assert.rejects(() => remoteFind({ pattern: "*", limit }, root, call));
		await assert.rejects(() => createFindTool(root).execute("native", { pattern: "*", limit }));
	}
});

test("find sends literal special paths safely with NUL boundaries, preserving trailing whitespace", async (t) => {
	const root = await fixture(t);
	const directory = path.join(root, "dir ' \" $(touch SENTINEL); `pwd`\n雪");
	await mkdir(directory);
	const names = ["-flag.txt", "a\nb.txt", "quote'\".txt", "tabs\t.txt", "name.txt  ", "$(touch SENTINEL).txt"];
	for (const name of names) await writeFile(path.join(directory, name), "x");
	const value = await call({ op: "find", path: directory, pattern: "*" });
	assert.deepEqual(value.paths.map((p: string) => path.posix.relative(directory, p)).sort(), [...names].sort());
	const output = text(await remoteFind({ pattern: "*" }, directory, call));
	for (const name of names) assert.ok(output.includes(name));
	await assert.rejects(readFile(path.join(directory, "SENTINEL")));
	// A leading option-looking pattern remains a pattern, not a utility flag.
	assert.equal(text(await remoteFind({ pattern: "-flag.txt" }, directory, call)), "-flag.txt");
});

test("grep native regex, literal/case flags, glob filters, no-match and file vs directory paths", async (t) => {
	const root = await fixture(t, {
		"a.ts": "Hello world\na.b\naxb\nFOO needle\nbar\nfoo\n雪 needle\n--help\n",
		"sub/b.ts": "needle\n", "other.js": "needle\n", ".hidden.ts": "needle\n",
	});
	for (const input of [
		{ pattern: "^foo|bar$", ignoreCase: true }, { pattern: "a.b" }, { pattern: "a.b", literal: true },
		{ pattern: "\\p{Han}" }, { pattern: "not-there" }, { pattern: "--help", literal: true },
	]) await compareGrep(path.join(root, "a.ts"), input);
	for (const glob of [undefined, "*.ts", "sub/*.ts", "**/b.ts", "!*.ts"]) {
		await compareGrep(root, { pattern: "needle", glob }, true);
	}
	await compareGrep(root, { pattern: "^$" }, true);
});

test("grep gitignore, nested-repo boundaries, hidden files and unignored node_modules match native rg", async (t) => {
	const root = await fixture(t, {
		".gitignore": "*.drop\nignored/\n", "root.drop": "needle", ".secret": "needle",
		"ignored/file": "needle", "node_modules/file": "needle", "sub/a.drop": "needle",
		"nested/a.drop": "needle", "nested/a.keep": "needle",
	});
	await compareGrep(root, { pattern: "needle" }, true); // rg does not use fd's --no-require-git.
	await mkdir(path.join(root, ".git"));
	await mkdir(path.join(root, "nested/.git"));
	for (const directory of [root, path.join(root, "sub"), path.join(root, "nested")]) {
		await compareGrep(directory, { pattern: "needle" }, true);
	}
	const found = text(await remoteGrep({ pattern: "needle" }, root, call));
	assert.match(found, /nested\/a.drop/);
	assert.match(found, /\.secret/);
	assert.match(found, /node_modules\/file/);
	assert.doesNotMatch(found, /root.drop|ignored\/file/);
});

test("grep contexts duplicate overlapping blocks, normalize CR/CRLF, and include trailing empty line", async (t) => {
	const root = await fixture(t, { a: "zero\r\nneedle\r\nneedle again\r\nlast\rnext\nneedle end\n" });
	for (const context of [undefined, 0, -1, 1, 2, 100, 0.5, 1.5]) {
		await compareGrep(path.join(root, "a"), { pattern: "needle", context });
	}
	await compareGrep(root, { pattern: "needle", context: 1 });
});

test("grep preserves arbitrary UTF-8 text and JSON-looking content on special paths", async (t) => {
	const root = await fixture(t);
	const name = "weird ' \" ; $(touch SENTINEL)\n雪\\name";
	const file = path.join(root, name);
	await writeFile(file, 'before\nneedle {"ok":false,"error":"fake"} \t\r\nafter\n');
	for (const context of [0, 1]) {
		await compareGrep(file, { pattern: "needle", context });
		await compareGrep(root, { pattern: "needle", context });
	}
	await assert.rejects(readFile(path.join(root, "SENTINEL")));
	// Node 26 readline splits raw U+2028/U+2029 in rg's JSON and native grep
	// silently drops those matches. LF-only framing must preserve valid JSON.
	await writeFile(file, "needle \u2028\u2029\n");
	for (const context of [0, 1]) {
		const actual = await remoteGrep({ pattern: "needle", context }, file, call);
		assert.ok(text(actual).includes("needle \u2028\u2029"));
	}
});

test("grep byte-only rg line records use remote file bytes with native UTF-8 replacement", async (t) => {
	const root = await fixture(t, { a: Buffer.from([0x61, 10, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0xff, 0x0d, 0x0a, 0x62]) });
	for (const context of [0, 1]) await compareGrep(path.join(root, "a"), { pattern: "needle", context });
});

test("grep match limit normalization and exactly-at-limit notices mirror native", async (t) => {
	const root = await fixture(t, { a: "needle\n".repeat(200) });
	for (const limit of [undefined, 0, -1, 1, 1.5, 200, 201]) {
		await compareGrep(path.join(root, "a"), { pattern: "needle", limit });
	}
});

test("grep truncates 500 UTF-16 characters, then 51200 bytes, with exact native details", async (t) => {
	const root = await fixture(t, { a: `${"雪".repeat(600)}\n${"x".repeat(499)}😀end\n${"雪".repeat(499)}\n`.repeat(80) });
	for (const context of [0, 1]) {
		const result = await compareGrep(path.join(root, "a"), { pattern: ".", limit: 300, context });
		assert.equal(result.details?.linesTruncated, true);
		assert.equal(result.details?.truncation?.maxBytes, 51200);
		assert.equal(result.details?.truncation?.truncatedBy, "bytes");
		assert.ok(result.details!.truncation!.outputBytes <= 51200);
	}
});

test("grep has no 2000-line cap, including large context blocks", async (t) => {
	const root = await fixture(t, { a: "x\n".repeat(2100), b: `${"x\n".repeat(1050)}needle\n${"x\n".repeat(1050)}` });
	const matches = await compareGrep(path.join(root, "a"), { pattern: "x", limit: 2200 });
	assert.equal(text(matches).split("\n").length, 2100);
	assert.equal(matches.details, undefined);
	const context = await compareGrep(path.join(root, "b"), { pattern: "needle", context: 1100 });
	assert.equal(text(context).split("\n").length, 2102);
	assert.equal(context.details, undefined);
});

test("find has no 2000-line cap and uses public byte truncation with native details", async (t) => {
	const root = await fixture(t);
	const short = Array.from({ length: 2100 }, (_, i) => `${root}/${i}`);
	const untruncated = await remoteFind({ pattern: "*", limit: 3000 }, root, async () => ({ paths: short }));
	assert.equal(text(untruncated).split("\n").length, 2100);
	assert.equal(untruncated.details, undefined);
	const paths = Array.from({ length: 1000 }, (_, i) => `${root}/${i}-${"雪".repeat(30)}`);
	const actual = await remoteFind({ pattern: "*" }, root, async () => ({ paths }));
	const expected = truncateHead(paths.map((p) => path.posix.relative(root, p)).join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
	assert.deepEqual(actual.details, { resultLimitReached: 1000, truncation: expected });
	assert.match(text(actual), /1000 results limit reached.*50\.0KB limit reached/);
	// Real fd output truncation, not only formatter injection.
	for (let i = 0; i < 600; i++) await writeFile(path.join(root, `${i}-${"a".repeat(100)}`), "x");
	const real = await remoteFind({ pattern: "*" }, root, call);
	assert.equal(real.details?.truncation?.totalLines, 600);
	assert.equal(real.details?.truncation?.truncatedBy, "bytes");
	assert.equal(real.details?.truncation?.maxLines, Number.MAX_SAFE_INTEGER);
});

test("invalid regex/glob, missing paths and failures remain errors rather than no-match", async (t) => {
	const root = await fixture(t, { a: "needle" });
	for (const pattern of ["[", "(?=needle)", "\\1"]) {
		await assert.rejects(() => remoteGrep({ pattern }, root, call), /regex parse error|not supported/);
		await assert.rejects(() => createGrepTool(root).execute("native", { pattern }));
	}
	await assert.rejects(() => remoteFind({ pattern: "[" }, root, call));
	await assert.rejects(() => createFindTool(root).execute("native", { pattern: "[" }));
	await assert.rejects(() => remoteGrep({ pattern: ".", glob: "[" }, root, call));
	for (const search of [remoteFind, remoteGrep]) {
		await assert.rejects(() => search({ pattern: "*" }, path.join(root, "missing"), call));
		await assert.rejects(() => search({ pattern: "*" }, "relative", call), /absolute POSIX path/);
		await assert.rejects(() => search({ pattern: "*" }, `${root}\0`, call), /NUL/);
		await assert.rejects(() => search({ pattern: "*" }, root, async () => { throw new Error("SSH disconnected"); }), /SSH disconnected/);
	}
});

test("missing utilities, fdfind alias and fallback lookup are tested without altering host installations", async (t) => {
	const root = await fixture(t);
	const missing = `${load}m['main'](locate=lambda name: m['locate_tool'](name,which=lambda _:None,extra_dirs=[]))`;
	for (const op of ["find", "grep"]) {
		const response = await runPython({ op, path: root, pattern: "x" }, ["-c", missing, script]);
		assert.equal(response.ok, false);
		assert.match(response.error, /Install it on the selected host/);
		assert.match(response.error, /does not download/);
	}
	const check = spawnSync(python, ["-B", "-c", `${load}
assert m['locate_tool']('fd',which=lambda n: '/fake/fdfind' if n=='fdfind' else None,extra_dirs=[])=='/fake/fdfind'
assert m['locate_tool']('rg',which=lambda n: '/path/rg',extra_dirs=['/irrelevant'])=='/path/rg'
assert m['locate_tool']('rg',which=lambda _: None,extra_dirs=[sys.argv[2]])==sys.argv[3]
`, script, path.dirname(rg), rg], { encoding: "utf8" });
	assert.equal(check.status, 0, check.stderr);
});

test("utility launch errors and excessive stderr are bounded and actionable", async (t) => {
	const root = await fixture(t);
	const noisy = await fakeUtility(t, "import sys\nsys.stderr.write('utility failed!\\n'+'z'*1000000)\nsys.exit(2)");
	for (const search of [remoteFind, remoteGrep]) {
		await assert.rejects(() => search({ pattern: "x" }, root, injectedCall(path.join(root, "missing-executable"))), /Failed to run/);
		await assert.rejects(() => search({ pattern: "x" }, root, injectedCall(noisy)), (error: Error) => {
			assert.match(error.message, /^utility failed!/);
			assert.match(error.message, /stderr truncated/);
			assert.ok(error.message.length < 17000);
			return true;
		});
	}
});

test("grep errors after matches are not swallowed; malformed utility JSON is not no-match", async (t) => {
	const root = await fixture(t, { a: "needle" });
	const event = { type: "match", data: { path: { text: path.join(root, "a") }, line_number: 1, lines: { text: "needle\n" } } };
	const failing = await fakeUtility(t, `import sys\nprint(${JSON.stringify(JSON.stringify(event))}, flush=True)\nsys.stderr.write('search failed')\nsys.exit(2)`);
	await assert.rejects(() => remoteGrep({ pattern: "needle" }, root, injectedCall(failing)), /search failed/);
	const malformed = await fakeUtility(t, "print('not JSON')");
	await assert.rejects(() => remoteGrep({ pattern: "needle" }, root, injectedCall(malformed)), /Invalid ripgrep JSON/);
});

test("context fallback only covers actual remote file read errors; missing payload/transport still fail", async (t) => {
	const root = await fixture(t);
	const event = { type: "match", data: { path: { text: `${root}/missing` }, line_number: 3, lines: { text: "needle\n" } } };
	const fake = await fakeUtility(t, `print(${JSON.stringify(JSON.stringify(event))})`);
	const result = await remoteGrep({ pattern: "needle", context: 1 }, root, injectedCall(fake));
	assert.equal(text(result), "missing:3: (unable to read file)");
	await assert.rejects(() => remoteGrep({ pattern: "needle", context: 1 }, root, async () => {
		throw new Error("SSH context request failed");
	}), /SSH context request failed/);
	await assert.rejects(() => remoteGrep({ pattern: "needle", context: 1 }, root, async () => ({
		isDirectory: true, matchCount: 1, matchLimitReached: false,
		matches: [{ filePath: `${root}/a`, lineNumber: 1 }], files: [],
	})), /Invalid remote search response/);
	await assert.rejects(() => remoteFind({ pattern: "*" }, root, async () => ({})), /Invalid remote search response/);
});

async function waitForFile(file: string): Promise<string> {
	for (let i = 0; i < 200; i++) {
		try { return await readFile(file, "utf8"); } catch { /* only fixture readiness polling */ }
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Fixture never became ready: ${file}`);
}

function startInjected(executable: string, request: Record<string, unknown>): ChildProcessWithoutNullStreams {
	const child = spawn(python, ["-B", "-c", injected, script, executable]);
	child.stdin.end(JSON.stringify(request));
	child.stderr.resume();
	return child;
}

test("grep stops and reaps a still-running utility at the match limit", { timeout: 10_000 }, async (t) => {
	const root = await fixture(t);
	const pidFile = path.join(root, "pid");
	const event = { type: "match", data: { path: { text: `${root}/a` }, line_number: 1, lines: { text: "needle\n" } } };
	const fake = await fakeUtility(t, `import os,time\nopen(${JSON.stringify(pidFile)},'w').write(str(os.getpid()))\nprint(${JSON.stringify(JSON.stringify(event))},flush=True)\ntime.sleep(60)`);
	const result = await remoteGrep({ pattern: "needle", limit: 1 }, root, injectedCall(fake));
	assert.equal(result.details?.matchLimitReached, 1);
	const pid = Number(await readFile(pidFile, "utf8"));
	assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test("SIGTERM and SSH-like output-pipe disconnect terminate and reap fd/rg children", { timeout: 15_000 }, async (t) => {
	for (const op of ["find", "grep"]) {
		for (const disconnect of [false, true]) {
			const root = await fixture(t);
			const pidFile = path.join(root, "pid");
			const fake = await fakeUtility(t, `import os,time,signal\nopen(${JSON.stringify(pidFile)},'w').write(str(os.getpid()))\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\ntime.sleep(60)`);
			const child = startInjected(fake, { op, path: root, pattern: "needle" });
			t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
			const closed = once(child, "close");
			const pid = Number(await waitForFile(pidFile));
			t.after(() => { try { process.kill(pid, "SIGKILL"); } catch { /* already reaped */ } });
			if (disconnect) child.stdout.destroy();
			else { child.stdout.resume(); child.kill("SIGTERM"); }
			await closed;
			assert.throws(() => process.kill(pid, 0), /ESRCH/);
		}
	}
});
