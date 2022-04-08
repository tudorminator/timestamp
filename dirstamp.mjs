#!/usr/bin/env node

import os from 'os';
import chalk from 'chalk';
import { execSync } from 'child_process';
import * as path from 'path';
import { exit, cwd } from 'process';
import * as fs from 'fs/promises';

const scriptPath = path.parse(process.argv[1]);
const scriptName = scriptPath.base;
const helpText = `
░█▀▄░█▒█▀▄░▄▀▀░▀█▀▒▄▀▄░█▄▒▄█▒█▀▄
▒█▄▀░█░█▀▄▒▄██░▒█▒░█▀█░█▒▀▒█░█▀▒

Usage: ${chalk.blue(`${scriptName}`)} [${chalk.magenta('some/path')}] [${chalk.magenta('some/other/path')}] [...]

  Update the modification times of ${chalk.inverse('sub-directories')} in the specified directory(ies)
  using the year and month data parsed from the sub-directory names. Works in the current directory
  if no path was specified on the command line.
  
  It descends only 1 level deep and expects a folder structure similar to the following:

     working-directory
     ├─ 2020
     │  ├─ january
     │  ├─ february
     │  │  ...
     │  ├─ december
     ├─ 2021
     │  ├─ january
     │  ├─ february
     │  │  ...
     │  ├─ december
     ├─ 2022/
     │  ...
`;

const months = {
    'en': ['dummy', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
    'ro': ['dummy', 'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'],
};

const die = (message) => {
    console.error(message);
    exit(1);
}

const getSubdirs = async (somePath) => {
    const list = await fs.readdir(somePath, {withFileTypes: true});
    return list.filter((dirent) => dirent.isDirectory());
}

const updateTimes = async ({path, atime, mtime, displayPath, origTime}) => {
    const fmt = new Intl.DateTimeFormat('ro-RO', {dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Bucharest'}).format;
    const changingStr = chalk.dim('Changing');
    const fromStr = chalk.dim('from');
    const toStr = chalk.dim('to');
    try {
        await fs.utimes(path, atime, mtime);
        console.log(`${changingStr} ${displayPath.padEnd(16, ' ')} ${fromStr} ${chalk.magentaBright(fmt(origTime))} ${toStr} ${chalk.cyanBright(fmt(mtime))}`);
    } catch (error) {
        die(error.message);
    }
}

const args = process.argv.slice(2);
let topPaths = [];
if(args.length){
    // -h | --help params, print help message
    if(args.includes('-h') || args.includes('--help')){
        console.info(helpText);
        exit(0);
    }
    topPaths = topPaths.concat(args);
} else {
    topPaths = topPaths.concat(process.cwd());
}

// iterate passed paths
for(let topPath of topPaths){
    if(path.isAbsolute(topPath)){
        topPath = path.resolve(topPath);
    } else {
       topPath = path.join(process.cwd(), topPath);
    }

    let dirList;
    try {
        dirList = await getSubdirs(topPath);
    } catch (error) {
        die(error.message);
    }
    
    // filter directories
    dirList = dirList.filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'));
    if(dirList.length === 0){
        die('No sub-directories found.')
    }

    // iterate directories
    for(const dirEnt of dirList){
        // year dir
        if(/^\d{4}/.test(dirEnt.name)){
            const p = path.join(topPath, dirEnt.name);
            const {atime, mtime} = await fs.stat(p);
            const year = parseInt(dirEnt.name, 10);
            if(isNaN(year)){
                die('Not a number:', dirEnt.name);
            }
            const correctDate = new Date(`${year}-12-31T23:59:59`);
            if (mtime.toISOString() !== correctDate.toISOString()){
                updateTimes({
                    'path': p,
                    atime,
                    mtime: correctDate,
                    displayPath: dirEnt.name,
                    origTime: mtime
                });
            }

            // subdirs
            const subdirs = await getSubdirs(p);
            // console.log(subdirs.map(dirent => path.join(p, dirent.name)));
            if(subdirs.length){
                for(const subdir of subdirs){
                    let month = 0;
                    // subdir is named as an English month
                    if(months.en.includes(subdir.name)){
                        month = months.en.indexOf(subdir.name);
                    }
                    // subdir is named as a Romanian month
                    if (months.ro.includes(subdir.name)) {
                        month = months.ro.indexOf(subdir.name);
                    }
                    const {atime, mtime} = await fs.stat(path.join(p, subdir.name));
                    const subdirPath = path.join(p, subdir.name);
                    if(month > 0){
                        const formattedDay = new Date(year, month - 1, 0).getDate().toString(10).padStart(2, '0');
                        const formattedMonth = month.toString(10).padStart(2, '0');
                        const correctDate = new Date(`${year}-${formattedMonth}-${formattedDay}T23:59:59`);
                        if(mtime.toISOString() !== correctDate.toISOString()){
                            updateTimes({
                                path: subdirPath,
                                atime,
                                mtime: correctDate,
                                displayPath: `${year}/${subdir.name}`,
                                origTime: mtime
                            });
                        }
                    }
                    if(subdir.name.includes('--') && (subdir.name.includes('toate') || subdir.name.includes('all'))){
                        const correctDate = new Date(`${year}-01-01T00:00:01`);
                        if (mtime.toISOString() !== correctDate.toISOString()) {
                            updateTimes({
                                path: subdirPath,
                                atime,
                                mtime: correctDate,
                                displayPath: `${year}/${subdir.name}`,
                                origTime: mtime
                            });
                        }
                    }
                }
            }
        }
    }
};