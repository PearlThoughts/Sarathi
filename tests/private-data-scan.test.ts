import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile as writeTextFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseForbiddenValues, runPrivateDataScan } from "../src/cli/commands/private-data-scan.ts";

const cliPath = fileURLToPath(new URL("../src/cli/commands/private-data-scan.ts", import.meta.url));
const temporaryDirectories: string[] = [];

const run = async (
  command: readonly string[],
  options: { readonly cwd: string; readonly stdin?: string | undefined },
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> => {
  const executable = command[0];
  if (executable === undefined) {
    throw new Error("Test process command must not be empty.");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, command.slice(1), {
      cwd: options.cwd,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const childStdout = child.stdout;
    const childStderr = child.stderr;
    if (childStdout === null || childStderr === null) {
      reject(new Error("Test process output streams must be piped."));
      return;
    }
    let stdout = "";
    let stderr = "";

    childStdout.setEncoding("utf8");
    childStderr.setEncoding("utf8");
    childStdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    childStderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });

    if (options.stdin !== undefined && child.stdin !== null) {
      child.stdin.end(options.stdin);
    }
  });
};

const createRepository = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "sarathi-private-scan-"));
  temporaryDirectories.push(directory);
  await run(["git", "init", "-q"], { cwd: directory });
  return directory;
};

const writeFile = async (path: string, contents: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeTextFile(path, contents, "utf8");
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("private-data scan", () => {
  it("parses newline-delimited values without retaining comments or duplicates", () => {
    expect(parseForbiddenValues("# private values\ninvented-token\ninvented-token\nabc\n")).toEqual(
      ["invented-token"],
    );
  });

  it("detects invented forbidden values in tracked files without returning matched content", async () => {
    const repository = await createRepository();
    const forbiddenValue = "invented-private-token-7f0f";
    await writeFile(join(repository, "tracked.txt"), `safe prefix ${forbiddenValue} safe suffix\n`);
    await run(["git", "add", "tracked.txt"], { cwd: repository });

    const result = await runPrivateDataScan(repository, [forbiddenValue]);

    expect(result.findings).toEqual([{ filePath: "tracked.txt", forbiddenValueIndex: 0 }]);
    expect(JSON.stringify(result)).not.toContain(forbiddenValue);
  });

  it("fails the CLI through stdin without echoing the forbidden value", async () => {
    const repository = await createRepository();
    const forbiddenValue = "invented-private-workspace-3b2c";
    await writeFile(join(repository, "tracked.txt"), `${forbiddenValue}\n`);
    await run(["git", "add", "tracked.txt"], { cwd: repository });

    const result = await run(["bun", cliPath, "--root", repository, "--stdin"], {
      cwd: repository,
      stdin: `${forbiddenValue}\n`,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Private-data scan failed");
    expect(result.stderr).toContain("tracked.txt");
    expect(result.stderr).not.toContain(forbiddenValue);
    expect(result.stdout).toBe("");
  });

  it("accepts an ignored values file and leaves a clean tracked tree passing", async () => {
    const repository = await createRepository();
    const forbiddenValue = "invented-private-account-91a4";
    const valuesFile = join(repository, ".private-values");
    await writeFile(join(repository, ".gitignore"), ".private-values\n");
    await writeFile(join(repository, "tracked.txt"), "Invented public fixture only.\n");
    await writeFile(valuesFile, `${forbiddenValue}\n`);
    await run(["git", "add", ".gitignore", "tracked.txt"], { cwd: repository });
    await run(
      [
        "git",
        "-c",
        "user.name=Synthetic Test",
        "-c",
        "user.email=synthetic@example.invalid",
        "commit",
        "-qm",
        "synthetic baseline",
      ],
      { cwd: repository },
    );

    const result = await run(["bun", cliPath, "--root", repository, "--values-file", valuesFile], {
      cwd: repository,
    });
    const status = await run(["git", "status", "--porcelain"], { cwd: repository });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Private-data scan passed");
    expect(result.stdout).not.toContain(forbiddenValue);
    expect(result.stderr).toBe("");
    expect(status.stdout).toBe("");
  });
});
