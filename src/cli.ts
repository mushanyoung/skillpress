import { VERSION } from "./version.js";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}
const HELP = `SkillPress ${VERSION}

Build, evaluate, package, and publish production-grade Agent Skills.

Usage:
  skillpress [options]
  skillpress <command> [options]

Options:
  -h, --help       Show this help
  -v, --version    Show the installed version

The create, check, test, eval, package, publish, status, and doctor commands
will be enabled as their independently reviewed implementation slices land.
`;

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export function renderHelp(): string {
  return HELP;
}

export async function runCli(args: readonly string[], io: CliIo = defaultIo): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    io.stdout(renderHelp());
    return 0;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  io.stderr(`Unknown command: ${args[0]}\nRun 'skillpress --help' for usage.\n`);
  return 2;
}
