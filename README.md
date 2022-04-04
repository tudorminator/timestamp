# timestamp
A node.js hack to change the modified time of files based on EXIF data (for pictures) or the filename (for movies or files lacking EXIF data)

Uses the great [ExifTool by Phil Harvey](https://www.sno.phy.queensu.ca/~phil/exiftool/) if installed and available in the current path, otherwise tries a very crude parsing of the filename.

## Requirements:
- [Node.js](https://nodejs.org/) obviously
- [Chalk](https://github.com/chalk/chalk) for color output: `$ npm install chalk`
- [GNU core utilities](https://www.gnu.org/software/coreutils/coreutils.html) on macOS, because Apples's BSD ones have different command line switches and I just can't be bothered. Install them through [Homebrew](https://brew.sh/) or [MacPorts](https://www.macports.org/): `$ brew install coreutils`

## Usage:
```bash
$ timestamp.js [-q|--quick] "/path/to/some/directory"
```

Updates the modification times of image or video files in the specified directory using the capture times from their EXIF data.

If no EXIF data is found or if you specify the `-q` (`--quick`) option, it tries to parse the file's name for information looking for text that resembles the format `YYYY-MM-DD HH:mm:ss`. The parsing is not very smart or foolproof (see [line 29 in timestamp.js](timestamp.js#L29)).

Supported files: `jp(e)g`, `png`, `gif`, `mp4`, `m4v`, `mov`, `avi`
