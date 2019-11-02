# timestamp
A node.js hack to change the modified time of files based on EXIF data (for pictures) or the filename (for movies or files lacking EXIF data)

Uses the great [ExifTool by Phil Harvey](https://www.sno.phy.queensu.ca/~phil/exiftool/) if installed and available in the current path, otherwise tries a very crude parsing of the filename.

## Requirements:
- [Chalk](https://github.com/chalk/chalk) for color output: `$ npm install chalk` 

## Usage:
```bash
$ timestamp.js "/path/to/some/folder/with/images/and/or/movies"
```

Updates the modification times of image or video files in the specified directory using the capture times from their EXIF data.

If no EXIF data is found, it tries to parse the file's name for information.

Supported files: `jp(e)g`, `png`, `gif`, `mp4`, `m4v`, `mov`, `avi`
