import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";

export type PrivateDataScanFinding = {
  readonly trackedFileIndex: number;
  readonly forbiddenValueIndex: number;
  readonly location: "path" | "content";
};

export type PrivateDataScanResult = {
  readonly trackedFileCount: number;
  readonly forbiddenValueCount: number;
  readonly findings: readonly PrivateDataScanFinding[];
};

type CliOptions = {
  readonly rootDirectory: string;
  readonly valuesFile?: string | undefined;
  readonly readStdin: boolean;
};

class PrivateDataScanCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateDataScanCommandError";
  }
}

const normalizeRelativePath = (path: string): string => path.split(sep).join("/");
const execFileAsync = promisify(execFile);

const runGit = async (rootDirectory: string, args: readonly string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync("git", ["-C", rootDirectory, ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch {
    throw new PrivateDataScanCommandError(
      "Unable to enumerate tracked repository files. Verify the scan root is a Git checkout.",
    );
  }
};

export const parseForbiddenValues = (input: string): readonly string[] => [
  ...new Set(
    input
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter((value) => value.length >= 4 && !value.startsWith("#")),
  ),
];

export const listTrackedFiles = async (rootDirectory: string): Promise<readonly string[]> => {
  const output = await runGit(rootDirectory, ["ls-files", "-z"]);

  return output
    .split("\0")
    .filter((path) => path.length > 0)
    .sort((left, right) => left.localeCompare(right));
};

export const scanTrackedFiles = async (
  rootDirectory: string,
  trackedFiles: readonly string[],
  forbiddenValues: readonly string[],
): Promise<PrivateDataScanResult> => {
  const findings: PrivateDataScanFinding[] = [];

  for (const [trackedFileIndex, filePath] of trackedFiles.entries()) {
    let contents: string;
    try {
      contents = await readFile(resolve(rootDirectory, filePath), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    for (const [forbiddenValueIndex, forbiddenValue] of forbiddenValues.entries()) {
      if (filePath.includes(forbiddenValue)) {
        findings.push({ trackedFileIndex, forbiddenValueIndex, location: "path" });
      }

      if (contents.includes(forbiddenValue)) {
        findings.push({ trackedFileIndex, forbiddenValueIndex, location: "content" });
      }
    }
  }

  return {
    trackedFileCount: trackedFiles.length,
    forbiddenValueCount: forbiddenValues.length,
    findings,
  };
};

export const runPrivateDataScan = async (
  rootDirectory: string,
  forbiddenValues: readonly string[],
): Promise<PrivateDataScanResult> => {
  if (forbiddenValues.length === 0) {
    throw new PrivateDataScanCommandError(
      "No forbidden values were configured. Provide stdin, environment input, or an untracked values file.",
    );
  }

  const trackedFiles = await listTrackedFiles(rootDirectory);
  return scanTrackedFiles(rootDirectory, trackedFiles, forbiddenValues);
};

const parseCliOptions = (args: readonly string[]): CliOptions => {
  let rootDirectory = process.cwd();
  let valuesFile: string | undefined;
  let readStdin = false;

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];

    if (option === "--root") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new PrivateDataScanCommandError("The --root option requires a directory.");
      }
      rootDirectory = value;
      index += 1;
      continue;
    }

    if (option === "--values-file") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new PrivateDataScanCommandError("The --values-file option requires a path.");
      }
      valuesFile = value;
      index += 1;
      continue;
    }

    if (option === "--stdin") {
      readStdin = true;
      continue;
    }

    throw new PrivateDataScanCommandError("Unsupported private-data scan option.");
  }

  return { rootDirectory: resolve(rootDirectory), valuesFile, readStdin };
};

const valuesFromFile = async (
  rootDirectory: string,
  trackedFiles: readonly string[],
  valuesFile: string,
): Promise<readonly string[]> => {
  const resolvedValuesFile = resolve(valuesFile);
  const relativeValuesFile = normalizeRelativePath(relative(rootDirectory, resolvedValuesFile));

  if (!relativeValuesFile.startsWith("../") && trackedFiles.includes(relativeValuesFile)) {
    throw new PrivateDataScanCommandError(
      "The forbidden-values file must be ignored or stored outside the repository.",
    );
  }

  try {
    return parseForbiddenValues(await readFile(resolvedValuesFile, "utf8"));
  } catch {
    throw new PrivateDataScanCommandError("Unable to read the private forbidden-values file.");
  }
};

const collectForbiddenValues = async (
  options: CliOptions,
  trackedFiles: readonly string[],
): Promise<readonly string[]> => {
  const values = [
    ...(process.env.HOME === undefined ? [] : [process.env.HOME]),
    ...parseForbiddenValues(process.env.SARATHI_PRIVATE_DATA_SCAN_VALUES ?? ""),
  ];
  const valuesFile = options.valuesFile ?? process.env.SARATHI_PRIVATE_DATA_SCAN_VALUES_FILE;

  if (valuesFile !== undefined) {
    values.push(...(await valuesFromFile(options.rootDirectory, trackedFiles, valuesFile)));
  }

  if (options.readStdin) {
    values.push(...parseForbiddenValues(await Bun.stdin.text()));
  }

  return [...new Set(values.filter((value) => value.length >= 4))];
};

const formatResult = (result: PrivateDataScanResult): string => {
  if (result.findings.length === 0) {
    return `Private-data scan passed: ${result.trackedFileCount} tracked files checked against ${result.forbiddenValueCount} forbidden values.\n`;
  }

  const affectedFileCount = new Set(result.findings.map((finding) => finding.trackedFileIndex))
    .size;

  return `Private-data scan failed: ${result.findings.length} forbidden matches across ${affectedFileCount} tracked files.\n`;
};

const runCli = async (): Promise<number> => {
  const options = parseCliOptions(Bun.argv.slice(2));
  const trackedFiles = await listTrackedFiles(options.rootDirectory);
  const forbiddenValues = await collectForbiddenValues(options, trackedFiles);

  if (forbiddenValues.length === 0) {
    throw new PrivateDataScanCommandError(
      "No forbidden values were configured. Provide stdin, environment input, or an untracked values file.",
    );
  }

  const result = await scanTrackedFiles(options.rootDirectory, trackedFiles, forbiddenValues);
  const output = formatResult(result);

  if (result.findings.length > 0) {
    process.stderr.write(output);
    return 1;
  }

  process.stdout.write(output);
  return 0;
};

if (import.meta.main) {
  const program = Effect.tryPromise({
    try: runCli,
    catch: (error) =>
      error instanceof PrivateDataScanCommandError
        ? error
        : new PrivateDataScanCommandError("Private-data scan failed unexpectedly."),
  });

  Effect.runPromise(program).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    async (error: PrivateDataScanCommandError) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
