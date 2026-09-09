#!/usr/bin/env node
import { runProcessingCli } from "../src/processing-cli.mjs";

process.exitCode = await runProcessingCli(process.argv.slice(2));
