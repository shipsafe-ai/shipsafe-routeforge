#!/usr/bin/env node
import { createCLI } from "../src/cli.mjs";
createCLI().parseAsync(process.argv);
