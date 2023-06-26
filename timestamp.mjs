#!/usr/bin/env node

import * as os from 'os';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { parse, basename, posix } from 'path';
import { writeFileSync } from 'fs';

const scriptPath = parse(process.argv[1]);
const scriptName = scriptPath.base;
const platform = os.platform();
const skipEXIF = process.argv.includes('-q') || process.argv.includes('--quick');
const showHelp = process.argv.includes('-h') || process.argv.includes('--help');
const skipSummary = process.argv.includes('-n') || process.argv.includes('--nosummary')
const helpText = `
░▀█▀░█░█▄▒▄█▒██▀░▄▀▀░▀█▀▒▄▀▄░█▄▒▄█▒█▀▄
░▒█▒░█░█▒▀▒█░█▄▄▒▄██░▒█▒░█▀█░█▒▀▒█░█▀▒

Usage: ${chalk.blue(`${scriptName}`)} [-q|--quick] [-n|--nosummary] ${chalk.magenta('/path/to/some/directory')}

Update the modification times of ${chalk.inverse('image')} or ${chalk.inverse('video')} files in the specified directory
using the capture times from their EXIF data.

If no EXIF data is found or you specify the ${chalk.magenta('-q')} or ${chalk.magenta('--quick')} option,
it tries to parse the file's name for information.

Supported files: ${chalk.blue('jp(e)g')}, ${chalk.blue('png')}, ${chalk.blue('gif')}, ${chalk.blue('mp4')}, ${chalk.blue('m4v')}, ${chalk.blue('mov')}, ${chalk.blue('avi')}

A JSON file containing the run date and an array of changed files is also saved,
unless the ${chalk.magenta('-n')} or ${chalk.magenta('--nosummary')} option is specified.
`;

// YY(YY)-MM-DD HH:mm:ss
// all separators may vary or be absent, time values may be absent
// !!! fails on filenames like 2014-12-25 11;48-2.jpg
// const timeStampRegex = /(\d{2,4}.?\d{2}.?\d{2})[^\d]*(\d{0,2}.?\d{0,2}.?\d{0,2})/miu;
// → change condition that between minutes and seconds must have something else than a hyphen (-) or a digit
//-------------------------YYYY     MM     DD           HH       mm             SS
const timeStampRegex = /(\d{2,4}.?\d{2}.?\d{2})[^\d]*(\d{0,2}.?\d{0,2}[^-\d]?\d{0,2})/miu;

let skipped = 0;
let processed = 0;
let errors = 0;
const currentDate = new Date();
const summaryObj = {
	'date': currentDate,
	'files': [],
};
const startTime = Date.now();

const totalTerminalColumns = process.stdout.columns;

/**
 * Change modified date of a file
 * @param {string} timeStamp New modification date-time
 * @param {string} file The file to be changed (full path)
 */
const touchCommand = platform === 'darwin' ? 'gtouch' : 'touch';
const touchFile = (timeStamp, file) => {
	const shellCommand1 = `${touchCommand} -cm --date="${timeStamp}" "${file}" 2>/dev/null`;
	// const stamp = timeStamp.replace(/[^\d]/g, '').slice(0, -2);
	// const shellCommand2 = `touch -cmt ${stamp} "${file}"`;
	try {
		// console.info(shellCommand);
		const result = execSync(shellCommand1);
		// console.info({shellCommand, result});
		return 0;
	} catch(error){
		// console.error(chalk.red('Error'), ': ', chalk.red(timeStamp), chalk.magenta(file));
		process.stdout.clearLine(0);
		console.error(chalk.red('Error:'), `Got ${chalk.red('invalid')} timestamp (${chalk.gray(timeStamp)}) from unexpected file format ${chalk.magenta(basename(file))}. File not changed.`);
		errors += 1;
		return 1;
	}
}

/**
 * Check for the presence of exiftool
 */
const isExifToolPresent = () => {
	const shellCommand = 'exiftool -ver';
	try {
		execSync(shellCommand, {stdio: [null, null, 'ignore']});
		return true;
	} catch (error) {
		const errorMessage = error.toString().toLocaleLowerCase();
		if (errorMessage.indexOf('command failed') > -1) {
			console.warn(chalk.yellow('Exiftool not found in path'));
		}
		return false;
	}
}

/**
 * Get `DateTimeOriginal` value from file's EXIF
 * @param {string} file File to get EXIF data from
 */
const getExifData = (file) => {
	let exifDateTime = '';
	if (supportsExif) {
		if (/(?:jpe?g)|(?:png)|(?:gif)$/i.test(file)) {
			try {
				const exifTextData = execSync(`exiftool -m -j "${file}"`);
				const parsed = JSON.parse(exifTextData);
				if (Array.isArray(parsed) && parsed.length) {
					const exifObj = parsed[0];
					if ('DateTimeOriginal' in exifObj) {
						exifDateTime = exifObj['DateTimeOriginal']
							.trim()
							.replace(':', '-')
							.replace(':', '-');
					}
				}
			} catch (error) {
				console.error('EXIF error:', { error });
				errors += 1;
			}
		}
	}
	return exifDateTime;
};

/**
 * Get `modified` date-time from file
 * @param {string} file File to check
 */
const statCommand = platform === 'darwin' ? 'gstat' : 'stat';
const getModifiedTime = (file) => {
	let mTime = '';
	try {
		mTime = execSync(`${statCommand} -c %y "${file}"`, { stdio: [null, null, 'ignore'] })
			.toString()
			.trim()
			.split('.')[0];
	} catch (error) {
		console.error(chalk.red(`Can't stat ${file}`), { error });
		errors += 1;
	}
	return mTime;
};

/**
 * Try to get date and time values by parsing the file name
 * @param {string} fileName The name of the file to parse
 */
const parseFileName = (fileName) => {
	let timeStampFromFilename = '';
	const notNumberRegEx = /[^\d]/g;
	const match = timeStampRegex.exec(fileName.slice(0, -4)); // remove file extension
	if (Array.isArray(match) && match.length === 3) {
		const date = match[1].trim().replace(notNumberRegEx, '-');
		let time = match[2].trim().replace(notNumberRegEx, ':');
		// console.log('1.', {time});
		// add time separators if necessary
		const separatorsCount = Array.from(time)
			.filter(elem => notNumberRegEx.test(elem))
			.length;
		// console.log({ separatorsCount });
		if(separatorsCount) {
			if(separatorsCount < 2) {
				time = time.replace(notNumberRegEx, '') // remove all non-digits
					.match(/.{1,2}/g) // gropup every 2 digits
					.join(':'); // insert `:`
					// console.log('2.', {time});
			}
		 } else {
			time = '00:00:00';
		}
		// add seconds if necessary
		if (time.length && time.length < 8) {
			time += ':00';
			// console.log('3.', {time});
		}
		timeStampFromFilename = `${date} ${time}`;
	} else {
		console.error(chalk.red('Unexpected filename format!\n'), { fileName }, '\n', {'RegExp match': JSON.stringify(match)});
		errors += 1;
	}
	return timeStampFromFilename;
}

/**
 * Change modification date of a file based on EXIF data or file name as a fallback
 * @param {string} fileName The file to be processed (full path)
 */
const processFile = (fileName, path, index, totalCount) => {
	printStatus(index + 1, totalCount, fileName);
	const exifDateTime = skipEXIF ? '' : getExifData(`${path}${fileName}`);
	const mTime = getModifiedTime(`${path}${fileName}`);

	if (exifDateTime.length) {
		// use EXIF date
		if (exifDateTime !== mTime) {
			// change only if necessary
			let touchResult = touchFile(exifDateTime, `${path}${fileName}`);
			if (touchResult > 0) {
				exitCode = 1;
			} else {
				processed += 1;
				// console.info(`${fileName}: ${chalk.magenta(mTime)} → ${chalk.blue(exifDateTime)} (EXIF)\n`);
				printStatus(
					index + 1,
					totalCount,
					`${fileName}: ${chalk.magenta(mTime)} → ${chalk.blue(exifDateTime)} (EXIF)`,
					true
				);
				// add filename to the summary object
				summaryObj.files.push(fileName);
			}
		} else {
			skipped += 1;
		}
	} else {
		// use date from filename
		const timeStampFromFilename = parseFileName(fileName);
		if (timeStampFromFilename.length) {
			// change only if necessary
			if (timeStampFromFilename !== mTime) {
				// console.log(chalk.blue(timeStampFromFilename));
				let touchResult = touchFile(timeStampFromFilename, `${path}${fileName}`);
				if (touchResult > 0) {
					exitCode = 1;
				} else {
					processed += 1;
					// console.info(`${fileName}: ${chalk.magenta(mTime)} → ${chalk.blue(timeStampFromFilename)} (parsed)\n`);
					printStatus(
						index + 1,
						totalCount,
						`${fileName}: ${chalk.magenta(mTime)} → ${chalk.blue(timeStampFromFilename)} (parsed)`,
						true
					);
					// add filename to the summary object
					summaryObj.files.push(fileName);
				}
			}	else {
				skipped += 1;
			}
		} else {
			skipped += 1;
			errors += 1;
			printStatus(
				index + 1,
				totalCount,
				`${fileName}: Can't parse file name; skip`,
				true
			);
		}
	}
}

/**
 * Constrain a string to a maximum length by removing the middle and inserting ellipsis
 * @param {String} str The string to constrain
 * @param {Number} len Length to constrain it to
 */
const constrainStr = (str, len = Math.floor(totalTerminalColumns / 2)) => {
  if(str.length <= len) {
    return str;
  }
  const toRemove = 1 + Math.ceil((str.length - len) / 2);
  const index1 = Math.floor(str.length / 2) - toRemove;
  const index2 = Math.ceil(str.length / 2) + toRemove;
  return `${str.substring(0, index1)}…${str.substring(index2)}`;
}

/**
 * Print progress bar
 */
const printStatus = (current, total, status = '', persistStatus = false) => {
	const percent = Math.floor(current * 100 / total);
	const percentText = `(${percent}%)`.padStart(5);
	const indexText = `${current.toString().padStart(total.toString().length)}/${total}`;
  const progressText = `${percentText} ${chalk.gray(indexText)}`;
  let fileInfoText = '';
	if(!persistStatus){
    const maxFileInfoLength = Math.floor(totalTerminalColumns / 2) - percentText.length - indexText.length - 2;
    fileInfoText = chalk.magenta(constrainStr(status, maxFileInfoLength));
  }
  const barLength = Math.floor(totalTerminalColumns / 2) - 4; // ` ‣  `.length
	const filledLength = Math.min(barLength, Math.floor(percent / 100 * barLength));
	const padLength = barLength - filledLength;
	// console.debug({current, total, percent, barLength, filledLength, padLength});
	// process.stdout.write(`${percent.toString().padStart(3)}% [${''.padEnd(filledLength, '―')}${chalk.gray(''.padEnd(padLength, "-"))}]\n`);
	process.stdout.clearLine(0);
	process.stdout.write(` ‣ ${chalk.blue(''.padEnd(filledLength, '█'))}${chalk.gray(''.padEnd(padLength, "█"))} ${progressText} ${fileInfoText}\n`);
	if(persistStatus){
		process.stdout.moveCursor(0, -1);
		process.stdout.clearLine(0);
		process.stdout.write(`${status}\n`);
	} else {
		process.stdout.moveCursor(0, -1);
	}
	process.stdout.cursorTo(0);
}

const hideCursor = () => process.stdout.write('\u001B[?25l');
const unhideCursor = () => {
	process.stdout.write('\u001B[?25h\n');
	process.exit(exitCode);
};

// main
// get rid of already processed params
let params = process.argv.slice(2).filter(p => !['--quick', '-q', '--nosummary', '-n'].includes(p));
if(showHelp){
	console.log(helpText);
	process.exit(0);
}
if(params.length !== 1){
	console.error(helpText);
	process.exit(1);
}
// make sure to unhide terminal cursor on exit/break/crash
// process.on('SIGINT', unhideCursor);
// process.on('SIGTERM', unhideCursor);
// process.on('SIGHUP', unhideCursor);
process.on('exit', unhideCursor);
process.on('uncaughtException', unhideCursor);

const supportsExif = isExifToolPresent();

let exitCode = 0;
let targetDirectory = params[0];
const multipleSeparatorsRegEx = new RegExp(`${posix.sep}{2,}`, 'gi');
// ensure path ends with separator
targetDirectory = `${targetDirectory}${posix.sep}`.replace(multipleSeparatorsRegEx, `${posix.sep}`);
// filter out unsupported files
const fileTypesRegEx = /(?:jpe?g)|(?:png)|(?:gif)|(?:mp4)|(?:m4v)|(?:mov)|(?:avi)$/i;
// filter out lines ending in `/` because they are subfolders
// and filter out AppleDouble files (starting with `._`)
const regularFileRegEx = /^(?!\._).*[^/]$/;

// `ls -1Ap`
// -1: list files one per line
// -A: do not list implied . and .. (-A) &
// -p: append / indicator to directories
const files = execSync(`ls -1Ap "${targetDirectory}"`)
	.toString()
	.trim()
	.split('\n')
	.filter(fileName => fileTypesRegEx.test(fileName) && regularFileRegEx.test(fileName))
	.sort();

if (files.length) {
	hideCursor()
	console.info(`
Files found: ${chalk.blue(files.length)}\n`);

	// do the magic!
 	files.forEach((file, index, array) => processFile(file, targetDirectory, index, array.length));

	console.log('');

	// write summary JSON
	let writeStatus = 'skipped';
	if (processed > 0 && !skipSummary) {
		const json = JSON.stringify(summaryObj, null, 2);
		try {
			writeFileSync(`${targetDirectory}_h5ai.changes.json`, json);
			writeStatus = 'written';
		} catch (error) {
			console.error(chalk.red(`Can't write changes summary file`), { error });
			writeStatus = chalk.red('not written');
			errors += 1;
		}
	}

	// print info
	console.info(`
Changed: ${processed != '0' ? chalk.blue(processed) : processed}
Skipped: ${skipped != '0' ? chalk.yellow(skipped) : skipped}
 Errors: ${errors != '0' ? chalk.red(errors) : errors}
Summary: ${writeStatus}
${chalk.bgGray.black(`   Time: ${process.uptime().toFixed(1)}s `)}`
	);
} else {
	console.error(chalk.red('No files found'), targetDirectory);
}
process.exit(exitCode);
