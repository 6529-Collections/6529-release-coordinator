#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createReleaseRequestRun,
  getInputTemplate
} from "../src/index.mjs";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);

function help() {
  return `Usage:
  6529-release-request template
  6529-release-request create [--input <file|->] [--project-dir <directory>]
  6529-release-request --version

Commands:
  template  Print the current agent-input template as JSON.
  create    Create, validate, and save one local release-request run.

Options:
  --input        JSON input file. Use - for standard input. Default: -
  --project-dir  Directory that receives .release-coordinator. Default: current directory
`;
}

function parseCreateArguments(args) {
  const options = {
    input: "-",
    projectDirectory: process.cwd()
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--input requires a file path or -.");
      }
      options.input = value;
      index += 1;
      continue;
    }

    if (argument === "--project-dir") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--project-dir requires a directory.");
      }
      options.projectDirectory = path.resolve(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

async function readStandardInput() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
}

function printJson(value, target = process.stdout) {
  target.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === "--version" || command === "-v") {
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(help());
    return;
  }

  if (command === "template") {
    if (args.length > 0) {
      throw new Error("template does not accept options.");
    }
    printJson(getInputTemplate());
    return;
  }

  if (command !== "create") {
    throw new Error(`Unknown command: ${command}`);
  }

  const options = parseCreateArguments(args);
  const inputSource = options.input === "-" ? "stdin" : path.resolve(options.input);
  const readInput = options.input === "-"
    ? readStandardInput
    : () => readFile(inputSource, "utf8");

  const result = await createReleaseRequestRun({
    projectDirectory: options.projectDirectory,
    inputSource,
    readInput
  });

  const summary = {
    status: result.run.status,
    run_id: result.run.run_id,
    run_path: result.runPath,
    request_id: result.run.request?.id || null,
    request_path: result.run.request?.path || null,
    errors: result.run.errors
  };

  if (result.ok) {
    printJson(summary);
    return;
  }

  printJson(summary, process.stderr);
  process.exitCode = 1;
}

main().catch((error) => {
  printJson(
    {
      status: "failed",
      errors: [
        {
          code: "cli_error",
          location: "$",
          message: error.message
        }
      ]
    },
    process.stderr
  );
  process.exitCode = 1;
});
