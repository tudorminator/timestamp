#!/usr/bin/env node

import { platform as _platform } from 'os';
import { blue, magenta, inverse } from 'chalk';
import { execSync } from 'child_process';
import { parse, basename, dirname } from 'path';

const scriptPath = parse(process.argv[1]);
const scriptName = scriptPath.base;
const platform = _platform();
const helpText = `Usage: ${blue(`${scriptName}`)} [${magenta('/path/to/some/directory')}]

Update the modification times of ${inverse('directories')} in the specified (or current) directory
using the year and month data parsed from the directory names.`;

const args = process.argv.slice(1);

console.info({args});