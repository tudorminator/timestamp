#!/usr/bin/env node

const os = require('os');
const readline = require('readline');
const chalk = require('chalk');
const { execSync } = require('child_process');
const path = require('path');

const scriptPath = path.parse(process.argv[1]);
const scriptName = scriptPath.base;
const platform = os.platform();
const helpText = `Usage: ${chalk.cyan(`${scriptName}`)} ${chalk.magenta('/path/to/some/folder/with/images/and/or/movies')}

Update the modification times of ${chalk.inverse('image')} or ${chalk.inverse('video')} files in the specified directory
using the capture times from their EXIF data.

If no EXIF data is found, it tries to parse the file's name for information.

Supported files: ${chalk.cyan('jp(e)g')}, ${chalk.cyan('png')}, ${chalk.cyan('gif')}, ${chalk.cyan('mp4')}, ${chalk.cyan('m4v')}, ${chalk.cyan('mov')}, ${chalk.cyan('avi')}`;

// YY(YY)-MM-DD HH:mm:ss
// all separators may vary or be absent, time values may be absent
const timeStampRegex = /(\d{2,4}.?\d{2}.?\d{2})[^\d]*(\d{0,2}.?\d{0,2}.?\d{0,2})/miu;

let skipped = 0;
let processed = 0;
let errors = 0;
const startTime = Date.now();

const totalTerminalColumns = process.stdout.columns;

/**
 * Zero-pad a number
 * @param {any} number The number to zero pad
 * @param {number} digits How many total digits
 */
const padNumber = (number, digits) => {
	const paddingZeros = new Array(101).join('0');
	const computed = paddingZeros + number.toString();
	return computed.slice(-1 * digits);
};

/**
 * Change modified date of a file
 * @param {string} timeStamp New modification date-time
 * @param {string} file The file to be changed (full path)
 */
const touchCommand = platform === 'darwin' ? 'gtouch' : 'touch';
const touchFile = (timeStamp, file) => {
	const shellCommand1 = `${touchCommand} -cm --date="${timeStamp}" "${file}"`;
	// const stamp = timeStamp.replace(/[^\d]/g, '').slice(0, -2);
	// const shellCommand2 = `touch -cmt ${stamp} "${file}"`;
	try {
		// console.info(shellCommand);
		const result = execSync(shellCommand1);
		// console.info({shellCommand, result});
		return 0;
	} catch(error){
		console.error(chalk.red(`Can't touch this: ${file}`));
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
		if (separatorsCount && separatorsCount < 2) {
			time = time.replace(notNumberRegEx, '') // remove all non-digits
				.match(/.{1,2}/g) // gropup every 2 digits
				.join(':'); // insert `:`
				// console.log('2.', {time});
		}
		// add seconds if necessary
		if (time.length && time.length < 8) {
      time += ':00';
      // console.log('3.', {time});
    }
		timeStampFromFilename = `${date}${time.length ? ' ' + time : ''}`;
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
	const exifDateTime = getExifData(`${path}${fileName}`);
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
				// console.info(`${fileName}: ${chalk.magenta(mTime)} → ${chalk.cyan(exifDateTime)} (EXIF)\n`);
				printStatus(
					index + 1,
					totalCount,
					`${fileName}: ${chalk.magenta(mTime)} → ${chalk.cyan(exifDateTime)} (EXIF)`,
					true
				);
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
				// console.log(chalk.cyan(timeStampFromFilename));
				let touchResult = touchFile(timeStampFromFilename, `${path}${fileName}`);
				if (touchResult > 0) {
					exitCode = 1;
				} else {
					processed += 1;
					// console.info(`${fileName}: ${chalk.magenta(mTime)} → ${chalk.cyan(timeStampFromFilename)} (parsed)\n`);
					printStatus(
						index + 1,
						totalCount,
						`${fileName}: ${chalk.magenta(mTime)} → ${chalk.cyan(timeStampFromFilename)} (parsed)`,
						true
					);
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
 * Print progress bar
 */
const printStatus = (current, total, status = '', persistStatus = false) => {
	const percent = Math.floor(current * 100 / total);
	const barLength = totalTerminalColumns - 1 - 2 - 4; // 2 chars for bar ends, 4 chars for percent label
	const filledLength = Math.min(barLength, Math.floor(percent / 100 * barLength));
	const padLength = barLength - filledLength;
	// console.debug({current, total, percent, barLength, filledLength, padLength});
	process.stdout.write(`${percent.toString().padStart(3)}% [${''.padEnd(filledLength, '―')}${chalk.gray(''.padEnd(padLength, "-"))}]\n`);
	if(persistStatus){
		process.stdout.moveCursor(0, -1);
		process.stdout.clearLine(0);
		process.stdout.write(`${status}\n`);
	} else {
		process.stdout.moveCursor(0, -1);
	}
	process.stdout.cursorTo(0);
}

// main
if(process.argv.slice(2).length !== 1){
	console.error(helpText);
	process.exit(1);
}

const supportsExif = isExifToolPresent();

let exitCode = 0;
let targetDirectory = process.argv.slice(2)[0];
const multipleSeparatorsRegEx = new RegExp(`${path.posix.sep}{2,}`, 'gi');
// ensure path ends with separator
targetDirectory = `${targetDirectory}${path.posix.sep}`.replace(multipleSeparatorsRegEx, `${path.posix.sep}`);
// filter unsupported files
const fileTypesRegEx = /(?:jpe?g)|(?:png)|(?:gif)|(?:mp4)|(?:m4v)|(?:mov)|(?:avi)$/i;
// filter lines ending in `/` because they are subfolders
const regularFileRegEx = /[^/]$/;

// `ls -1Ap`
// -1: list files one per line
// -A: do not list implied . and .. (-A) &
// -p: append / indicator to directories
const files = execSync(`ls -1Ap "${targetDirectory}"`)
	.toString()
	.trim()
	.split('\n')
	.filter(fileName => fileTypesRegEx.test(fileName) && regularFileRegEx.test(fileName));

if (files.length) {
	console.info(`
Target: ${chalk.yellow(targetDirectory)}
 Files: ${chalk.cyan(files.length)}\n`);
	files.forEach((file, index, array) => processFile(file, targetDirectory, index, array.length));
	console.log('');
	console.info(`
Processed: ${chalk.cyan(processed)}
  Skipped: ${chalk.yellow(skipped)}
   Errors: ${chalk.red(errors)}

     Time: ${process.uptime().toFixed(1)}s`);
} else {
	console.error(chalk.red('No files found'), targetDirectory);
}
process.exit(exitCode);
