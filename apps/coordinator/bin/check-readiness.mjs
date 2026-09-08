#!/usr/bin/env node
import { runReadinessCli } from "../src/readiness-cli.mjs";

process.exitCode = await runReadinessCli(process.argv.slice(2));
